/* ============================================================
   STELLAR FRONTIER — convoy escort
   The expert-gated Escort tab: command a whole fleet (flagship +
   escorts + freighters), pool its firepower, split it equally across
   the attackers you choose, and shepherd freighters to port. Reuses
   the raid combat math (estPlayerDPS, ship classes, foe profiles,
   field repair) — the player commands a fleet here, not a single
   ship. See docs/ESCORT.md for the full design & balance notes.
   renderEscort() and endTurn()'s escortDeadlineCheck() caller stay in
   game.js — no render* function has been extracted in any prior
   slice of this split, and endTurn() itself is core turn-orchestration
   glue that stays behind along with every other render* function.

   Loaded after mandates.js, before game.js. S, log, toast, sfx,
   announce, fmt, currentPlanet, cargoFree, fuelCost, isActive,
   galaxyKnown, fxMult, pick, rint, matsString, endTurn, setTab,
   saveGame, renderAll and renderEscort still live in other
   files/game.js at this point in the split — safe, since every
   function here is only CALLED later, once every script has finished
   loading, same pattern as every prior slice. Convoy formation
   (Vanguard/Line/Reserve) reuses fleet.js's FORMATION_SLOTS/
   FORMATION_TIERS/shipFormation as-is, not a copy — fleet.js loads
   even earlier than mandates.js, so these are already defined.
   ============================================================ */

"use strict";
const ESCORT_FLEET = { escorts: 2, freighters: 2 };
const ESCORT_MAX_HIRED = 5;         // how many pirate bands you can field as hired escorts
const ESCORT_ESCORT_FP = 13;        // base firepower per escort (× ship class)
const ESCORT_FREIGHTER_FP = 3;      // freighters can pop off a few shots
const ESCORT_ESCORT_HULL = 55;      // base hull per escort (× ship class)
const ESCORT_FREIGHTER_HULL = 42;
const ESCORT_FOE_DMG = 9;           // base per-round damage a foe deals a fleet ship
const ESCORT_POSTURES = {
  screen:   { off: 0.85, def: 0.70, label: "🛡️ Screen",  hint: "cautious footing — less firepower, but the convoy takes noticeably less damage" },
  balanced: { off: 1.00, def: 1.00, label: "⚖️ Balanced", hint: "even footing" },
  press:    { off: 1.18, def: 1.30, label: "⚔️ Press",    hint: "pour on fire — but the convoy takes more hits" },
};
// Attacker archetypes — each prefers a different fleet target, telegraphed as
// "intent" so you can prioritise the foe about to hit something you can't lose.
const ESCORT_FOE_ROLES = {
  raider:      { ico: "🏴‍☠️", name: "Raider",      pref: "freighter" },
  interceptor: { ico: "⚡",   name: "Interceptor", pref: "escort" },
  gunship:     { ico: "💢",   name: "Gunship",     pref: "flagship" },
  elite:       { ico: "☠️",   name: "Marauder Lead", pref: "value" },
};
function escortFoeRole(f) { return ESCORT_FOE_ROLES[f && f.role] || ESCORT_FOE_ROLES.raider; }
function escortTargetValue(sh) { return sh.role === "freighter" ? 5 : sh.role === "escort" ? 3 : 2; }   // what an attacker covets
// the frontmost non-empty formation tier among LIVING convoy ships — mirrors battleGroupFrontTier
// (fleet.js) exactly, reusing the same FORMATION_TIERS/shipFormation the Raid tab's Battle Group
// already uses, so Vanguard/Line/Reserve read identically in both places.
function escortFrontTier() {
  const alive = escortFleet().filter(escShipAlive);
  for (const t of FORMATION_TIERS) { const grp = alive.filter(s => shipFormation(s) === t); if (grp.length) return grp; }
  return [];
}
function setEscortFormation(fi, slot) {
  const e = ensureEscort(); const sh = e.fleet[fi]; if (!sh || !FORMATION_SLOTS[slot]) return;
  sh.formation = slot; saveGame(); renderAll();
}
// Formation gates WHO can be hit at all (85% of the time the frontmost non-empty tier, same
// split battleGroupTakeFire uses; 15% stray fire reaches the whole fleet) — then the existing
// per-foe role preference (raider wants a freighter, interceptor wants your biggest gun, elite
// wants the highest-"value" hull) picks a specific ship WITHIN whatever pool tiering exposed
// this round. A Reserve freighter behind a holding Vanguard is rarely reachable at all; explicit
// placement replaces the old Screen-posture body-block (an 80%-chance freighter redirect).
function chooseIntent(f) {
  const fleet = escortFleet();
  const alive = fleet.map((s, i) => ({ s, i })).filter(o => escShipAlive(o.s));
  if (!alive.length) return -1;
  const front = escortFrontTier();
  const exposed = (front.length && Math.random() < 0.85) ? alive.filter(o => front.includes(o.s)) : alive;
  const want = escortFoeRole(f).pref;
  let cands;
  if (want === "value") cands = exposed.slice().sort((a, b) => escortTargetValue(b.s) - escortTargetValue(a.s)).slice(0, Math.max(1, Math.ceil(exposed.length / 2)));
  else { cands = exposed.filter(o => o.s.role === want); if (!cands.length) cands = exposed; }
  const chosen = want === "escort"
    ? cands.slice().sort((a, b) => escShipFP(b.s) - escShipFP(a.s))[0]   // interceptors hit your biggest guns
    : cands[Math.floor(Math.random() * cands.length)];
  return chosen.i;
}
function assignIntents() {
  const e = ensureEscort(), w = e.wave; if (!w) return;
  w.foes.forEach(f => { if (f.hp > 0) f.intent = chooseIntent(f); else f.intent = -1; });
}
// Phase 3: an Escort Guild reputation track — completed runs raise your rank,
// which pays better and lets you field a larger fleet.
const ESCORT_LEG_FUEL = 3;          // fallback per-leg fuel (old saves); contracts carry their own legFuel
const ESCORT_LOOT_FRAC = 0.3;       // you recover only a share of a wreck's bounty/cargo (the rest is slag)
const ESCORT_RANKS = [
  { rep: 0,   name: "Freelancer",      mult: 1.00, escorts: 2 },
  { rep: 60,  name: "Contractor",      mult: 1.12, escorts: 2 },
  { rep: 160, name: "Convoy Master",   mult: 1.25, escorts: 3 },
  { rep: 320, name: "Fleet Commander", mult: 1.40, escorts: 4 },
];
function escortRankIndex() { const r = S.escortRep || 0; let idx = 0; ESCORT_RANKS.forEach((t, i) => { if (r >= t.rep) idx = i; }); return idx; }
function escortRank() { return ESCORT_RANKS[escortRankIndex()]; }
function escortNextRank() { return ESCORT_RANKS[escortRankIndex() + 1] || null; }
// Elite leaders wield one battlefield ability, telegraphed on their card.
const ESCORT_BOSS_ABILITIES = {
  alpha: { ico: "💥", name: "Alpha Strike", hint: "its hit can land double" },
  rally: { ico: "📣", name: "Rally",        hint: "can spur the whole wave to hit harder" },
  jam:   { ico: "📡", name: "Jammer",       hint: "can sap your next salvo's firepower" },
};
/* ---- Convoy outfitting: spend weapons / combat drones / AI cores to bolt
   attack & defense onto any fleet ship. Assets are CONSUMED (a money sink);
   committed assets sit in a fleet pool you can shuffle between ships freely,
   and are gone for good when the run ends. AI cores multiply (diminishing). ---- */
const OUTFIT_MIT_CAP = 0.6;     // a ship can never dodge more than 60% of a hit
function escortPool() { const e = ensureEscort(); if (!e.pool) e.pool = { weapons: 0, drones: 0, ai: 0 }; return e.pool; }
/* ---- Per-vessel combat STANCE + 3 upgrade levels (replaces asset-assignment outfit) ----
   Each ship flies an Aggressive / Balanced / Defensive stance; you buy up to 3 levels of
   fit for the active stance, paid from your hold (🔫🛸🧠). Cost scales with the stance and the
   vessel's size/type; freighters cap lower. Effects are read in escShipFP & the enemy turn. */
const VESSEL_STANCES = {
  aggressive: { ico: "⚔️", name: "Aggressive", atk: [0, 0.18, 0.34, 0.55], mit: [0, 0, 0, 0],          hint: "pour on fire — bonus weapon damage, no extra armor" },
  balanced:   { ico: "⚖️", name: "Balanced",   atk: [0, 0.10, 0.18, 0.28], mit: [0, 0.06, 0.11, 0.16], hint: "a steady mix of bite and armor" },
  defensive:  { ico: "🛡️", name: "Defensive",  atk: [0, 0, 0, 0],          mit: [0, 0.12, 0.22, 0.32], hint: "hunker down — soak incoming fire" },
};
const STANCE_COST_W = { aggressive: { weapons: 2, drones: 1, ai: 0 }, balanced: { weapons: 1, drones: 1, ai: 1 }, defensive: { weapons: 0, drones: 2, ai: 1 } };
function shipFit(sh) { if (!sh.fit) sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; if (!sh.stance) sh.stance = "balanced"; return sh.fit; }
function vesselSizeFactor(sh) { return sh.role === "flagship" ? 2 : sh.role === "freighter" ? 0.6 : 0.8 + 0.35 * Math.max(0, CLASS_ORDER.indexOf(sh.cls || "corvette")); }
function vesselMaxLevel(sh) { return sh.role === "freighter" ? 2 : 3; }   // cargo haulers can't be fully kitted out
function stanceProfile(sh) { const st = VESSEL_STANCES[sh.stance || "balanced"] || VESSEL_STANCES.balanced, L = shipFit(sh)[sh.stance || "balanced"] || 0; return { atk: st.atk[L] || 0, mit: Math.min(OUTFIT_MIT_CAP, st.mit[L] || 0) }; }
function vesselUpgradeCost(sh, stance, lvl) { const w = STANCE_COST_W[stance] || STANCE_COST_W.balanced, f = lvl * vesselSizeFactor(sh), c = {}; ["weapons", "drones", "ai"].forEach(a => { const n = Math.ceil((w[a] || 0) * f); if (n > 0) c[a] = n; }); return c; }
function costAssetString(c) { return Object.keys(c).map(a => `${c[a]}${COM[a].ico}`).join(" ") || "free"; }
function setVesselStance(fi, stance) {
  const e = ensureEscort(); const sh = e.fleet[fi]; if (!sh || !VESSEL_STANCES[stance]) return;
  shipFit(sh); sh.stance = stance;
  if (escortInCombat()) e.pendingRedeploy = true;
  saveGame(); renderAll();
}
function upgradeVessel(fi) {
  const e = ensureEscort(); const sh = e.fleet[fi]; if (!sh) return;
  if (sh.role !== "flagship" && !sh.alive) return toast("That ship is gone.", "bad");
  const stance = sh.stance || "balanced", fit = shipFit(sh), cur = fit[stance] || 0, max = vesselMaxLevel(sh);
  if (cur >= max) return toast(`${sh.name} is at max ${VESSEL_STANCES[stance].name} fit (Lv${max}).`, "bad");
  const cost = vesselUpgradeCost(sh, stance, cur + 1);
  const lack = Object.keys(cost).filter(a => (S.res[a] || 0) < cost[a]);
  if (lack.length) return toast(`Need ${costAssetString(cost)} — short on ${lack.map(a => COM[a].ico).join("")}. Buy more at the Market.`, "bad");
  Object.keys(cost).forEach(a => { S.res[a] -= cost[a]; });
  fit[stance] = cur + 1;
  if (escortInCombat()) e.pendingRedeploy = true;
  log(`🔧 ${sh.ico} ${sh.name} → ${VESSEL_STANCES[stance].ico} ${VESSEL_STANCES[stance].name} Lv${cur + 1} (−${costAssetString(cost)}).`, "good");
  toast(`${sh.name}: ${VESSEL_STANCES[stance].name} Lv${cur + 1}`, "good"); sfx("repair");
  saveGame(); renderAll();
}
function escortBraceRound() {
  const e = ensureEscort(); if (!e.wave) return;
  e.pendingRedeploy = false;
  log("🔧 Under fire, the convoy re-rigs its loadout and braces — the attackers get a free pass.", "");
  escortEnemyTurn();
  if (e.active) { saveGame(); renderEscort(); }
}
function escortDiscardOutfit(verb) {
  const e = ensureEscort();
  // stance fit was paid from the hold when bought — nothing to refund; just clear it
  (e.fleet || []).forEach(sh => { sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; sh.stance = "balanced"; });
  e.pool = { weapons: 0, drones: 0, ai: 0 };
  return 0;
}
function ensureEscort() {
  if (!S.escort) S.escort = { active: false, offers: [], mission: null, fleet: [], wave: null, posture: "balanced", targets: [], pool: { weapons: 0, drones: 0, ai: 0 } };
  if (!S.escort.pool) S.escort.pool = { weapons: 0, drones: 0, ai: 0 };
  return S.escort;
}
function escortPosture() { return ESCORT_POSTURES[(S.escort && S.escort.posture) || "balanced"] || ESCORT_POSTURES.balanced; }
function escortInCombat() { return !!(S.escort && S.escort.wave && S.escort.wave.foes && S.escort.wave.foes.some(f => f.hp > 0)); }
function escortFleet() { return (S.escort && S.escort.fleet) || []; }
function escShipAlive(sh) { return sh.role === "flagship" ? S.pirate.hull > 0 : sh.alive; }
function escShipHull(sh) { return sh.role === "flagship" ? Math.round(S.pirate.hull) : sh.hull; }
function escShipHullMax(sh) { return sh.role === "flagship" ? HULL_MAX : sh.hullMax; }
// the best weapon the flagship has the ammo to fire this salvo (falls back to free kinetic)
function escortFlagWeapon() {
  let best = "kinetic";
  Object.keys(WEAPONS).forEach(w => { if (weaponAvailable(w) && weaponAffordable(w) && WEAPONS[w].mult > WEAPONS[best].mult) best = w; });
  return best;
}
function escFlagshipFP() {
  const ratio = WEAPONS[escortFlagWeapon()].mult / bestWeaponMult();   // dialed back if you're out of premium ammo
  return estPlayerDPS() * condFactor("weapons") * ratio;
}
function escShipFP(sh) {
  if (!escShipAlive(sh)) return 0;
  const base = sh.role === "flagship" ? escFlagshipFP() : sh.str * (0.5 + 0.5 * (sh.hull / sh.hullMax));   // a battered ship shoots less
  return base * (1 + stanceProfile(sh).atk) * FORMATION_SLOTS[shipFormation(sh)].fpMult;   // Line hits hardest, Reserve softest — same tiering Battle Group uses
}
function escortFirepower() { return Math.round(escortFleet().reduce((s, sh) => s + escShipFP(sh), 0) * escortPosture().off); }
function escortAliveFoes() { const w = S.escort && S.escort.wave; return w ? w.foes.filter(f => f.hp > 0) : []; }
// Live threat tracks pirate activity at BOTH ends of the route, so hunting
// pirates there (Raider tab) before you set out genuinely lowers the danger.
function escortLiveThreat(m) {
  const det = 0.22 + 0.11 * ((pirateLevel(m.from) + pirateLevel(m.to)) / 2) + 0.018 * (m.dist || 0);
  return Math.max(0.05, Math.min(0.95, (det + (m.threatRand || 0)) * fxMult("escortThreatMult")));   // Safe Lanes Fortune calms the route
}
function escortUrgencyLabel(slack) { return slack <= 1 ? "🔴 Rush" : slack <= 3 ? "🟠 Standard" : "🟢 Relaxed"; }
function genEscortContract(dest) {
  const here = currentPlanet();
  const dist = (here.distances && here.distances[dest.id]) || 6;
  const legs = Math.max(2, Math.min(5, Math.round(dist / 3) + 1));
  const m = { from: here.id, to: dest.id, dist, legs, threatRand: Math.random() * 0.14 };
  m.threat = escortLiveThreat(m);
  m.payload = Math.round((2000 + dist * 400) * (0.8 + Math.random() * 0.5));
  // how long the client gives you (prep + travel slack): 1 = a rush job, 5 = relaxed
  const slack = rint(1, 5);
  m.cycleBudget = legs + slack;
  m.urgency = slack;
  // reward is a multi-parameter blend — payload, distance, threat, guild rank, a
  // rush premium for tight windows, and a hidden market swing — so two similar
  // postings can pay differently and the true reward/risk ratio stays opaque.
  const rush = 1 + (5 - slack) * 0.07;             // tighter deadline -> rush premium
  const swing = 0.85 + Math.random() * 0.32;       // hidden ± so value isn't transparent
  m.reward = Math.round((m.payload * 0.4 + dist * 280) * (1 + m.threat) * escortRank().mult * rush * swing);
  m.bonus = Math.round(m.reward * 0.3);
  // the convoy burns about as much fuel as a normal one-way jump (+15% for the escort), split over the legs
  m.legFuel = Math.max(1, Math.round(fuelCost(dest.id) * 1.15 / legs));
  return m;
}
function refreshEscortOffers() {
  const e = ensureEscort();
  if (e.active) return;
  const here = currentPlanet();
  const dests = PLANETS.filter(p => isActive(p) && p.id !== here.id && galaxyKnown(p)).sort(() => Math.random() - 0.5).slice(0, 3);
  e.offers = dests.map(genEscortContract);
  // a friendly band may sidle up with a smuggling job — illegal cargo, fat pay, big standing, real heat
  const clients = eligiblePirateClients();
  if (clients.length && e.offers.length && Math.random() < 0.55) {
    const pc = genPirateEscortContract(pick(clients));
    if (pc) e.offers[Math.floor(Math.random() * e.offers.length)] = pc;
  }
  saveGame(); renderEscort();
}
// pirate-proposed smuggling contracts: a band you're friendly with hires YOU to run their contraband
const PIRATE_CARGO = [
  { ico: "🔫", name: "unmarked weapons" },
  { ico: "💊", name: "narcotics" },
  { ico: "🧠", name: "stolen AI cores" },
  { ico: "🛸", name: "black-market drones" },
  { ico: "💎", name: "plundered luxuries" },
];
function eligiblePirateClients() { return bandList().filter(b => b.status === "active" && bandWillAlly(b) && (b.rep || 0) >= 10); }
function genPirateEscortContract(b) {
  const here = currentPlanet();
  const dests = PLANETS.filter(p => isActive(p) && p.id !== here.id && galaxyKnown(p));
  if (!dests.length) return null;
  const dest = pick(dests);
  const m = genEscortContract(dest);
  m.pirate = b.id; m.pirateName = b.name; m.pirateIco = b.ico;
  m.contraband = pick(PIRATE_CARGO);
  m.threatRand = (m.threatRand || 0) + 0.12;            // law interdiction stacked on top of pirate activity
  m.threat = escortLiveThreat(m);
  m.reward = Math.round(m.reward * (1.55 + Math.min(0.4, (b.rep || 0) / 100 * 0.4)));  // pays well — better the tighter you are
  m.bonus = Math.round(m.reward * 0.3);
  m.repBand = 16 + Math.round((b.level || 1) * 2);      // big standing with the crew on delivery
  m.heat = rint(2, 4);                                  // Wanted picked up running it past the patrols
  m.dread = 5 + (b.level || 1);                         // contraband running burnishes your outlaw name
  m.destFaction = dest.faction;
  return m;
}
function buildEscortFleet() {
  const fleet = [{ role: "flagship", name: "Your Flagship", ico: "🚀", formation: "line" }];
  const nEscorts = escortRank().escorts;                  // your guild rank fields a bigger fleet
  for (let i = 0; i < nEscorts; i++) {
    const clsId = pick(["corvette", "frigate", "frigate", "cruiser"]); const cls = SHIP_CLASSES[clsId];
    fleet.push({ role: "escort", cls: clsId, name: `${cls.name} ${String.fromCharCode(65 + i)}`, ico: cls.ico,
      hullMax: Math.round(ESCORT_ESCORT_HULL * cls.hull), str: Math.round(ESCORT_ESCORT_FP * cls.str), alive: true, formation: "line" });
  }
  // freighters default to Reserve — the payload, not the fight; the player can move one forward deliberately
  for (let i = 0; i < ESCORT_FLEET.freighters; i++) {
    fleet.push({ role: "freighter", name: `Freighter ${i + 1}`, ico: "📦",
      hullMax: ESCORT_FREIGHTER_HULL, str: ESCORT_FREIGHTER_FP, alive: true, formation: "reserve" });
  }
  fleet.forEach(sh => { if (sh.role !== "flagship") sh.hull = sh.hullMax; sh.stance = "balanced"; sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; });
  return fleet;
}
function acceptEscort(idx) {
  const e = ensureEscort();
  if (e.active) return toast("Finish your current escort first.", "bad");
  const m = e.offers[idx]; if (!m) return;
  e.active = true;
  e.mission = Object.assign({}, m, { legsLeft: m.legs, losses: 0, deadline: S.turn + (m.cycleBudget || (m.legs + 4)) });
  e.fleet = buildEscortFleet();
  e.wave = null; e.posture = "balanced"; e.targets = []; e.offers = []; e.jam = false; e.fireTarget = "hull";
  e.pool = { weapons: 0, drones: 0, ai: 0 }; e.pendingRedeploy = false;
  const dn = PLANETS.find(p => p.id === m.to).name;
  if (m.pirate) { const b = bandById(m.pirate); if (b) bandRepAdd(b, 4); log(`🏴‍☠️ Took a smuggling run for the ${m.pirateIco} ${m.pirateName} — ${m.contraband.name} to <span class="c">${dn}</span>, ${m.legs} legs, ${fmt(m.reward)} cr.`, "event"); }
  else log(`🛡️ Accepted an escort: convoy to <span class="c">${dn}</span> — ${m.legs} legs, reward ${fmt(m.reward)} cr.`, "event");
  toast(m.pirate ? "Smuggling job accepted." : "Escort contract accepted.", "good");
  sfx("event"); saveGame(); renderAll(); setTab("escort");
}
function spawnEscortWave() {
  const e = ensureEscort(); const m = e.mission;
  const threat = escortLiveThreat(m);                       // reflects any pre-mission clean-up
  const F = Math.max(20, escortFirepower());
  const n = Math.max(2, Math.min(5, Math.round(2 + threat * 3)));
  const lvl = Math.max(1, Math.min(5, 1 + Math.round(threat * 3 + veterancy() * 0.05)));
  const rollRole = () => { const r = Math.random(); return r < 0.55 ? "raider" : r < 0.8 ? "interceptor" : "gunship"; };
  const foes = [];
  for (let i = 0; i < n; i++) {
    const p = genPirate(lvl); const cls = SHIP_CLASSES[p.cls] || SHIP_CLASSES.corvette;
    const maxhp = Math.round(Math.max(18, F * (0.45 + Math.random() * 0.35)));
    foes.push({ name: p.name, ico: p.ico, cls: p.cls, faction: p.faction, strength: p.strength, role: rollRole(),
      hp: maxhp, maxhp, dmg: Math.round(ESCORT_FOE_DMG * cls.str * (0.7 + threat)),
      eng: cls.engines || 1, engMax: cls.engines || 1, dmgMul: 1, vuln: 1,
      cargo: p.cargo || {}, credits: p.credits || 0, bounty: p.bounty || 0 });
  }
  // a dangerous wave is anchored by an elite leader: tougher hull, heavier guns
  let elite = false;
  if (threat >= 0.6 && Math.random() < 0.6) {
    const p = genPirate(Math.min(5, lvl + 1)); const cls = SHIP_CLASSES[p.cls] || SHIP_CLASSES.cruiser;
    const maxhp = Math.round(Math.max(40, F * (0.9 + Math.random() * 0.5)));
    foes.unshift({ name: p.name, ico: ESCORT_FOE_ROLES.elite.ico, cls: p.cls, faction: p.faction, strength: p.strength, role: "elite",
      ability: pick(Object.keys(ESCORT_BOSS_ABILITIES)),
      hp: maxhp, maxhp, dmg: Math.round(ESCORT_FOE_DMG * cls.str * (0.9 + threat) * 1.3),
      eng: (cls.engines || 2) + 1, engMax: (cls.engines || 2) + 1, dmgMul: 1, vuln: 1,
      cargo: p.cargo || {}, credits: Math.round((p.credits || 0) * 1.5), bounty: Math.round((p.bounty || 0) * 1.5) });
    elite = true;
  }
  e.wave = { foes, round: 1 }; e.targets = [];
  assignIntents();
  log(`🚨 Ambush! ${foes.length} hostiles fall on the convoy${elite ? " — led by a ☠️ Marauder Lead" : ""}. Watch their intent and pick your targets.`, "bad");
  toast(`Ambush — ${foes.length} hostiles!`, "bad"); sfx("alarm");
}
function escortAdvance() {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("Beat off the attackers first.", "bad");
  if (inCombat()) return toast("Finish your current engagement first.", "bad");
  const m = e.mission;
  if (m.legsLeft <= 0) return escortDeliver();
  const legFuel = m.legFuel || ESCORT_LEG_FUEL;
  if ((S.res.fuel || 0) < legFuel) return toast(`The convoy needs ${legFuel} fuel to make the next leg.`, "bad");
  S.res.fuel -= legFuel;
  m.legsLeft--;
  endTurn(true);                                          // a leg of the journey is a cycle on the clock
  if (!e.active) return;                                  // the cycle may have tripped the contract deadline
  escortBetrayalCheck();                                  // hired bands may desert between legs
  // deeper in the run, through worse space, the lanes get more dangerous
  const legThreat = Math.min(0.97, escortLiveThreat(m) * (1 + 0.10 * (m.legs - m.legsLeft - 1)));
  if (Math.random() < legThreat) { spawnEscortWave(); saveGame(); renderAll(); return; }
  log(`🛰️ Leg run clean — ${m.legsLeft} to go.`, "");
  toast("Quiet leg.", "");
  if (m.legsLeft <= 0) return escortDeliver();
  saveGame(); renderAll();
}
function escortToggleTarget(i) {
  const e = ensureEscort(); if (!e.wave) return;
  const f = e.wave.foes[i]; if (!f || f.hp <= 0) return;
  e.targets = e.targets || [];
  const at = e.targets.indexOf(i);
  if (at >= 0) e.targets.splice(at, 1); else e.targets.push(i);
  saveGame(); renderEscort();
}
function escortFocus(i) { const e = ensureEscort(); if (e.wave && e.wave.foes[i] && e.wave.foes[i].hp > 0) { e.targets = [i]; saveGame(); renderEscort(); } }
function setEscortTarget(t) { const e = ensureEscort(); if (COMBAT_TARGETS[t]) { e.fireTarget = t; saveGame(); renderEscort(); } }
// what you'd recover from wrecking a foe: its bounty + credits + cargo (into the hold if there's room)
function escortAwardLoot(foe, tally) {
  const cr = Math.round(((foe.bounty || 0) + (foe.credits || 0)) * ESCORT_LOOT_FRAC);
  S.res.credits += cr; tally.credits += cr;
  Object.keys(foe.cargo || {}).forEach(c => {
    const q = Math.min(Math.floor((foe.cargo[c] || 0) * ESCORT_LOOT_FRAC), cargoFree());
    if (q > 0) { S.res[c] = (S.res[c] || 0) + q; tally.cargo[c] = (tally.cargo[c] || 0) + q; }
  });
}
// a foe's drive is crippled once its engines are shot out; with every attacker pinned the convoy can slip away
function escortFoeCrippled(f) { return (f.eng || 0) <= 0; }
function escortCanBreakOff() {
  const w = S.escort && S.escort.wave; if (!w) return false;
  const live = w.foes.filter(f => f.hp > 0);
  return live.length > 0 && live.every(escortFoeCrippled);
}
function escortBreakOff() {
  const e = ensureEscort(); const w = e.wave; if (!w) return;
  if (!escortCanBreakOff()) return toast("The attackers can still give chase — cripple their 🚀 engines first.", "bad");
  e.wave = null; e.targets = [];
  log(`🚀 Their drives crippled, the convoy slips away from the engagement and presses on.`, "good");
  toast("Convoy broke off — attackers left behind.", "good"); sfx("travel");
  if (e.mission.legsLeft <= 0) return escortDeliver();
  saveGame(); renderAll();
}
function escortFire() {
  const e = ensureEscort(); const w = e.wave; if (!w) return;
  let targets = (e.targets || []).filter(i => w.foes[i] && w.foes[i].hp > 0);
  if (!targets.length) targets = w.foes.map((f, i) => (f.hp > 0 ? i : -1)).filter(i => i >= 0);   // default: spread across all
  if (!targets.length) return escortWaveCleared();   // nothing left to shoot — the lane is clear
  let F = escortFirepower();
  if (e.jam) { F = Math.round(F * 0.7); e.jam = false; log("📡 A jammer fouled your firing solution — this salvo lands at 70%.", "bad"); }
  // the flagship expends ammo for its weapon each salvo (escorts/freighters use organic guns)
  if (escShipAlive(escortFleet().find(s => s.role === "flagship") || {})) {
    const fw = escortFlagWeapon(); payAmmo(fw); noteWeaponUse && noteWeaponUse(fw);
  }
  const per = F / targets.length;
  const tgtType = (e.fireTarget && COMBAT_TARGETS[e.fireTarget]) ? e.fireTarget : "hull";
  const killed = [];
  const loot = { credits: 0, cargo: {} };
  const effects = [];
  targets.forEach(i => {
    const f = w.foes[i];
    const hullFactor = tgtType === "hull" ? 1 : 0.5;                 // sub-targeting trades raw damage for an effect
    const dmg = Math.max(1, Math.round(per * hullFactor * (f.vuln || 1) * (0.85 + Math.random() * 0.3)));
    f.hp = Math.max(0, f.hp - dmg);
    if (f.hp > 0) {
      if (tgtType === "weapons") { f.dmgMul = Math.max(0.3, (f.dmgMul || 1) - 0.22); effects.push(`${f.ico}🔫`); }
      else if (tgtType === "defense") { f.vuln = Math.min(1.6, (f.vuln || 1) + 0.15); effects.push(`${f.ico}🛡️`); }
      else if (tgtType === "engines" && (f.eng || 0) > 0) { f.eng = Math.max(0, f.eng - 1); effects.push(`${f.ico}🚀${escortFoeCrippled(f) ? "✖" : ""}`); }
    } else { killed.push(f); escortAwardLoot(f, loot); }
  });
  sfx("salvo");
  const salvage = Object.entries(loot.cargo).map(([c, q]) => `${q}${COM[c].ico}`).join(" ");
  log(`🔥 Fleet salvo (${COMBAT_TARGETS[tgtType].ico} ${COMBAT_TARGETS[tgtType].name}): ${fmt(F)} firepower / ${targets.length} → ${fmt(per)} each${effects.length ? ` · ${effects.join(" ")}` : ""}${killed.length ? ` · destroyed ${killed.map(f => f.ico).join("")}` : ""}${loot.credits ? ` · +${fmt(loot.credits)} cr${salvage ? " salvage " + salvage : ""}` : ""}.`, killed.length ? "good" : "");
  e.targets = (e.targets || []).filter(i => w.foes[i] && w.foes[i].hp > 0);
  if (!escortInCombat()) return escortWaveCleared();
  escortEnemyTurn();
  if (e.active) { saveGame(); renderAll(); }                // ammo/loot changed the hold — refresh all readouts
}
function escortEnemyTurn() {
  const e = ensureEscort(); const w = e.wave; if (!w) return;
  const defMod = escortPosture().def;
  // elite battlefield abilities (telegraphed on its card) fire ~once every other round
  let rally = 1;
  const boss = w.foes.find(f => f.hp > 0 && f.role === "elite" && f.ability);
  if (boss && Math.random() < 0.5) {
    const ab = ESCORT_BOSS_ABILITIES[boss.ability];
    if (boss.ability === "rally") { rally = 1.4; log(`📣 ${boss.ico} ${boss.name} rallies the wave — incoming fire surges!`, "bad"); }
    else if (boss.ability === "jam") { e.jam = true; log(`📡 ${boss.ico} ${boss.name} jams your targeting — your next salvo is weakened.`, "bad"); }
    boss._alpha = boss.ability === "alpha";   // its own hit this round lands double
  }
  w.foes.filter(f => f.hp > 0).forEach(f => {
    if (!e.active) return;                                  // fleet already lost — stop
    const fleet = escortFleet();
    let sh = (f.intent != null && f.intent >= 0 && fleet[f.intent] && escShipAlive(fleet[f.intent])) ? fleet[f.intent] : null;
    if (!sh) sh = fleet[chooseIntent(f)];   // intended target gone — re-pick now
    if (!sh) return;
    let dmg = Math.max(1, Math.round(f.dmg * (f.dmgMul || 1) * (0.7 + Math.random() * 0.6) * defMod * rally));
    if (f._alpha) { dmg = Math.round(dmg * 2); f._alpha = false; log(`💥 ${f.ico} ${f.name} unloads an alpha strike!`, "bad"); }
    dmg = Math.max(1, Math.round(dmg * (1 - stanceProfile(sh).mit)));   // a defensive/balanced stance soaks the hit
    if (sh.role === "flagship") {
      S.pirate.hull = Math.max(0, S.pirate.hull - dmg); clampPirate();
      if (Math.random() < 0.4) damageSubsys(pick(SUBSYS), dmg * 0.6);
      if (S.pirate.hull <= 0) escortFail("flagship");
    } else {
      sh.hull = Math.max(0, sh.hull - dmg);
      if (sh.hull <= 0 && sh.alive) {
        sh.alive = false;
        if (sh.role === "freighter") e.mission.losses++;
        log(`💥 ${sh.ico} ${sh.name} was destroyed!`, "bad"); sfx("explode");
      }
    }
  });
  if (!e.active) return;
  if (w) w.round++;
  if (!escortFleet().some(s => s.role !== "flagship" && s.alive)) return escortFail("convoy");
  assignIntents();                                          // telegraph next round's targets
}
function escortRepair() {
  const e = ensureEscort(); if (!e.wave) return;
  if (!fieldRepairWorthwhile()) return toast("Hull and systems are already sound.", "bad");
  if (!canFieldRepair()) return toast(`Field patch needs ${matsString(FIELD_REPAIR.mats)}.`, "bad");
  Object.entries(FIELD_REPAIR.mats).forEach(([c, q]) => { S.res[c] -= q; });
  const before = S.pirate.hull;
  S.pirate.hull = Math.min(HULL_MAX, S.pirate.hull + FIELD_REPAIR.hull);
  const worst = SUBSYS.reduce((mn, k) => (shipCond(k) < shipCond(mn) ? k : mn), SUBSYS[0]);
  if (shipCond(worst) < 100) S.pirate.subsys[worst] = Math.min(100, S.pirate.subsys[worst] + FIELD_REPAIR.sub);
  log(`🔧 Field patch: +${Math.round(S.pirate.hull - before)} hull — the fleet held fire as the raiders pressed in.`, "");
  sfx("repair");
  escortEnemyTurn();
  if (e.active) { saveGame(); renderAll(); }                // field-repair spent materials — refresh all readouts
}
function setEscortPosture(p) { const e = ensureEscort(); if (ESCORT_POSTURES[p]) { e.posture = p; if (e.wave) assignIntents(); saveGame(); renderEscort(); } }
// Between legs (out of combat) you can patch up the convoy's escorts & freighters
// at a yard cost — a credit/material sink that keeps long, dangerous runs viable.
function escortFleetMissing() { return escortFleet().reduce((s, sh) => s + (sh.role !== "flagship" && sh.alive ? (sh.hullMax - sh.hull) : 0), 0); }
function escortRepairCost() { const miss = escortFleetMissing(); return { miss, credits: Math.round(miss * 7 * 1.5), metals: Math.ceil(miss / 14) * 2, electronics: Math.ceil(miss / 22) * 2 }; }
function escortFleetRepair() {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("You can't run repairs mid-ambush.", "bad");
  const c = escortRepairCost();
  if (c.miss <= 0) return toast("The convoy's escorts and freighters are already sound.", "bad");
  if ((S.res.credits || 0) < c.credits || (S.res.metals || 0) < c.metals || (S.res.electronics || 0) < c.electronics)
    return toast(`Convoy repair needs ${fmt(c.credits)} cr · ${c.metals} ⛓️ · ${c.electronics} 🖥️.`, "bad");
  S.res.credits -= c.credits; S.res.metals -= c.metals; S.res.electronics -= c.electronics;
  escortFleet().forEach(sh => { if (sh.role !== "flagship" && sh.alive) sh.hull = sh.hullMax; });
  log(`🔧 Convoy yard repair: patched the escorts & freighters for ${fmt(c.credits)} cr.`, "good");
  toast("Convoy repaired.", "good"); sfx("repair");
  saveGame(); renderAll();                                  // spent credits + materials — refresh all readouts
}
function escortRecruitBand(id) {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("You can't strike a deal mid-ambush.", "bad");
  const b = bandById(id); if (!b) return;
  if (bandOnMandate(b)) return toast(`The ${b.name} are away on a contract — they can't fly escort right now.`, "bad");
  if (bandBusy(b)) return toast(`The ${b.name} are tied up with their own business right now.`, "bad");
  if (e.fleet.some(s => s.hired && s.bandId === id)) return toast(`The ${b.name} already flies with you.`, "bad");
  if (e.fleet.filter(s => s.hired && !s.support && s.alive).length >= ESCORT_MAX_HIRED) return toast(`You can field at most ${ESCORT_MAX_HIRED} hired bands — dismiss one first.`, "bad");
  const rival = bandFoe(b);
  if (rival && e.fleet.some(s => s.hired && s.alive && s.bandId === rival.id)) return toast(`The ${b.name} won't fly with their blood rivals the ${rival.name}.`, "bad");
  const fee = escortRecruitFee(b);
  if ((S.res.credits || 0) < fee) return toast(`The ${b.name} wants ${fmt(fee)} cr up front.`, "bad");
  S.res.credits -= fee;
  const sh = { role: "escort", hired: true, bandId: id, name: b.name, ico: b.ico,
    hullMax: Math.round(ESCORT_ESCORT_HULL * (0.9 + b.level * 0.25)),
    str: Math.round(ESCORT_ESCORT_FP * (0.9 + b.level * 0.3) * bandPers(b).fp), alive: true,
    stance: "balanced", fit: { aggressive: 0, balanced: 0, defensive: 0 } };
  sh.hull = sh.hullMax; e.fleet.push(sh);
  bandRepAdd(b, 5); b.lastSeen = S.turn || 0;
  if (rival) bandRepAdd(rival, -8);                        // hiring a crew slights its rival
  log(`🤝 Hired the ${b.ico} ${b.name} as an escort for ${fmt(fee)} cr — ${bandBetrayChance(b) > 0.18 ? "watch them, their loyalty's thin." : "a dependable crew."}`, "event");
  toast(`${b.name} hired (${fmt(fee)} cr)`, "good"); sfx("event"); saveGame(); renderAll();
}
function escortDismissBand(id) {                          // let a hired crew go to free a slot (fee already paid, no refund)
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("You can't dismiss a crew mid-ambush.", "bad");
  const idx = e.fleet.findIndex(s => s.hired && s.alive && s.bandId === id); if (idx < 0) return;
  const sh = e.fleet[idx]; const b = bandById(id);
  e.fleet.splice(idx, 1);                                   // stance fit is spent (no refund)
  log(`👋 You released the ${sh.ico} ${sh.name} from the contract.`, "");
  toast(`${b ? b.name : sh.name} dismissed`, ""); saveGame(); renderAll();
}
// bring an ON-CALL band into the convoy as a free volunteer escort for the run
function escortRallyOnCall(id) {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("Wait for a lull to bring them in.", "bad");
  const b = bandById(id); if (!b || !bandOnCall(b)) return toast("They aren't standing by.", "bad");
  if (e.fleet.some(s => s.hired && s.alive && s.bandId === id)) return toast(`The ${b.name} already fly with you.`, "bad");
  const rival = bandFoe(b);
  if (rival && e.fleet.some(s => s.hired && s.alive && s.bandId === rival.id)) return toast(`The ${b.name} won't fly with their rivals the ${rival.name}.`, "bad");
  const sh = { role: "escort", hired: true, support: true, bandId: id, name: b.name, ico: b.ico,
    hullMax: Math.round(ESCORT_ESCORT_HULL * (0.9 + b.level * 0.25)),
    str: Math.round(ESCORT_ESCORT_FP * (0.9 + b.level * 0.3) * bandPers(b).fp), alive: true,
    stance: "balanced", fit: { aggressive: 0, balanced: 0, defensive: 0 } };
  sh.hull = sh.hullMax; e.fleet.push(sh);
  b.onCallUntil = 0; b.follow = false; b.followUntil = 0; bandRepAdd(b, 4);   // they've thrown in with the convoy
  log(`🤝 The ${b.ico} ${b.name} fall in as volunteer escorts for the run.`, "event");
  toast(`${b.name} joined the convoy`, "good"); sfx("event"); saveGame(); renderAll();
}
function escortBetrayalCheck() {                          // cheap loyalties bolt when the going gets tough
  const e = ensureEscort();
  (e.fleet || []).filter(s => s.hired && !s.support && s.alive).forEach(s => {   // free volunteers don't betray
    const b = bandById(s.bandId); if (!b) return;
    if (Math.random() < bandBetrayChance(b)) {
      s.alive = false; s.betrayed = true; bandRepAdd(b, -12);
      // a greedy/cunning turncoat doesn't just leave — it makes off with a freighter
      const loot = bandPers(b).steal ? e.fleet.find(x => x.role === "freighter" && x.alive) : null;
      if (loot) {
        loot.alive = false; e.mission.losses = (e.mission.losses || 0) + 1; bandRepAdd(b, -8);
        log(`🏴‍☠️ The ${s.ico} ${s.name} turned coat and made off with ${loot.ico} ${loot.name} and its cargo!`, "bad");
        toast(`${s.name} stole a freighter!`, "bad"); sfx("explode");
      } else {
        log(`🏴‍☠️ The ${s.ico} ${s.name} broke their contract and slipped away — cheap loyalty cuts both ways.`, "bad");
        toast(`${s.name} deserted!`, "bad");
      }
    }
  });
}
function escortWaveCleared() {
  const e = ensureEscort();
  e.wave = null; e.targets = [];
  const dn = PLANETS.find(p => p.id === e.mission.to).name;
  log(`✅ Ambush beaten off — ${e.mission.legsLeft} leg(s) to ${dn}.`, "good");
  toast("Attackers driven off!", "good"); sfx("good");
  if (e.mission.legsLeft <= 0) return escortDeliver();
  saveGame(); renderAll();
}
function escortDeliver() {
  const e = ensureEscort(); const m = e.mission; if (!m) return;
  const totalFr = e.fleet.filter(s => s.role === "freighter").length;
  const aliveFr = e.fleet.filter(s => s.role === "freighter" && s.alive).length;
  const frac = totalFr ? aliveFr / totalFr : 1;
  let pay = Math.round(m.reward * frac);
  const flawless = m.losses === 0 && e.fleet.every(s => s.role === "flagship" || s.alive);
  if (flawless) pay += m.bonus;
  // promptness: cycles left under the deadline pay a quiet bonus — so the time you
  // spend prepping trades against a faster, better-paid delivery (and isn't advertised)
  const spare = m.deadline != null ? Math.max(0, m.deadline - S.turn) : 0;
  const promptBonus = spare > 0 ? spare * Math.round(m.reward * 0.03) : 0;
  pay += promptBonus;
  S.res.credits += pay;
  const beforeRank = escortRankIndex();
  S.location = m.to;
  const dn = PLANETS.find(p => p.id === m.to).name;
  let repGain = 0;
  if (m.pirate) {
    // a smuggling run: no legit guild/faction credit — instead crew standing, Dread, heat and angry authorities
    const b = bandById(m.pirate);
    if (b) bandRepAdd(b, m.repBand || 16);
    S.pirate.wanted = Math.min(100, S.pirate.wanted + (m.heat || 2));
    S.pirate.dread += (m.dread || 5);
    if (m.destFaction) addRep(m.destFaction, -8);
    clampPirate();
    e.fleet.filter(s => s.hired && s.alive).forEach(s => { const hb = bandById(s.bandId); if (hb) bandRepAdd(hb, 8); });
    log(`🏴‍☠️ Ran the ${b ? b.ico + " " + b.name : "crew"}'s ${m.contraband ? m.contraband.ico + " " + m.contraband.name : "contraband"} into <span class="c">${dn}</span>! Paid ${fmt(pay)} cr${flawless ? " · ✨ flawless" : ""}${promptBonus ? ` · ⏱️ +${fmt(promptBonus)}` : ""}. ${b ? b.name + " standing +" + (m.repBand || 16) : ""} · +${m.dread || 5} Dread · +${m.heat || 2} Wanted.`, "event");
    toast(`Smuggling run done: +${fmt(pay)} cr`, "good");
  } else {
    addRep("frontier", 4); addRep("core", 2);
    // Escort Guild reputation — scaled by risk and how much cargo you saved
    repGain = Math.round((10 + m.threat * 40) * frac) + (flawless ? 10 : 0);
    S.escortRep = (S.escortRep || 0) + repGain;
    e.fleet.filter(s => s.hired && s.alive).forEach(s => { const b = bandById(s.bandId); if (b) bandRepAdd(b, 8); });   // paid, fought, and made port together
    log(`🏁 Convoy delivered to <span class="c">${dn}</span>! Paid ${fmt(pay)} cr (${aliveFr}/${totalFr} freighters)${flawless ? " · ✨ flawless bonus" : ""}${promptBonus ? ` · ⏱️ +${fmt(promptBonus)} prompt` : ""}. Guild standing +${repGain}.`, "good");
    toast(`Escort complete: +${fmt(pay)} cr`, "good");
  }
  if (typeof announce === "function") announce("🏁 Convoy Delivered", `${aliveFr}/${totalFr} freighters made port. Fee ${fmt(pay)} cr${flawless ? " + flawless bonus" : ""}.`, false);
  sfx("good");
  const spent = escortDiscardOutfit();
  if (spent > 0) log(`🔧 The convoy expended ${spent} outfitted system(s) over the run.`, "");
  releaseFleetEscorts(e);
  e.active = false; e.mission = null; e.fleet = []; e.wave = null; e.targets = []; e.jam = false; e.pendingRedeploy = false;
  if (escortRankIndex() > beforeRank) {
    const rk = escortRank();
    log(`🎖️ Escort Guild promotion — you're now a <b>${rk.name}</b>: ${Math.round((rk.mult - 1) * 100)}% better pay and a fleet of ${rk.escorts} escorts.`, "event");
    if (typeof announce === "function") announce("🎖️ Guild Promotion", `You are now a ${rk.name}. Better contracts and a larger fleet await.`, false);
    toast(`Promoted: ${rk.name}!`, "good"); sfx("promote");
  }
  saveGame(); renderAll();
}
function abortEscort() {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("You can't abandon the convoy mid-ambush.", "bad");
  const fee = Math.min(S.res.credits, Math.round(e.mission.reward * 0.2));
  S.res.credits -= fee;
  if (e.mission.pirate) { const b = bandById(e.mission.pirate); if (b) { bandRepAdd(b, -14); log(`🚪 You ditched the ${b.ico} ${b.name}'s contraband run — forfeit ${fmt(fee)} cr and their trust.`, "bad"); } }
  else log(`🚪 You abandoned the escort — forfeit ${fmt(fee)} cr.`, "bad");
  toast("Escort abandoned.", "bad");
  escortDiscardOutfit();
  releaseFleetEscorts(e);
  e.active = false; e.mission = null; e.fleet = []; e.wave = null; e.targets = []; e.pendingRedeploy = false;
  saveGame(); renderAll();
}
function escortFail(reason) {
  const e = ensureEscort();
  if (reason === "flagship") {
    S.pirate.hull = 30; clampPirate();
    SUBSYS.forEach(k => damageSubsys(k, 12 + Math.random() * 18));
    log(`💥 Your flagship buckled — the convoy scattered and the contract is lost.`, "bad");
    if (typeof announce === "function") announce("💥 Escort Failed", "Your flagship gave out and the convoy scattered. No fee.", true);
  } else if (reason === "timeout") {
    log(`⏰ The escort contract lapsed before the convoy reached port — the client cancelled. No fee.`, "bad");
    if (typeof announce === "function") announce("⏳ Escort Expired", "You ran out the clock before delivering. The contract is void.", true);
  } else {
    log(`🏳️ The convoy was wiped out — escort failed.`, "bad");
    if (typeof announce === "function") announce("💥 Escort Failed", "Every ship you were guarding is gone. No fee.", true);
  }
  toast(reason === "timeout" ? "Escort contract expired." : "Escort failed.", "bad"); sfx(reason === "timeout" ? "bad" : "explode");
  if (e.mission && e.mission.pirate) { const b = bandById(e.mission.pirate); if (b) { bandRepAdd(b, -12); log(`🏴‍☠️ Losing the ${b.name}'s cargo cost you dearly with them.`, "bad"); } }
  escortDiscardOutfit();
  releaseFleetEscorts(e);
  e.active = false; e.mission = null; e.fleet = []; e.wave = null; e.targets = []; e.pendingRedeploy = false;
}
function escortDeadlineCheck() {
  const e = S.escort;
  if (!e || !e.active || !e.mission || e.mission.deadline == null) return;
  if (S.turn > e.mission.deadline && !escortInCombat()) escortFail("timeout");   // don't yank a convoy mid-ambush
}

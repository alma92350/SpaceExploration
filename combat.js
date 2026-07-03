/* ============================================================
   STELLAR FRONTIER — combat: piracy, raiding, ship-to-ship engagements
   Prowl the lanes, ambush and be ambushed, hunt pirates for lawful bounty.
   Ship subsystem condition (weapons/shields/engines/sensors) wears down
   under fire and degrades what it governs; an energy budget splits between
   offense and defense; typed weapons vs typed defenses reward a Deep Scan
   and the right counter; adversary matchmaking tracks the captain's own
   strength, with veterancy pushing bigger hulls and named elite captains;
   multi-vessel engagements let a coalition victim call in same-faction
   rescuers, or let the player call nearby pirates to their side.

   Loaded after resources.js, before game.js. fxMult, battleGroupScreenMult,
   escortInCombat, renderRaid, saveGame, digestNote, spawnSignal, bindBand,
   plunder, raidJoinFollowers, startInterdiction, releaseBattleGroup, unlock,
   setTab, convoyGuardCount and convoyAmbushRisk still live in game.js/fleet.js
   at this point in the split — safe, since every function here is only
   CALLED later, once every script has finished loading, same pattern as
   every prior slice.
   ============================================================ */

"use strict";

const HULL_MAX = 100;
const PROWL_FUEL = 6;
function clampPirate() {
  const P = S.pirate;
  P.wanted = Math.max(0, Math.min(100, P.wanted));
  P.dread = Math.max(0, Math.min(100, P.dread));
  P.hull = Math.max(0, Math.min(HULL_MAX, P.hull));
}
function raidPower() {
  return 6 + S.upgrades.cannons * 9 * trimMult("firepower") + S.pirate.dread * 0.15 + (S.techs.weapontech ? 6 : 0);
}
/* ---------- Ship subsystem condition (Phase 1 combat) ----------
   Combat is no longer a single coin-flip: foes have hull (HP) worn down over
   free rounds, and incoming fire damages not just your hull but your
   subsystems — weapons (your damage), shields (mitigation), engines (flee
   odds) and sensors (deep scan). Degraded systems work worse, so a hard
   fight has a lasting, genuinely punishing cost: repairs in credits AND
   materials, paid between raids — which means raiding can't be a free money
   fountain. */
const SUBSYS = ["weapons", "shields", "engines", "sensors"];
const SUBSYS_META = {
  weapons: { ico: "🔫", name: "Weapons", mat: "metals" },
  shields: { ico: "🔰", name: "Shields", mat: "electronics" },
  engines: { ico: "🚀", name: "Engines", mat: "metals" },
  sensors: { ico: "📡", name: "Sensors", mat: "electronics" },
};
const FOE_HP_MULT = 1.7;        // a foe's hull ≈ strength × this
function initSubsys() {
  if (!S.pirate.subsys) S.pirate.subsys = {};
  SUBSYS.forEach(k => { if (S.pirate.subsys[k] == null) S.pirate.subsys[k] = 100; });
}
function shipCond(sub) { initSubsys(); return S.pirate.subsys[sub]; }
function condFactor(sub) { return 0.35 + 0.65 * (shipCond(sub) / 100); }   // 35% effective when wrecked
function damageSubsys(sub, amt) { initSubsys(); S.pirate.subsys[sub] = Math.max(0, Math.round(S.pirate.subsys[sub] - amt)); }
const COMBAT_ROUNDS_TARGET = 3.6;     // a fair fight should last about this many rounds
function bestWeaponMult() {
  let m = 1; Object.keys(WEAPONS).forEach(w => { if (weaponAvailable(w)) m = Math.max(m, WEAPONS[w].mult); });
  return m;
}
// your realistic per-round damage ceiling (best weapon, drones, offense budget)
function estPlayerDPS() {
  const droneF = 1 + (S.upgrades.dronebay || 0) * 0.12;
  return (raidPower() * 0.55 + 4) * Math.max(0.5, offenseMult()) * bestWeaponMult() * droneF;
}
function foeHp(foe) {
  if (foe.hp == null) {
    const hm = foe.hullMult || 1;
    const base = foe.strength * FOE_HP_MULT * hm;               // hull class drives the length of big-ship fights
    const scaled = estPlayerDPS() * COMBAT_ROUNDS_TARGET;       // rubber-band floor so nothing is one-shot (class-independent)
    foe.maxhp = Math.max(8, Math.round(Math.max(base, scaled) * (1 + 0.4 * (foe.escorts || 0))));
    foe.hp = foe.maxhp;
  }
  return foe.hp;
}
// one player attack round: returns damage dealt to the foe
function playerStrikes(foe, wkey) {
  const drones = droneStrike(foe);
  if (drones.lost > 0) S.res.drones -= drones.lost;
  const base = (raidPower() * 0.55 + Math.random() * 8) * condFactor("weapons") * offenseMult() * fxMult("weaponMult");
  const dmg = Math.max(1, Math.round(base * weaponEff(wkey, foe) + drones.bonus));
  return { dmg, drones };
}
// one foe counter-attack: hull damage + a chance to wound a subsystem
function foeStrikes(foe, intensity) {
  const postureFactor = Math.max(0.5, Math.min(1.8, 1 / Math.max(0.4, defenseMult())));   // evasive soaks, aggressive exposes
  intensity *= (1 + 0.12 * (foe.escorts || 0));                                            // escorts pile on
  const raw = foe.strength * intensity * (0.7 + Math.random() * 0.6) * postureFactor * fxMult("incomingMult") * battleGroupScreenMult();
  let dmg = takeTypedDamage(raw, foe.wtype);
  const floor = Math.round(foe.strength * 0.06 * postureFactor);   // some fire always gets through
  if (dmg < floor) { const extra = floor - dmg; S.pirate.hull = Math.max(0, S.pirate.hull - extra); clampPirate(); if (S.pirate.hull <= 0) shipCrippled(); dmg = floor; }
  let subHit = null;
  if (Math.random() < 0.55 && dmg > 0) {                 // genuinely punishing: most hits scar a system
    subHit = pick(SUBSYS);
    damageSubsys(subHit, dmg * (0.5 + Math.random() * 0.5));
  }
  return { dmg, subHit };
}
function subsysHitLog(hit) {
  if (!hit) return "";
  const m = SUBSYS_META[hit];
  return ` · ${m.ico} ${m.name} damaged (${shipCond(hit)}%)`;
}
/* ---------- Phase 2: energy budget & targeting ----------
   Each round you divide a power budget between offense and defense (presets
   for one-tap play, an advanced slider for fine control) and choose what to
   shoot: the foe's hull (kill), its weapons (blunt its return fire) or its
   defenses (strip armor/shields so your hits land harder). Reactor and AI
   Mainframe raise the budget, so those upgrades buy tactical headroom. */
const COMBAT_PRESETS = {
  aggressive: { offense: 70, label: "⚔️ Aggressive", hint: "max damage, thin defenses" },
  balanced:   { offense: 50, label: "⚖️ Balanced",   hint: "even split" },
  evasive:    { offense: 30, label: "🛡️ Evasive",    hint: "soak hits, better escape" },
};
const COMBAT_TARGETS = {
  hull:    { ico: "🎯", name: "Hull",     hint: "full damage — destroy it fastest" },
  weapons: { ico: "🔫", name: "Weapons",  hint: "half damage, but blunts its return fire" },
  defense: { ico: "🛡️", name: "Defenses", hint: "half damage, but strips armor/shields" },
  engines: { ico: "🚀", name: "Engines",  hint: "half damage, but cripples its drive so it can't jump away" },
};
function combatState() {
  if (!S.combat) S.combat = { posture: "balanced", offense: 50, target: "hull", advanced: false };
  return S.combat;
}
function combatBudget() { return 100 + (S.upgrades.reactor || 0) * 6 + (S.upgrades.aimain || 0) * 5; }
function offenseMult() { const c = combatState(); return (combatBudget() / 100) * (c.offense / 50); }
function defenseMult() { const c = combatState(); return (combatBudget() / 100) * ((100 - c.offense) / 50); }
function setCombatPosture(p) {
  const c = combatState(), pre = COMBAT_PRESETS[p];
  if (pre) { c.posture = p; c.offense = pre.offense; c.advanced = false; }
  renderRaid(); saveGame();
}
function setCombatOffense(v) {
  const c = combatState(); c.offense = Math.max(0, Math.min(100, Math.round(+v))); c.advanced = true;
  c.posture = c.offense >= 65 ? "aggressive" : c.offense <= 35 ? "evasive" : "balanced";
  renderRaid(); saveGame();
}
function setCombatTarget(t) { if (COMBAT_TARGETS[t]) { combatState().target = t; renderRaid(); saveGame(); } }
// apply a strike to the foe per the chosen target; returns what was hit
const DEF_LAYER_NAME = { armor: "🛡️ armor", shield: "🔰 shields", pd: "📡 point-defense" };
// returns { hullDmg, note } — note describes the special effect with before→after numbers
function applyTargetedDamage(foe, dmg) {
  const c = combatState();
  if (c.target === "weapons") {
    const hullDmg = Math.max(1, Math.round(dmg * 0.5));
    foe.hp = foeHp(foe) - hullDmg;
    const before = foe.strength;
    foe.strength = Math.max(4, Math.round(foe.strength - dmg * 0.3));
    const drop = before - foe.strength;
    return { hullDmg, note: drop > 0 ? ` · 🔫 crippled its guns — strength ${before}→${foe.strength}, its fire weakens` : "" };
  }
  if (c.target === "defense") {
    const hullDmg = Math.max(1, Math.round(dmg * 0.5));
    foe.hp = foeHp(foe) - hullDmg;
    const layer = ["shield", "armor", "pd"].reduce((m, k) => ((foe.def[k] || 0) > (foe.def[m] || 0) ? k : m), "shield");
    if ((foe.def[layer] || 0) > 0) { const b = foe.def[layer]; foe.def[layer] -= 1; return { hullDmg, note: ` · ${DEF_LAYER_NAME[layer]} breached ${b}→${foe.def[layer]} — your hits now bite deeper` }; }
    return { hullDmg, note: " · its defenses are already stripped" };
  }
  if (c.target === "engines") {
    const hullDmg = Math.max(1, Math.round(dmg * 0.5));
    foe.hp = foeHp(foe) - hullDmg;
    if ((foe.engines || 0) > 0) { const b = foe.engines; foe.engines = Math.max(0, foe.engines - 1); return { hullDmg, note: foe.engines === 0 ? " · 🚀 drive knocked out — it's pinned, no escape" : ` · 🚀 drive hit ${b}→${foe.engines} — cripple it fully to pin it` }; }
    return { hullDmg, note: " · 🚀 its drive is already dead" };
  }
  const hullDmg = Math.max(1, Math.round(dmg));
  foe.hp = foeHp(foe) - hullDmg;
  return { hullDmg, note: "" };
}
/* a foe with working engines tries to jump away when it's losing badly */
function foeFleeCheck(foe) {
  if ((foe.engines || 0) <= 0) return false;                    // pinned
  foeHp(foe);
  const thresh = foe.jumpPrimed ? 0.6 : 0.4;                    // a scan-spooked ship bolts earlier
  if (foe.hp / foe.maxhp > thresh) return false;
  const cls = SHIP_CLASSES[foe.cls] || SHIP_CLASSES.corvette;
  const chance = cls.flee * (foe.engines / (foe.enginesMax || 1)) * (foe.jumpPrimed ? 1.4 : 1);
  return Math.random() < chance;
}
/* ---------- Combat lockdown ----------
   An ambush or interdiction is a STANDOFF: until it's resolved you can't
   shop, refit, repair, produce, research, move goods or end the cycle —
   no slipping away to re-arm against the threat. You can always resolve it
   without resources (flee/fight are free; complying needs no purchase). */
function inCombat() { return !!(S.encounter || S.interdiction || S.prey || (typeof escortInCombat === "function" && escortInCombat())); }
function combatHomeTab() { return (typeof escortInCombat === "function" && escortInCombat() && !(S.encounter || S.interdiction || S.prey)) ? "escort" : "raid"; }
let _combatLockToastAt = 0;
function combatLocked() {
  if (!inCombat()) return false;
  // combatLocked() guards many actions and can fire several times in one gesture;
  // debounce so the "you're in combat" toast shows once, not a stutter of duplicates.
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - _combatLockToastAt > 600) {
    _combatLockToastAt = now;
    const foe = S.encounter ? `the ${S.encounter.name}` : S.prey ? `the ${S.prey.name}` : (typeof escortInCombat === "function" && escortInCombat()) ? "the convoy's attackers" : "the navy patrol";
    toast(`⚔️ Still in the fight with ${foe} — finish it or break off first.`, "bad");
  }
  return true;
}
/* how hard the law is hunting you, by Wanted level */
function notoriety() {
  const w = S.pirate ? S.pirate.wanted : 0;
  if (w >= 80) return { tier: 4, label: "Most Wanted", col: "var(--bad)" };
  if (w >= 55) return { tier: 3, label: "Notorious",   col: "var(--bad)" };
  if (w >= 30) return { tier: 2, label: "Wanted",      col: "var(--warn)" };
  if (w >= 10) return { tier: 1, label: "Petty Crook", col: "var(--warn)" };
  return { tier: 0, label: "Unknown", col: "var(--good)" };
}
function dmgReduction() { return Math.min(0.6, S.upgrades.shield * 0.18) * condFactor("shields"); }

/* ------------------------------------------------------------
   TACTICAL COMBAT — typed weapons vs typed defenses
   Every foe carries a defense profile (armor / shields / point-defense, 0-3)
   and fights with a weapon class of its own. You pick your weapon per attack:
   ammo comes from your hold, effectiveness depends on what the target is
   hardened against — Deep Scan reveals the profile so you can pick the
   counter. Damage you take is typed too: Armor Plating blunts kinetic,
   shields soak energy, the Point-Defense Grid swats guided munitions.
   ------------------------------------------------------------ */
const WEAPONS = {
  kinetic:    { name: "Kinetic Cannons",     ico: "🔫", mult: 1.0,  ammo: {},                              counter: "armor",  req: null },
  energy:     { name: "Energy Lance",        ico: "⚡", mult: 1.2,  ammo: { energy: 5 },                   counter: "shield", req: "energyweapons" },
  torpedo:    { name: "Fusion Torpedoes",    ico: "☢️", mult: 1.45, ammo: { radioactives: 2, metals: 2 },  counter: "pd",     req: "torpedoes" },
  antimatter: { name: "Antimatter Warhead",  ico: "🌀", mult: 1.95, ammo: { antimatter: 1 },               counter: null,     req: "antimatter" },
  // the biggest stick in the rack — beats the warhead on raw yield, but it IS a
  // torpedo: point-defense thins it, where the warhead can't be countered at all
  plasma:     { name: "Plasma Torpedoes",    ico: "💥", mult: 2.4,  ammo: { plasmatorp: 1 },               counter: "pd",     req: "antimatter" },
};
function weaponAvailable(w) { const W = WEAPONS[w]; return !W.req || !!S.techs[W.req]; }
function weaponAffordable(w) { return Object.entries(WEAPONS[w].ammo).every(([c, q]) => (S.res[c] || 0) >= q); }
function weaponEff(w, foe) {
  const W = WEAPONS[w];
  const resist = W.counter && foe.def ? (foe.def[W.counter] || 0) : 0;
  return W.mult * (1 - resist * 0.13);                   // hardened targets shrug off the countered class
}
function payAmmo(w) { Object.entries(WEAPONS[w].ammo).forEach(([c, q]) => { S.res[c] -= q; }); }
// foe defense profile + weapon class, scaled to its strength/locale
function genFoeProfile(kind, strength, law) {
  const grade = Math.min(3, Math.floor(strength / 18));
  const def = { armor: 0, shield: 0, pd: 0 };
  if (kind === "hauler" || kind === "collapse" || kind === "pirate") def.armor = Math.min(3, grade + 1);
  else if (kind === "patrol" || kind === "liner") def.shield = Math.min(3, grade + 1);
  else def[pick(["armor", "shield", "pd"])] = grade;
  if (grade >= 2) def[pick(["armor", "shield", "pd"])] = Math.max(def[pick(["armor", "shield", "pd"])] || 0, grade - 1);
  const wtype = kind === "patrol" ? (law >= 0.5 ? "guided" : "energy")
    : kind === "pirate" ? pick(["kinetic", "kinetic", "guided"])
    : pick(["kinetic", "energy"]);
  return { def, wtype };
}
function bestWeaponHint(foe) {
  let best = "kinetic", bestEff = 0;
  Object.keys(WEAPONS).forEach(w => {
    if (!weaponAvailable(w)) return;
    const e = weaponEff(w, foe);
    if (e > bestEff) { bestEff = e; best = w; }
  });
  return WEAPONS[best];
}
// typed incoming damage: your specialized defenses blunt the matching class
function takeTypedDamage(amount, wtype) {
  if (wtype === "kinetic") amount *= 1 - Math.min(0.36, S.upgrades.armor * 0.12);
  else if (wtype === "guided") amount *= 1 - Math.min(0.36, S.upgrades.pointdef * 0.12);
  return takeHullDamage(amount);                          // shields (generic) apply inside as before
}
function dronesDeployable() { return Math.min((S.upgrades.dronebay || 0) * 2, S.res.drones || 0); }
function droneStrike(foe) {
  const n = dronesDeployable();
  if (n <= 0) return { n: 0, bonus: 0, lost: 0 };
  const pd = (foe.def && foe.def.pd) || 0;
  const eff = (2.5 + (S.upgrades.aimain || 0) * 0.75) * (1 - pd * 0.15);   // AI flies them better; flak thins them
  const lost = Math.min(n, rint(0, Math.ceil(n * 0.25 + pd * 0.5)));
  return { n, bonus: n * eff, lost };
}
function deepScan() {
  const t = S.prey || S.encounter;
  if (!t) return toast("Nothing to scan.", "bad");
  if (t.scanned) return toast("Already scanned.", "bad");
  if (shipCond("sensors") < 25) return toast("Sensors too damaged to deep-scan — repair them first.", "bad");
  const free = S.upgrades.aimain >= 1;
  if (!free && (S.res.energy || 0) < 4) return toast("Deep scan needs 4 ⚡ energy (or an AI Mainframe).", "bad");
  if (!free) S.res.energy -= 4;
  t.scanned = true;
  const hint = bestWeaponHint(t);
  log(`🔍 Deep scan complete: ${t.name} — strength ${t.strength}, armor ${t.def.armor}, shields ${t.def.shield}, point-defense ${t.def.pd}; fights with ${t.wtype} weapons. Recommended: ${hint.ico} ${hint.name}.`, "");
  toast("Scan complete.", "");
  // a painted ship with a live drive reacts: it may bolt outright, or spin up to jump sooner
  if ((t.engines || 0) > 0) {
    const cls = SHIP_CLASSES[t.cls] || SHIP_CLASSES.corvette;
    if (Math.random() < cls.flee * 0.5) {
      log(`🏃 Your active scan spooked the ${t.ico} ${t.name} — it lit its drive and jumped clear before you could close. Should've crippled its 🚀 engines first.`, "bad");
      toast(`${t.name} bolted during the scan!`, "bad");
      if (S.encounter === t) S.encounter = null; else if (S.prey === t) S.prey = null;
      return afterAction();
    }
    t.jumpPrimed = true;     // spooked — readier to run
    log(`⚠️ The scan put the ${t.name} on alert — its drive is spinning up. It'll try to jump sooner now.`, "");
  }
  afterAction();
}
/* prey archetypes — cutthroat buffet: bulk haulers, fat liners, hard patrols */
const PREY = {
  hauler:   { name: "Ore Hauler",    ico: "🛻", faction: "miners",    base: 10, wanted: 5,  credits: [200, 600],   goods: ["ore", "metals", "ice"],            bulk: [12, 26] },
  merchant: { name: "Merchant Freighter", ico: "🚚", faction: null,   base: 16, wanted: 8,  credits: [400, 1100],  goods: ["goods", "machinery", "electronics", "chemicals"], bulk: [9, 20] },
  liner:    { name: "Luxury Liner",  ico: "🛳️", faction: "core",      base: 20, wanted: 16, credits: [1700, 3400], goods: ["luxury", "medicine", "spice"],     bulk: [8, 16] },
  smuggler: { name: "Smuggler Runner", ico: "🏴", faction: "frontier", base: 11, wanted: 3, credits: [400, 1100],  goods: ["relics", "spice", "radioactives", "chemicals"], bulk: [6, 13] },
  patrol:   { name: "Faction Patrol", ico: "🚔", faction: null,       base: 28, wanted: 14, credits: [300, 800],   goods: ["weapons", "fuel"],                 bulk: [4, 10] },
};
function rint(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }

/* ------------------------------------------------------------
   PIRATE HUNTING — the raider's lawful trade
   Worlds carry a pirate-activity level (0–5). Hunting pirates through the
   Raid UI pays a level-scaled bounty, earns goodwill instead of Wanted, and
   suppresses pirate attacks (colony raids, convoy & travel ambushes) for a
   while. Activity regrows in lawless space — pirates breed where law is thin.
   ------------------------------------------------------------ */
const PIRATE_RANKS = [null,
  { name: "Rookie Corsair",  ico: "🏴", str: 16, bounty: 450 },
  { name: "Marauder",        ico: "🏴", str: 26, bounty: 900 },
  { name: "Veteran Raider",  ico: "☠️", str: 36, bounty: 1500 },
  { name: "Dread Captain",   ico: "☠️", str: 47, bounty: 2400 },
  { name: "Pirate Warlord",  ico: "👿", str: 58, bounty: 3600 },
];
function basePirateLevel(p) { return p.bounty ? 3 : p.enforce <= 0.3 ? 1 : 0; }
function pirateLevel(pid) {
  if (!S.pirates) S.pirates = {};
  const p = PLANETS.find(x => x.id === pid);
  if (S.pirates[pid] == null) S.pirates[pid] = basePirateLevel(p);
  return S.pirates[pid];
}
function pirateCalm() { return (S.pirateCalm || 0) > S.turn; }
/* ---------- Pirate intel charts ----------
   Buy charts that reveal pirate activity by world for a while — find the
   hotspots to hunt (toward pacifying the sector) or the lanes to avoid. */
const PIRATE_MAP = {
  local:    { name: "Local chart",    ico: "🗺️", ly: 6,        cost: 700 },
  regional: { name: "Regional chart", ico: "🗺️", ly: 14,       cost: 2200 },
  global:   { name: "Sector chart",   ico: "🛰️", ly: Infinity, cost: 5500 },
  // top tier: the Sector chart's coverage PLUS every hidden world you've discovered —
  // frontier-ring worlds keep `hidden: true` forever (visibility flows through
  // S.discovered), so no ordinary chart can ever include them. Offered only once
  // you've actually found an edge world (edgeIntelUnlocked), since a cartographer
  // can't sell you intel on space nobody's charted.
  deepspace: { name: "Deep-space chart", ico: "🧭", ly: Infinity, cost: 8500, frontier: true },
};
const PIRATE_INTEL_DURATION = 8;   // cycles of fresh intel per purchase
function pirateIntelActive() { return !!(S.pirateIntel && S.turn < S.pirateIntel.until); }
function pirateIntelKnows(pid) { return pid === S.location || (pirateIntelActive() && S.pirateIntel.worlds.indexOf(pid) >= 0); }
function edgeIntelUnlocked() { return PLANETS.some(p => p.frontier && S.discovered && S.discovered[p.id]); }
function buyPirateMap(scope) {
  const m = PIRATE_MAP[scope]; if (!m) return;
  if (m.frontier && !edgeIntelUnlocked()) return toast("No edge worlds discovered yet — chase deep-space signals beyond the charted sector first.", "bad");
  if (S.res.credits < m.cost) return toast(`The ${m.name} costs ${fmt(m.cost)} cr.`, "bad");
  const here = currentPlanet();
  const worlds = (m.frontier
    ? PLANETS.filter(isVisible)   // whole sector + every hidden world you've discovered
    : PLANETS.filter(p => isActive(p) && !p.hidden && (p.id === here.id || (here.distances[p.id] || 0) <= m.ly))
  ).map(p => p.id);
  S.res.credits -= m.cost;
  S.pirateIntel = { worlds, until: S.turn + PIRATE_INTEL_DURATION, scope };
  log(`${m.ico} Bought a ${m.name} — pirate activity across <b>${worlds.length}</b> world(s) revealed for ${PIRATE_INTEL_DURATION} cycles.`, "event");
  toast(`${m.name}: ${worlds.length} worlds charted`, "event");
  afterAction();
}
/* ---------- Adversary matchmaking ----------
   Pirate opposition tracks the CAPTAIN's strength, not the system's raw
   activity: wherever you are in the game there are corsairs a rank below you
   and captains a rank above. System activity only tilts the extremes —
   infested space (4+) breeds bolder names. Activity still gates WHETHER
   pirates appear (and how often); matchmaking decides WHO shows up. */
function playerCombatTier() {
  const pw = raidPower();                               // ~6 green .. ~55 maxed
  return Math.max(1, Math.min(5, 1 + Math.floor((pw - 8) / 10)));
}
function pirateOpposition(systemLvl, bias) {
  const tier = playerCombatTier();
  const tilt = systemLvl >= 4 ? 1 : 0;                  // infested space runs a rank hotter
  return Math.max(1, Math.min(5, tier + tilt + rint(-1, 1) + (bias || 0)));
}
/* ---------- Phase 3: veterancy, elites & escorts ----------
   The rank ladder caps at 5, but a veteran hunter would soon outgrow it — so
   foe strength, hull and bounties keep climbing with your experience (kills
   + raids) and the cycle count. At high veterancy, elite NAMED captains
   appear: tougher, hardened against your favourite weapon, and running with
   escorts — keeping even a maxed ship honest, and the rewards scaling too. */
const PIRATE_NAMES = ["Vex", "Kessler", "Mora", "Drake", "Sable", "Rurik", "Calla", "Voss", "Talia", "Garr"];
const PIRATE_EPITHETS = ["the Cruel", "the Shadow", "Ironhand", "the Wolf", "Bonebreaker", "the Vulture", "Blacksun", "the Reaver"];
function veterancy() { return (S.pirate ? (S.pirate.bountyKills || 0) : 0) + Math.floor((S.pirate ? (S.pirate.raids || 0) : 0) / 3); }
function foeStrengthMult() { return 1 + Math.min(0.55, veterancy() * 0.009 + (S.turn || 0) * 0.0015); }
function favWeapon() {
  const u = (S.pirate && S.pirate.wuse) || {};
  return Object.keys(u).sort((a, b) => u[b] - u[a])[0] || "kinetic";
}
function noteWeaponUse(wkey) { if (!S.pirate.wuse) S.pirate.wuse = {}; S.pirate.wuse[wkey] = (S.pirate.wuse[wkey] || 0) + 1; }
// upgrade a freshly-generated foe into an elite, in place
function maybeElite(foe) {
  const chance = Math.min(0.25, Math.max(0, (veterancy() - 6) * 0.009));
  if (Math.random() >= chance) return foe;
  foe.elite = true;
  foe.name = `${pick(PIRATE_NAMES)} ${pick(PIRATE_EPITHETS)}`;
  foe.ico = "💀";
  foe.strength = Math.round(foe.strength * 1.28);
  ["armor", "shield", "pd"].forEach(k => { foe.def[k] = Math.min(3, (foe.def[k] || 0) + 1); });
  const cw = WEAPONS[favWeapon()] && WEAPONS[favWeapon()].counter;   // harden against what you favour
  if (cw) foe.def[cw] = 3;
  foe.bounty = Math.round((foe.bounty || 0) * 1.9);
  foe.credits = Math.round((foe.credits || 0) * 1.6);
  foe.escorts = 1 + (veterancy() >= 25 ? rint(0, 1) : 0);
  return foe;
}
/* ---------- Ship size classes ----------
   Every vessel you meet (pirate or coalition) has a hull class. Bigger ships
   hit harder, soak far more punishment, carry stronger defenses and richer
   bounties — and they'll try to JUMP AWAY when losing unless you knock out
   their engines first. Players learn the classes by their names. */
const SHIP_CLASSES = {
  scout:       { name: "Scout",       ico: "🛰️", hull: 0.7, str: 0.75, defBonus: 0, bounty: 0.6,  engines: 1, escort: 0, flee: 0.30 },
  corvette:    { name: "Corvette",    ico: "🚤", hull: 1.0, str: 1.0,  defBonus: 0, bounty: 1.0,  engines: 1, escort: 0, flee: 0.18 },
  frigate:     { name: "Frigate",     ico: "🚢", hull: 1.6, str: 1.3,  defBonus: 1, bounty: 2.0,  engines: 2, escort: 0, flee: 0.16 },
  cruiser:     { name: "Cruiser",     ico: "🛳️", hull: 2.0, str: 1.7,  defBonus: 1, bounty: 3.6,  engines: 2, escort: 0, flee: 0.20 },
  battleship:  { name: "Battleship",  ico: "⛴️", hull: 2.8, str: 2.3,  defBonus: 2, bounty: 6.5,  engines: 3, escort: 1, flee: 0.24 },
  dreadnought: { name: "Dreadnought", ico: "🦑", hull: 3.6, str: 3.0,  defBonus: 3, bounty: 11.0, engines: 3, escort: 1, flee: 0.28 },
};
const CLASS_ORDER = ["scout", "corvette", "frigate", "cruiser", "battleship", "dreadnought"];
function rollShipClass(bias) {
  let lvl = 1 + (bias || 0);                                   // corvette baseline
  const pUp = Math.min(0.5, 0.10 + veterancy() * 0.005);       // veterans meet bigger hulls
  while (lvl < CLASS_ORDER.length - 1 && Math.random() < pUp) lvl++;
  if (Math.random() < 0.18) lvl -= 1;                          // some run smaller
  return CLASS_ORDER[Math.max(0, Math.min(CLASS_ORDER.length - 1, lvl))];
}
// stamp a class onto a freshly-built foe, scaling its stats
function applyShipClass(foe, clsId) {
  const cls = SHIP_CLASSES[clsId] || SHIP_CLASSES.corvette;
  foe.cls = clsId;
  foe.strength = Math.max(4, Math.round(foe.strength * cls.str));
  foe.hullMult = cls.hull;
  foe.bounty = Math.round((foe.bounty || 0) * cls.bounty);
  foe.enginesMax = cls.engines; foe.engines = cls.engines;
  if (cls.defBonus) ["armor", "shield", "pd"].forEach(k => { foe.def[k] = Math.min(3, (foe.def[k] || 0) + cls.defBonus); });
  if (cls.escort) foe.escorts = (foe.escorts || 0) + cls.escort;
  return foe;
}
function classLabel(foe) { const c = SHIP_CLASSES[foe.cls] || SHIP_CLASSES.corvette; return `${c.ico} ${c.name}`; }
function genPirate(level) {
  const lv = Math.max(1, Math.min(5, level));
  const R = PIRATE_RANKS[lv];
  const str = Math.round(R.str * (0.85 + Math.random() * 0.3) * foeStrengthMult());
  const prof = genFoeProfile("pirate", str, 0.2);
  const foe = {
    type: "pirate", isPirate: true, level: lv,
    name: R.name, ico: R.ico, faction: "frontier",
    cargo: { weapons: rint(2, 4 + lv), fuel: rint(3, 8) },
    credits: rint(100, 250) * lv,
    strength: str, def: prof.def, wtype: prof.wtype,
    bounty: Math.round(R.bounty * (0.85 + Math.random() * 0.3) * foeStrengthMult()),
    wantedGain: 0,
  };
  applyShipClass(foe, rollShipClass());
  return maybeElite(foe);
}
function pirateKillRewards(prey) {
  const p = currentPlanet();
  if (!S.pirates) S.pirates = {};
  S.pirate.bountyKills = (S.pirate.bountyKills || 0) + 1;
  S.pirate.bountyEarned = (S.pirate.bountyEarned || 0) + Math.round(prey.bounty * lootShare());
  S.res.credits += Math.round(prey.bounty * lootShare());
  S.res.influence = (S.res.influence || 0) + 2 + prey.level;
  addRep("core", 3 + prey.level); addRep(p.faction, 4 + prey.level);
  S.pirates[p.id] = Math.max(0, pirateLevel(p.id) - 1);
  S.pirateCalm = Math.max(S.pirateCalm || 0, S.turn) + 4;       // the lanes breathe easier
  jot(`Hunted down a ${prey.name} near ${p.name} — ${fmt(prey.bounty)} cr bounty collected; the lanes are safer for a while.`, "deed");
}
/* ------------------------------------------------------------
   TRAVEL AMBUSH — pirates on the jump lanes
   Arriving in piratey space can drop you into an encounter: pay their toll,
   run for it (engines help), or turn and fight (cannons & shields decide).
   Locks you down like an interdiction until resolved.
   ------------------------------------------------------------ */
function cargoValue() { return CARGO_IDS.reduce((s2, c) => s2 + (S.res[c] || 0) * COM[c].base, 0); }
function maybeAmbush(dest) {
  if (S.encounter || S.interdiction || S.jail > 0 || pirateCalm()) return;
  const lvl = pirateLevel(dest.id);
  if (lvl <= 0) return;
  const guards = typeof convoyGuardCount === "function" ? convoyGuardCount() : 0;
  const chance = (0.05 + lvl * 0.045) * Math.pow(0.45, guards);   // your own warship escort + any pirate bands riding with you damp this, same shape processConvoys() uses for stationed colony guards
  if (Math.random() < chance) {
    const pirate = genPirate(pirateOpposition(lvl, -1));
    pirate.toll = Math.round(300 * pirate.level + Math.min(2500, (S.res.credits + cargoValue()) * 0.04));
    S.encounter = pirate;
    log(`🏴‍☠️ Ambush! A ${pirate.ico} <span class="c">${pirate.name}</span> drops out of the dark off ${dest.name} and demands ${fmt(pirate.toll)} cr — or your cargo.`, "bad");
    toast(`Pirate ambush: ${pirate.name}!`, "bad");
    if (typeof announce === "function") announce("🏴‍☠️ Pirate Ambush", `A ${pirate.name} has you in its sights. Pay, run, or fight.`, false);
    if (typeof convoyAmbushRisk === "function") convoyAmbushRisk(lvl);
    unlock("raid"); if (typeof setTab === "function") setTab("raid");
  }
}
function encounterPay() {
  const e = S.encounter; if (!e) return;
  if (S.res.credits < e.toll) return toast(`They want ${fmt(e.toll)} cr — you don't have it. Run or fight.`, "bad");
  S.res.credits -= e.toll; S.encounter = null;
  log(`💰 You paid the ${e.name}'s toll of ${fmt(e.toll)} cr and were waved through. Galling, but bloodless.`, "");
  toast(`Toll paid (−${fmt(e.toll)} cr).`, "bad");
  afterAction();
}
function encounterFlee() {
  const e = S.encounter; if (!e) return;
  const odds = (0.45 + S.upgrades.engine * 0.15 * trimMult("autonomy") + (S.upgrades.aimain || 0) * 0.08 - e.level * 0.05) * condFactor("engines") * (0.7 + 0.3 * defenseMult());
  if (Math.random() < odds) {
    S.encounter = null;
    log(`🏃 You burned hard and lost the ${e.name} in the void. Clean getaway.`, "good");
    toast("Escaped!", "good");
  } else {
    const dmg = takeHullDamage(e.strength * 0.4 * (0.6 + Math.random() * 0.5));
    log(`🏃 The ${e.name} raked your hull as you ran — Hull −${dmg} — and it's still on you.`, "bad");
    toast(`Flee failed! Hull −${dmg}`, "bad");
  }
  afterAction();
}

function encounterFight(wkey) {
  const e = S.encounter; if (!e) return;
  wkey = wkey && WEAPONS[wkey] && weaponAvailable(wkey) && weaponAffordable(wkey) ? wkey : "kinetic";
  if (!weaponAffordable(wkey)) return toast(`No ammo for ${WEAPONS[wkey].name}.`, "bad");
  if (!e._engaged) { e._engaged = true; S.pirate.raids++; }
  foeHp(e); payAmmo(wkey); noteWeaponUse(wkey); combatState().lastWeapon = wkey;
  const ps = playerStrikes(e, wkey);
  const etgt = applyTargetedDamage(e, ps.dmg);
  if (e.hp <= 0) {
    sfx("explode");
    const taken = plunder(e);
    S.pirate.dread += 3; clampPirate();
    pirateKillRewards(e);
    S.encounter = null;
    log(`⚔️ You blew the ${e.ico} ${e.name} apart! Bounty ${fmt(e.bounty)} cr + salvage ${taken.join(" ") || "none"}. (no Wanted)`, "good");
    toast(`Ambusher destroyed — ${fmt(e.bounty)} cr!`, "good");
    return afterAction();
  }
  sfx("fire");
  const fs = foeStrikes(e, 0.24);
  const hpPct = Math.max(0, Math.round(e.hp / e.maxhp * 100));
  log(`⚔️ You hit the ${e.name} for ${etgt.hullDmg} hull (now ${hpPct}%)${etgt.note}; it fires back — Hull −${fs.dmg}${subsysHitLog(fs.subHit)}.`, "");
  toast(`Foe hull ${hpPct}%`, "");
  if (!S.encounter) return afterAction();   // crippled & towed off (shipCrippled cleared it)
  if (foeFleeCheck(e)) {
    log(`🏃 The ${e.ico} ${e.name} broke off and jumped away — its 🚀 drive was still live. The bounty's gone.`, "bad");
    toast(`${e.name} escaped!`, "bad");
    S.encounter = null; return afterAction();
  }
  afterAction();
}

function processPirates() {
  if (!S.pirates) S.pirates = {};
  if (S.turn % 5 !== 0) return;                                  // pirates regroup slowly
  const risen = [];
  PLANETS.forEach(p => {
    const base = basePirateLevel(p), cur = pirateLevel(p.id);
    if (cur < base || (base > 0 && cur < 5 && Math.random() < 0.35)) {
      S.pirates[p.id] = Math.min(5, cur + 1);                    // lawless space breeds raiders
      if (S.pirates[p.id] > cur) risen.push(p.name);
    }
  });
  if (risen.length) digestNote("threats", `pirate activity rising at ${risen.slice(0, 3).join(", ")}${risen.length > 3 ? ` +${risen.length - 3} more` : ""}`);
}
function genPrey() {
  const p = currentPlanet(), law = p.enforce;       // lawful space → richer, better-escorted prey
  // weight prey by locale
  let pool;
  if (law >= 0.5)      pool = ["liner", "merchant", "merchant", "patrol", "hauler"];
  else if (law >= 0.25) pool = ["merchant", "hauler", "hauler", "smuggler", "patrol"];
  else                  pool = ["hauler", "smuggler", "smuggler", "merchant"];
  const key = pick(pool), A = PREY[key];
  const cargo = {};
  const picks = A.goods.slice().sort(() => Math.random() - 0.5).slice(0, rint(1, 2));
  picks.forEach(c => cargo[c] = rint(A.bulk[0], A.bulk[1]));
  let strength = Math.round(A.base * (0.7 + law * 0.85) * (0.85 + Math.random() * 0.5) * foeStrengthMult()); // lawful escorts tough but beatable
  if (S.crises && S.crises[p.id]) strength = Math.round(strength * 0.85);                 // escorts thinned by the crisis
  const prof = genFoeProfile(key, strength, law);
  const foe = {
    type: key, name: A.name, ico: A.ico,
    faction: A.faction || p.faction,
    cargo, credits: rint(A.credits[0], A.credits[1]),
    strength, def: prof.def, wtype: prof.wtype,
    bounty: 0,
    wantedGain: Math.round(A.wanted * (1 + law * 0.6)),
  };
  applyShipClass(foe, rollShipClass(law >= 0.5 ? 1 : 0));     // lawful lanes run bigger hulls
  return foe;
}
/* unified sweep: one scan turns up a handful of contacts — pirates AND coalition
   traffic together — shown by faction + hull class only. Pick one to engage. */
function prowl() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (S.interdiction) return toast("There's a navy cutter on your tail — deal with it first.", "bad");
  if (S.encounter) return toast("A pirate has you in its sights — deal with it first.", "bad");
  if (S.prey) return toast("You're already shadowing a target.", "bad");
  if (S.preyChoices && S.preyChoices.length) return toast("You already have contacts on the scope — engage one or stand down.", "bad");
  if (S.res.fuel < PROWL_FUEL) return toast(`Need ${PROWL_FUEL} fuel to sweep the lanes.`, "bad");
  S.res.fuel -= PROWL_FUEL; useAction();
  const p = currentPlanet();
  // sweeping lawful space while notorious can flush out a patrol instead
  if (S.pirate.wanted >= 30 && Math.random() < (S.pirate.wanted / 100) * p.enforce * 0.7) {
    startInterdiction(p, "patrol");
    return afterAction();
  }
  if (Math.random() < 0.12) {
    log("🔭 You swept the lanes but turned up nothing worth the powder.", "");
    toast("No contacts.", "");
    return afterAction();
  }
  const lvl = pirateLevel(p.id);
  const n = rint(2, 4);
  const pirateChance = Math.min(0.85, 0.12 + lvl * 0.15 - p.enforce * 0.18);
  const choices = [];
  for (let i = 0; i < n; i++) {
    if (lvl > 0 && Math.random() < pirateChance) choices.push(genPirate(pirateOpposition(lvl)));
    else choices.push(genPrey());
  }
  S.preyChoices = choices;
  const pirates = choices.filter(c => c.isPirate).length;
  log(`🔭 Sweep complete: <b>${choices.length}</b> contact(s) on the scope${pirates ? ` — ${pirates} flagged as pirates` : ""}. Read their class before you commit.`, "event");
  toast(`${choices.length} contacts on the scope`, "event");
  if (typeof spawnSignal === "function" && Math.random() < 0.16) spawnSignal({ planet: S.location });   // a sweep can flush out a local anomaly
  afterAction();
}
function engageTarget(i) {
  if (!S.preyChoices || !S.preyChoices[i]) return;
  S.prey = S.preyChoices[i];
  S.prey._others = S.preyChoices.filter((c, idx) => idx !== i);   // the other ships in the area
  S.prey.pack = []; S.allies = null;
  S.preyChoices = null;
  raidJoinFollowers();                                            // your riding companions join the fray at once
  const prey = S.prey;
  if (prey.elite) { log(`💀 You bear down on the ELITE <span class="c">${prey.name}</span> — ${classLabel(prey)}${(prey.escorts || 0) > 0 ? `, ${prey.escorts} escort(s)` : ""}.`, "event"); toast(`Engaging elite ${prey.name}!`, "event"); }
  else { log(`🎯 You bear down on the ${classLabel(prey)} <span class="c">${prey.name}</span> (${prey.isPirate ? "🏴 pirate" : FACTIONS[prey.faction].name}).`, "event"); toast(`Engaging ${prey.name}`, "event"); }
  afterAction();
}
function standDown() {
  if (!S.preyChoices) return;
  S.preyChoices = null;
  log("🔭 You let the contacts disperse and stood down.", "");
  afterAction();
}
function huntPirates() { return prowl(); }   // unified — pirates show up as contacts in the sweep
function takeHullDamage(amount) {
  amount = Math.max(0, Math.round(amount * (1 - dmgReduction())));
  S.pirate.hull -= amount;
  clampPirate();
  if (S.pirate.hull <= 0) shipCrippled();
  return amount;
}
function shipCrippled() {
  // jettison half the hold, pay a tow, limp home
  const jettisoned = [];
  CARGO_IDS.forEach(c => { const lose = Math.floor((S.res[c] || 0) / 2); if (lose > 0) { S.res[c] -= lose; jettisoned.push(`${lose} ${COM[c].ico}`); } });
  const tow = Math.min(S.res.credits, 1500);
  S.res.credits -= tow;
  S.pirate.hull = 30; clampPirate();
  SUBSYS.forEach(k => damageSubsys(k, 15 + Math.random() * 20));   // a wreck damages everything
  S.prey = null; S.encounter = null; S.allies = null;             // the fight is over — you're towed off
  if (typeof releaseBattleGroup === "function") releaseBattleGroup();
  S.actionsUsed = ACTIONS_PER_CYCLE;                               // the tow eats the rest of the cycle
  log(`💥 Your hull buckled! A tow drags you off — lost ${jettisoned.join(" ") || "no cargo"}, paid ${fmt(tow)} cr, systems battered, and the cycle is gone. End the cycle to limp on.`, "bad");
  toast("Ship crippled — cycle lost!", "bad");
  jot(`Ship crippled near ${currentPlanet().name} — hull gave out, cargo jettisoned, a cycle lost to the tow.`, "outlaw");
  if (typeof announce === "function") announce("💥 Ship Crippled", "Your hull gave out under fire. Towed off — cargo jettisoned, a tow paid, and the cycle lost. Patch up before you raid again.", true);
}
/* ---------- Multi-vessel engagements ----------
   A coalition victim can call SAME-faction ships in the area to its rescue (you
   must then beat them all); you can call PIRATES in the area to your side (they
   fire independently, but the loot splits evenly). Every vessel fires on its
   own with its own result. The pool of "ships in the area" is the other
   contacts your sweep turned up but you didn't engage. */
function lootShare() {                                   // the PLAYER's cut = whole minus each ally's negotiated share
  const allies = S.allies || [];
  if (!allies.length) return 1;
  const taken = allies.reduce((s, a) => s + (a.share != null ? a.share : 1 / (1 + allies.length)), 0);
  return Math.max(0.1, 1 - taken);
}
function allHostiles(prey) { return [prey].concat((prey && prey.pack) || []); }
function clearEngagement() { S.prey = null; S.encounter = null; S.allies = null; if (typeof releaseBattleGroup === "function") releaseBattleGroup(); }

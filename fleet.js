/* ============================================================
   STELLAR FRONTIER — player fleet
   Ships built at colony shipyards (freighters & warships), fully under
   the player's command: ordering/scrapping/repairing hulls, calling ships
   into a raid as allies, the raid Battle Group (posture, tactical
   formation tiers, firepower/damage), stationing freighters and their
   warship escorts on logistics duty at a colony (convoy ambushes and
   all), and dispatching warships on system missions (the player-owned
   mirror of a band Mandate). renderFleet() and its session-only UI form
   state (fleetMissionForm, fleetLogiForm) stay in game.js — they move
   with the rest of the render* functions in the eventual rendering
   slice, same as every render function so far.

   Loaded after colonization.js, before game.js. combatLocked, fmt, log,
   addRep, digestNote, mdPlanetName, cycleLedger, commissionCovers,
   clampPirate, pirateLevel, mandateCycleYield, MANDATE_TASKS, saveGame
   and renderAll still live in other files/game.js at this point in the
   split — safe, since every function here is only CALLED later, once
   every script has finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

const FLEET_HULL_BASE = 52, FLEET_FP_BASE = 15;
/* Material scope beyond metals/alloys/electronics, applied uniformly across
   both roles: every hull needs radioactives for its propulsion/reactor core
   (entry-level tier included — even a Light Freighter has an engine to fuel),
   and everything past entry tier also needs AI Cores for its avionics/nav
   compute (the T1 Light Freighter and Corvette fly without one — a hull that
   basic doesn't need a machine mind). Warships additionally need Weapons and
   Combat Drones to arm and crew their turrets/bays at every tier, and the
   Battleship alone needs a handful of Plasma Torpedoes for its capital-grade
   armament. */
const FLEET_SHIPS = {
  // ---- civil freighters (cargo capacity; weak guns) ----
  light_freighter: { role: "freighter", cls: "corvette",   name: "Light Freighter",  ico: "🚚", tier: 1, build: 2, cap: 120, cost: { credits: 2500,  metals: 30,  radioactives: 6 } },
  med_freighter:   { role: "freighter", cls: "frigate",    name: "Medium Freighter", ico: "🚛", tier: 2, build: 3, cap: 240, cost: { credits: 5000,  metals: 60,  electronics: 6,  radioactives: 12, ai: 2 } },
  heavy_freighter: { role: "freighter", cls: "cruiser",    name: "Heavy Freighter",  ico: "🚍", tier: 3, build: 5, cap: 420, cost: { credits: 9000,  metals: 110, electronics: 14, radioactives: 20, ai: 4 } },
  bulk_freighter:  { role: "freighter", cls: "battleship", name: "Bulk Hauler",      ico: "🛳️", tier: 4, build: 7, cap: 700, cost: { credits: 16000, metals: 200, alloys: 20, electronics: 24, radioactives: 32, ai: 7 } },
  // ---- warships (defense; combat stats from SHIP_CLASSES) ----
  corvette:   { role: "warship", cls: "corvette",   name: "Corvette",   ico: "🚤", tier: 1, build: 2, cost: { credits: 3500,  metals: 40,  electronics: 6,  radioactives: 8,  weapons: 3,  drones: 2 } },
  frigate:    { role: "warship", cls: "frigate",    name: "Frigate",    ico: "🚢", tier: 2, build: 3, cost: { credits: 7000,  metals: 80,  electronics: 14, radioactives: 15, weapons: 6,  drones: 3,  ai: 3 } },
  cruiser:    { role: "warship", cls: "cruiser",    name: "Cruiser",    ico: "🛡️", tier: 3, build: 5, cost: { credits: 13000, metals: 150, alloys: 18, electronics: 26, radioactives: 26, weapons: 10, drones: 6,  ai: 6 } },
  battleship: { role: "warship", cls: "battleship", name: "Battleship", ico: "⚔️", tier: 4, build: 8, cost: { credits: 26000, metals: 280, alloys: 40, electronics: 50, radioactives: 40, weapons: 16, drones: 10, ai: 10, plasmatorp: 4 } },
};
const FLEET_SHIP_KEYS = Object.keys(FLEET_SHIPS);
function fleetList() { if (!Array.isArray(S.fleet)) S.fleet = []; return S.fleet; }
function fleetShipHullMax(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return def.role === "freighter" ? Math.round(FLEET_HULL_BASE * 0.7 + (def.cap || 0) * 0.08) : Math.round(FLEET_HULL_BASE * c.hull); }
function fleetShipStr(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return def.role === "freighter" ? Math.round(FLEET_FP_BASE * c.str * 0.35) : Math.round(FLEET_FP_BASE * c.str); }
function fleetShipUpkeep(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return def.role === "freighter" ? Math.round(15 + (def.cap || 0) * 0.06) : Math.round(40 * c.str); }
function fleetUpkeep() { return fleetList().filter(s => s.status !== "building").reduce((sum, s) => sum + (FLEET_SHIPS[s.key] ? fleetShipUpkeep(FLEET_SHIPS[s.key]) : 0), 0); }
function colonyShipyardTier(pid) { const col = S.colonies && S.colonies[pid]; return (col && col.buildings && col.buildings.shipyard) || 0; }
function fleetBuildingAt(pid) { return fleetList().filter(s => s.home === pid && s.status === "building").length; }
function fleetNameFor(def, key) { const n = fleetList().filter(s => s.key === key).length + 1; return `${def.name} ${n}`; }
function fleetMatsOf(def) { const m = {}; Object.keys(def.cost).forEach(k => { if (k !== "credits") m[k] = def.cost[k]; }); return m; }
function orderShip(shipKey) {
  const pid = S.location, col = S.colonies && S.colonies[pid];
  if (!col) return toast("No colony here.", "bad");
  const def = FLEET_SHIPS[shipKey]; if (!def) return;
  const yard = colonyShipyardTier(pid);
  if (yard <= 0) return toast("This colony has no Shipyard — build one in the Colonies tab.", "bad");
  if (def.tier > yard) return toast(`A Tier ${def.tier} Shipyard is needed to lay down a ${def.name}.`, "bad");
  if (fleetBuildingAt(pid) >= yard) return toast(`All ${yard} slipway(s) here are busy — wait for a hull to launch.`, "bad");
  if ((S.res.credits || 0) < def.cost.credits) return toast(`A ${def.name} costs ${fmt(def.cost.credits)} cr.`, "bad");
  const mats = fleetMatsOf(def);
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => `${mats[c]} ${COM[c].name}`).join(", ") + ".", "bad");
  S.res.credits -= def.cost.credits; pay(mats);
  const hm = fleetShipHullMax(def);
  fleetList().push({ id: "sh" + S.turn + "_" + Math.floor(Math.random() * 1e4), key: shipKey, name: fleetNameFor(def, shipKey), home: pid, status: "building", buildLeft: def.build, hull: hm, hullMax: hm });
  log(`🏗️ Laid down a ${def.ico} ${def.name} at ${currentPlanet().name} — ${def.build} cycles to launch.`, "event");
  toast(`${def.name} under construction`, "good"); sfx("event"); saveGame(); renderAll();
}
function scrapShip(id) {
  const i = fleetList().findIndex(s => s.id === id); if (i < 0) return;
  const s = fleetList()[i], def = FLEET_SHIPS[s.key];
  if (s.status === "mission" || s.status === "escort" || s.status === "logistics" || s.status === "convoy") return toast("That ship is on duty — recall it first.", "bad");
  const refund = def ? Math.round((def.cost.metals || 0) * 0.4) : 0;
  if (typeof confirm === "function"
      && !confirm(`Scrap the ${s.name}? This cannot be undone${refund ? ` (salvages ${refund} metals)` : ""}.`)) return;
  if (refund) S.res.metals = (S.res.metals || 0) + refund;
  fleetList().splice(i, 1);
  log(`♻️ Scrapped the ${def ? def.ico + " " + s.name : s.name}${refund ? ` — salvaged ${refund} ⛓️ metals` : ""}.`, "");
  toast("Ship scrapped", ""); saveGame(); renderAll();
}
function fleetRepairCost(s) { const miss = (s.hullMax || 0) - (s.hull || 0); return { miss, credits: Math.round(miss * 9), metals: Math.ceil(miss / 12) }; }
function repairFleetShip(id) {
  const s = fleetList().find(x => x.id === id); if (!s || s.status === "building") return;
  if (colonyShipyardTier(S.location) <= 0 || s.home !== S.location) return toast("Repair at the ship's home shipyard.", "bad");
  const c = fleetRepairCost(s); if (c.miss <= 0) return toast("That ship is already sound.", "bad");
  if ((S.res.credits || 0) < c.credits || (S.res.metals || 0) < c.metals) return toast(`Repair needs ${fmt(c.credits)} cr · ${c.metals} ⛓️.`, "bad");
  S.res.credits -= c.credits; S.res.metals -= c.metals; s.hull = s.hullMax;
  log(`🔧 Repaired the ${s.name} for ${fmt(c.credits)} cr.`, "good"); toast("Ship repaired", "good"); sfx("repair"); saveGame(); renderAll();
}
// ---- fleet warships as loyal, free combat allies (raids & escorts) ----
function fleetRaidable() { return fleetList().filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }   // your warships are 100% callable
function fleetAsAlly(s) { const def = FLEET_SHIPS[s.key]; return { isFleet: true, fleetId: s.id, allyName: s.name, name: s.name, ico: def.ico, strength: Math.round(fleetShipStr(def) * 2.5), share: 0 }; }   // loyal, no loot cut
function raidSummonFleet(shipId) {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your wing is full (2 allies).", "bad");
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "warship" || s.status !== "idle") return toast("That ship isn't available.", "bad");
  if (S.allies.some(a => a.fleetId === shipId)) return toast(`The ${s.name} is already at your side.`, "bad");
  const a = fleetAsAlly(s); S.allies.push(a); foeHp(a);
  log(`✦ Your ${def.ico} ${s.name} answers the call and opens fire — loyal, your whole cut intact.`, "event");
  toast(`${s.name} joined the fight`, "event"); sfx("event"); afterAction();
}
function escortRallyFleet(shipId) {
  const e = ensureEscort(); if (!e.active) return;
  if (escortInCombat()) return toast("Wait for a lull to bring them in.", "bad");
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "warship" || s.status !== "idle") return toast("That ship isn't available.", "bad");
  if (e.fleet.some(sh => sh.fleetId === shipId)) return toast(`The ${s.name} already flies with the convoy.`, "bad");
  e.fleet.push({ role: "escort", hired: true, support: true, fleetId: shipId, name: s.name, ico: def.ico, hullMax: s.hullMax, hull: Math.round(s.hull), str: Math.round(fleetShipStr(def) * 1.3), alive: true, stance: "balanced", fit: { aggressive: 0, balanced: 0, defensive: 0 } });
  s.status = "escort";
  log(`✦ Your ${def.ico} ${s.name} joins the convoy as escort — loyal and free.`, "event");
  toast(`${s.name} escorting`, "good"); sfx("event"); saveGame(); renderAll();
}
function releaseFleetEscorts(e) {     // sync convoy support ships back to the fleet when an escort ends
  (e.fleet || []).filter(sh => sh.fleetId).forEach(sh => {
    const s = fleetList().find(x => x.id === sh.fleetId); if (!s) return;
    if (!sh.alive) { s._dead = true; log(`💥 Your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} was lost defending the convoy.`, "bad"); }
    else { s.status = "idle"; s.hull = Math.max(1, Math.round(sh.hull)); }
  });
  if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
}
// ---- Battle Group: deploy your WHOLE idle warship fleet into a raid at once as a
// pooled formation (not the 2-ally cap) — fought with an escort-style posture:
// its firepower adds to your strikes, and it screens you from incoming fire, at
// the cost of taking real damage (and possible losses) of its own each round. ----
function battleGroupShips() { return fleetList().filter(s => s.status === "battle"); }
function battleGroupPostureObj() { return ESCORT_POSTURES[S.battleGroupPosture || "balanced"] || ESCORT_POSTURES.balanced; }
function setBattleGroupPosture(p) { if (ESCORT_POSTURES[p]) { S.battleGroupPosture = p; saveGame(); renderAll(); } }
/* ---- Tactical formation: three positional tiers, not just a pooled number.
   🛡️ Vanguard tanks (soaks fire first, fires at a discount), ⚔️ Line does the
   bulk of the damage, 🌌 Reserve is held back (safest, weakest). Damage each
   round targets the FRONTMOST non-empty tier — lose your Vanguard and the
   Line becomes exposed, lose that and Reserve is next. A stray 15% of hits
   ignore tiering entirely, so no formation is ever perfectly safe. Keeping a
   Vanguard alive also screens the player harder — positioning has stakes for
   both the fleet and you. */
const FORMATION_SLOTS = {
  vanguard: { ico: "🛡️", name: "Vanguard", fpMult: 0.85, hint: "front line — soaks the worst of the incoming fire so the rest of the fleet can fight" },
  line:     { ico: "⚔️", name: "Line",     fpMult: 1.20, hint: "main battle line — your best damage dealers, protected while the vanguard holds" },
  reserve:  { ico: "🌌", name: "Reserve",  fpMult: 0.70, hint: "held back — safest position, but fights at reduced effect" },
};
const FORMATION_TIERS = ["vanguard", "line", "reserve"];
function shipFormation(s) { return FORMATION_SLOTS[s.formation] ? s.formation : "line"; }
function autoAssignFormation(ships) {   // biggest hulls forward — a battleship tanks better than a corvette
  const sorted = ships.slice().sort((a, b) => fleetShipHullMax(FLEET_SHIPS[b.key]) - fleetShipHullMax(FLEET_SHIPS[a.key]));
  const nV = Math.max(1, Math.ceil(sorted.length / 3)), nL = Math.max(0, Math.ceil((sorted.length - nV) / 2));
  sorted.forEach((s, i) => { s.formation = i < nV ? "vanguard" : (i < nV + nL ? "line" : "reserve"); });
}
function setBattleGroupFormation(shipId, slot) {
  const s = battleGroupShips().find(x => x.id === shipId); if (!s || !FORMATION_SLOTS[slot]) return;
  s.formation = slot; saveGame(); renderAll();
}
function battleGroupFrontTier() {   // the tier currently taking the brunt of incoming fire
  for (const t of FORMATION_TIERS) { const ships = battleGroupShips().filter(s => shipFormation(s) === t); if (ships.length) return ships; }
  return [];
}
function deployBattleGroup() {
  if (!S.prey) return toast("No engagement.", "bad");
  const idle = fleetRaidable(); if (!idle.length) return toast("No idle warships to deploy.", "bad");
  idle.forEach(s => { s.status = "battle"; });
  autoAssignFormation(idle.filter(s => !FORMATION_SLOTS[s.formation]));   // first-time deploys get a sensible default; prior manual picks stick
  log(`✦ Your battle fleet (${idle.length} ship${idle.length === 1 ? "" : "s"}) forms up around you — pooled firepower, no loot cut.`, "event");
  toast(`Battle fleet deployed (${idle.length})`, "event"); sfx("event"); afterAction();
}
function recallBattleGroup() {
  const grp = battleGroupShips(); if (!grp.length) return;
  grp.forEach(s => { s.status = "idle"; });
  log(`✦ Your battle fleet peels off and returns to standby.`, "");
  toast("Battle fleet recalled", ""); saveGame(); renderAll();
}
function releaseBattleGroup() {   // combat ended: stand the group down (survivors keep their wear, repairable at a shipyard)
  const grp = battleGroupShips(); if (!grp.length) return;
  grp.forEach(s => { s.status = "idle"; });
}
function battleGroupScreenMult() {   // your formation screens (or exposes) you — a standing Vanguard shields you further
  const grp = battleGroupShips(); if (!grp.length) return 1;
  const vanguardHolds = grp.some(s => shipFormation(s) === "vanguard");
  return battleGroupPostureObj().def * (vanguardHolds ? 0.85 : 1.1);
}
function battleGroupFirepower() {
  const grp = battleGroupShips(); if (!grp.length) return 0;
  const off = battleGroupPostureObj().off;
  return Math.round(grp.reduce((sum, s) => sum + fleetShipStr(FLEET_SHIPS[s.key]) * (0.5 + 0.5 * (s.hull / s.hullMax)) * FORMATION_SLOTS[shipFormation(s)].fpMult, 0) * off);
}
// each combat round, the frontmost non-empty tier absorbs the hit (85% of the time; 15% stray
// fire ignores tiering) — a formation collapses tier by tier as its defenders are lost.
function battleGroupTakeFire(prey) {
  const grp = battleGroupShips(); if (!grp.length) return 0;
  const front = battleGroupFrontTier();
  const pool = (front.length && Math.random() < 0.85) ? front : grp;
  const def = battleGroupPostureObj().def;
  const target = pick(pool);
  const dmg = Math.max(1, Math.round((prey.strength || 20) * 0.16 * def * (0.6 + Math.random() * 0.8)));
  target.hull = Math.max(0, target.hull - dmg);
  if (target.hull <= 0) {
    target._dead = true;
    log(`💥 Your ${(FLEET_SHIPS[target.key] || {}).ico || ""} ${target.name} (${FORMATION_SLOTS[shipFormation(target)].name}) was lost fighting alongside you.`, "bad");
    if (typeof toast === "function") toast(`${target.name} lost!`, "bad");
  }
  return dmg;
}
// ---- freight convoys: station freighters at a colony to cut its transport costs;
// station warships there to guard them from pirate ambush ----
function colonyPidOf(col) { if (!col || !S.colonies) return null; for (const k in S.colonies) if (S.colonies[k] === col) return k; return null; }
function colonyHaulers(pid) { return fleetList().filter(s => s.status === "logistics" && s.station === pid && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter"); }
function colonyGuards(pid) { return fleetList().filter(s => s.status === "logistics" && s.station === pid && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }
function colonyHaulCap(pid) { return colonyHaulers(pid).reduce((s, x) => s + (FLEET_SHIPS[x.key].cap || 0), 0); }
function colonyHaulDiscount(pid) { return pid ? Math.min(0.18, colonyHaulCap(pid) * 0.00025) : 0; }    // cheaper market imports
function colonyFreightMult(pid) { return 1 - Math.min(0.5, colonyHaulCap(pid) * 0.0005); }              // cheaper base↔colony freight
function assignLogistics(shipId, planetId) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  if (!S.colonies || !S.colonies[planetId]) return toast("Pick one of your colonies.", "bad");
  s.status = "logistics"; s.station = planetId;
  const role = def.role === "freighter" ? "haul for" : "guard the convoys at";
  log(`🚚 Your ${def.ico} ${s.name} is assigned to ${role} ${mdPlanetName(planetId)}.`, "event");
  toast(`${s.name} → ${mdPlanetName(planetId)}`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallLogistics(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "logistics") return;
  s.status = "idle"; s.station = null;
  log(`🚚 Recalled your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} from logistics duty.`, "");
  toast(`${s.name} recalled`, ""); saveGame(); renderAll();
}
function processConvoys() {       // pirate ambushes on your stationed freighters (guards cut the risk & damage)
  const stations = {};
  fleetList().forEach(s => { if (s.status === "logistics" && s.station) stations[s.station] = true; });
  Object.keys(stations).forEach(pid => {
    const haulers = colonyHaulers(pid); if (!haulers.length) return;
    const plv = pirateLevel(pid); if (plv <= 0) return;
    const guards = colonyGuards(pid).length;
    const chance = (0.05 + plv * 0.04) * Math.pow(0.45, guards);
    if (Math.random() >= chance) return;
    const f = pick(haulers), name = mdPlanetName(pid);
    const dmg = Math.round(plv * 6 * (0.5 + Math.random()) / (1 + guards));
    const loss = Math.min(S.res.credits || 0, Math.round(plv * 40 * (0.5 + Math.random()) / (1 + guards)));
    f.hull = Math.max(0, f.hull - dmg);
    if (loss > 0) { S.res.credits -= loss; if (typeof cycleLedger === "function") cycleLedger("convoy losses", -loss); }
    if (f.hull <= 0) { f._dead = true; log(`💥 Pirates destroyed your ${(FLEET_SHIPS[f.key] || {}).ico || ""} ${f.name} hauling for ${name}.`, "bad"); if (typeof toast === "function") toast(`${f.name} lost to pirates!`, "bad"); digestNote("threats", `${f.name} lost at ${name}`); }
    else { log(`🏴‍☠️ Pirates ambushed your convoy at ${name} — ${f.name} took ${dmg} damage${loss ? ` and lost ${fmt(loss)} cr of goods` : ""}${guards ? " (your guards drove them off)" : " — assign a warship to guard it"}.`, "bad"); digestNote("threats", `convoy ambushed at ${name}`); }
  });
  if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
}
// ---- personal convoy: freighters ride WITH you on every jump, extending your OWN
// cargo hold on the road; warships (and any pirate bands riding with you) escort
// them, damping travel-ambush odds and softening any ambush that slips through
// anyway. Distinct from logistics duty (above): that stations ships AT a colony
// to haul ITS goods on a per-cycle timer; this rides with the player and
// resolves on the per-jump travel-ambush cadence instead (maybeAmbush, combat.js). ----
function convoyShips()      { return fleetList().filter(s => s.status === "convoy"); }
function convoyFreighters() { return convoyShips().filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter"); }
function convoyWarships()   { return convoyShips().filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }
function convoyGuardCount() { return convoyWarships().length + bandList().filter(bandFollowing).length; }   // your own escorts + any pirate bands riding with you
function convoyCargoCeiling() { return BASE_CARGO + S.upgrades.cargo * 150; }   // ties the ceiling to your own Cargo Hold tier — a convoy is a real second hold, not a way to skip upgrading
function convoyCargoBonus() {
  const frs = convoyFreighters(); if (!frs.length) return 0;
  const raw = frs.reduce((sum, s) => sum + FLEET_SHIPS[s.key].cap * (0.5 + 0.5 * (s.hull / s.hullMax)), 0);   // a battered freighter hauls less, same shape as escShipFP
  return Math.min(convoyCargoCeiling(), Math.round(raw));
}
function convoyFuelSurcharge() {   // towing a convoy burns extra fuel every jump — scales with how many ships ride along, capped
  const n = convoyShips().length; if (!n) return 0;
  return Math.min(0.5, n * 0.08);
}
function assignConvoy(shipId) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  if (s.home !== S.location) return toast(`Dock at ${(PLANETS.find(p => p.id === s.home) || {}).name || "its home port"} to bring the ${s.name} aboard.`, "bad");
  s.status = "convoy";
  log(`🚚 Your ${def.ico} ${s.name} falls in with your personal convoy.`, "event");
  toast(`${s.name} joined your convoy`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallConvoy(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "convoy") return;
  s.status = "idle";
  log(`🚚 Recalled your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} from your personal convoy.`, "");
  toast(`${s.name} recalled`, ""); saveGame(); renderAll();
}
// pirates ambushing you also take a swipe at your convoy in the chaos — guards
// (warships + following bands) blunt this too, same 1/(1+guards) shape processConvoys
// already uses for damage magnitude (distinct from its 0.45^guards shape for ODDS)
function convoyAmbushRisk(lvl) {
  const frs = convoyFreighters(); if (!frs.length) return;
  const guards = convoyGuardCount();
  const f = pick(frs);
  const dmg = Math.round(lvl * 6 * (0.5 + Math.random()) / (1 + guards));
  const loss = Math.min(S.res.credits || 0, Math.round(lvl * 40 * (0.5 + Math.random()) / (1 + guards)));
  f.hull = Math.max(0, f.hull - dmg);
  if (loss > 0) { S.res.credits -= loss; if (typeof cycleLedger === "function") cycleLedger("convoy losses", -loss); }
  if (f.hull <= 0) {
    f._dead = true;
    log(`💥 In the ambush, pirates ran down your ${(FLEET_SHIPS[f.key] || {}).ico || ""} ${f.name} — lost with its cargo.`, "bad");
    if (typeof toast === "function") toast(`${f.name} lost to pirates!`, "bad");
  } else {
    log(`🏴‍☠️ Your convoy's ${(FLEET_SHIPS[f.key] || {}).ico || ""} ${f.name} took ${dmg} damage in the ambush${loss ? ` and ${fmt(loss)} cr of goods spoiled` : ""}${guards ? " — your guards blunted it" : ""}.`, "bad");
  }
  if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
}
// ---- fleet missions: warships work a system like a pirate mandate, but it's YOUR
// ship — you keep 100% of the take and pay no fee (upkeep is the cost), at the
// risk of combat wear (and, for a small hull pushed into an infested system, loss).
function shipMissionLevel(s) { const def = FLEET_SHIPS[s.key]; return def ? Math.max(1, CLASS_ORDER.indexOf(def.cls) + 1) : 2; }   // corvette 2 … battleship 5
function fleetMissionEst(lvl, planetId, task, dur) { const t = MANDATE_TASKS[task] || MANDATE_TASKS.cull; return Math.round((t.base + lvl * t.perLvl) * mandateAct(planetId, t) * dur); }   // 100% cut
function fleetMissionDamage(s, task, planetId) {
  const cls = SHIP_CLASSES[(FLEET_SHIPS[s.key] || {}).cls] || SHIP_CLASSES.corvette;
  let base = pirateLevel(planetId) * 4 * (0.4 + Math.random() * 0.8);
  if (task === "protect") base *= 0.35;                       // patrolling is far safer than raiding/culling
  return Math.round(base / Math.max(0.7, cls.hull));
}
function assignFleetMission(shipId, planetId, task, dur) {
  const s = fleetList().find(x => x.id === shipId); const def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (def.role !== "warship") return toast("Only warships can take a mission.", "bad");
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  if (!MANDATE_TASKS[task]) return; dur = MANDATE_DURATIONS.includes(dur) ? dur : 6;
  if (!planetId || !PLANETS.find(p => p.id === planetId)) return toast("Pick a target system.", "bad");
  s.status = "mission"; s.mission = { planet: planetId, task, cyclesLeft: dur, total: dur, accrued: 0 };
  const t = MANDATE_TASKS[task];
  log(`🎯 Dispatched your ${def.ico} ${s.name} to <b>${t.name.toLowerCase()}</b> at ${mdPlanetName(planetId)} for ${dur} cycles.`, "event");
  toast(`${s.name} on mission (${dur} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallFleetMission(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "mission" || !s.mission) return;
  S.res.credits += s.mission.accrued;
  log(`🎯 Recalled your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} — banked ${fmt(s.mission.accrued)} cr from the run.`, "good");
  toast(`${s.name} recalled`, "good"); s.status = "idle"; s.mission = null; saveGame(); renderAll();
}
function processFleet() {
  const f = fleetList(); if (!f.length) return;
  f.forEach(s => { if (s.status === "building" && --s.buildLeft <= 0) { s.status = "idle"; s.buildLeft = 0; const def = FLEET_SHIPS[s.key]; log(`✅ The ${def ? def.ico + " " + s.name : s.name} launched from ${(PLANETS.find(p => p.id === s.home) || {}).name || "the yard"} — ready for orders.`, "good"); digestNote("arrivals", `${s.name} launched`); } });
  // missions
  f.forEach(s => {
    if (s.status !== "mission" || !s.mission) return;
    const m = s.mission, t = MANDATE_TASKS[m.task], def = FLEET_SHIPS[s.key];
    if (!t) { s.status = "idle"; s.mission = null; return; }
    m.accrued += mandateCycleYield({ level: shipMissionLevel(s) }, m.planet, m.task);   // 100% — it's your ship
    if (t.suppress && Math.random() < t.suppress + 0.06 * shipMissionLevel(s)) S.pirates[m.planet] = Math.max(0, pirateLevel(m.planet) - 1);
    if (m.task === "raid") {
      const fac = (PLANETS.find(p => p.id === m.planet) || {}).faction, sanctioned = fac && commissionCovers(fac);
      if (!sanctioned) S.pirate.wanted = Math.min(100, (S.pirate.wanted || 0) + t.heat);
      if (fac) addRep(fac, -1); clampPirate();
    }
    const dmg = fleetMissionDamage(s, m.task, m.planet);
    if (dmg > 0) {
      s.hull = Math.max(0, s.hull - dmg);
      if (s.hull <= 0) {                                       // lost with all hands — you still keep what it earned
        S.res.credits += m.accrued;
        log(`💥 Your ${def.ico} ${s.name} was lost on its ${t.name.toLowerCase()} at ${mdPlanetName(m.planet)} — banked ${fmt(m.accrued)} cr before it went down.`, "bad");
        if (typeof toast === "function") toast(`${s.name} lost!`, "bad");
        digestNote("threats", `${s.name} lost at ${mdPlanetName(m.planet)}`);
        s._dead = true; return;
      }
    }
    if (--m.cyclesLeft <= 0) {
      S.res.credits += m.accrued; s.status = "idle";
      log(`🎯 Your ${def.ico} ${s.name} finished its ${t.name.toLowerCase()} at ${mdPlanetName(m.planet)} — banked <b>${fmt(m.accrued)} cr</b> (100% yours).`, "good");
      if (typeof toast === "function") toast(`${s.name}: +${fmt(m.accrued)} cr`, "good");
      digestNote("arrivals", `${s.name} completed its mission (+${fmt(m.accrued)} cr)`);
      s.mission = null;
    }
  });
  if (f.some(s => s._dead)) S.fleet = f.filter(s => !s._dead);
  processConvoys();
  const up = fleetUpkeep();
  if (up > 0) { const paid = Math.min(S.res.credits || 0, up); S.res.credits -= paid; if (typeof cycleLedger === "function") cycleLedger("fleet upkeep", -paid); if (paid < up) log(`⚠️ You couldn't fully cover fleet upkeep (${fmt(up)} cr) — crews grumble.`, "bad"); }
}

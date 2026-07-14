/* ============================================================
   STELLAR FRONTIER — player fleet
   Ships built at colony shipyards (freighters, tankers & warships), fully
   under the player's command: ordering/scrapping/repairing hulls, calling
   ships into a raid as allies, the raid Battle Group (posture, tactical
   formation tiers, firepower/damage), stationing freighters and their
   warship escorts on logistics duty at a colony (convoy ambushes and
   all), dispatching warships on system missions (the player-owned mirror
   of a band Mandate), and dispatching tankers on autonomous, multi-cycle
   Tanker Runs to haul fuel between worlds (slow by design — see
   fleetShipSpeed/tankerRunCycles — and exposed to piracy/authority-
   interception risk the whole way, damped by any escorting warships).
   renderFleet() and its session-only UI form state (fleetMissionForm,
   fleetLogiForm) stay in game.js — they move with the rest of the
   render* functions in the eventual rendering slice, same as every
   render function so far.

   Loaded after colonization.js, before game.js. combatLocked, fmt, log,
   addRep, digestNote, mdPlanetName, cycleLedger, commissionCovers,
   clampPirate, pirateLevel, mandateCycleYield, MANDATE_TASKS, galaxyKnown,
   sellPrice, saveGame and renderAll still live in other files/game.js at
   this point in the split — safe, since every function here is only
   CALLED later, once every script has finished loading, same pattern as
   every prior slice.
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
  // `speed` is a multiplier read via fleetShipSpeed() — freighters are built
  // for pace, running exactly 2x their comparable tanker tier's speed (see
  // Slice 16); a Bulk Hauler's tier-4 speed lands at the 1.0 baseline every
  // unlisted hull (warships included) implicitly gets.
  light_freighter: { role: "freighter", cls: "corvette",   name: "Light Freighter",  ico: "🚚", tier: 1, build: 2, cap: 120, speed: 1.90, cost: { credits: 2500,  metals: 30,  radioactives: 6 } },
  med_freighter:   { role: "freighter", cls: "frigate",    name: "Medium Freighter", ico: "🚛", tier: 2, build: 3, cap: 240, speed: 1.60, cost: { credits: 5000,  metals: 60,  electronics: 6,  radioactives: 12, ai: 2 } },
  heavy_freighter: { role: "freighter", cls: "cruiser",    name: "Heavy Freighter",  ico: "🚍", tier: 3, build: 5, cap: 420, speed: 1.30, cost: { credits: 9000,  metals: 110, electronics: 14, radioactives: 20, ai: 4 } },
  bulk_freighter:  { role: "freighter", cls: "battleship", name: "Bulk Hauler",      ico: "🛳️", tier: 4, build: 7, cap: 700, speed: 1.00, cost: { credits: 16000, metals: 200, alloys: 20, electronics: 24, radioactives: 32, ai: 7 } },
  // ---- tankers (fuel-hauling specialists; weak guns like freighters, but SLOW —
  // laden with fuel rather than dry cargo, so even after Slice 16's speed-up
  // they still run at exactly half their comparable freighter tier's pace.
  // Built and repaired exactly like any other hull; their own Tanker Run duty
  // (below) is what makes their speed matter, not construction or upkeep ----
  tanker_coastal: { role: "tanker", cls: "corvette",   name: "Coastal Tanker",     ico: "🛢️", tier: 1, build: 2, cap: 160, speed: 0.95, cost: { credits: 2200,  metals: 26,  radioactives: 10 } },
  tanker_medium:  { role: "tanker", cls: "frigate",    name: "Medium Tanker",      ico: "🚢", tier: 2, build: 3, cap: 320, speed: 0.80, cost: { credits: 4500,  metals: 52,  electronics: 5,  radioactives: 20, ai: 2 } },
  tanker_super:   { role: "tanker", cls: "cruiser",    name: "Super Tanker",       ico: "🛳️", tier: 3, build: 5, cap: 560, speed: 0.65, cost: { credits: 8200,  metals: 95,  electronics: 12, radioactives: 34, ai: 4 } },
  tanker_ultra:   { role: "tanker", cls: "battleship", name: "Ultra-Large Tanker", ico: "🚛", tier: 4, build: 7, cap: 900, speed: 0.50, cost: { credits: 14500, metals: 175, alloys: 16, electronics: 20, radioactives: 54, ai: 7 } },
  // ---- warships (defense; combat stats from SHIP_CLASSES) ----
  corvette:   { role: "warship", cls: "corvette",   name: "Corvette",   ico: "🚤", tier: 1, build: 2, cost: { credits: 3500,  metals: 40,  electronics: 6,  radioactives: 8,  weapons: 3,  drones: 2 } },
  frigate:    { role: "warship", cls: "frigate",    name: "Frigate",    ico: "🚢", tier: 2, build: 3, cost: { credits: 7000,  metals: 80,  electronics: 14, radioactives: 15, weapons: 6,  drones: 3,  ai: 3 } },
  cruiser:    { role: "warship", cls: "cruiser",    name: "Cruiser",    ico: "🛡️", tier: 3, build: 5, cost: { credits: 13000, metals: 150, alloys: 18, electronics: 26, radioactives: 26, weapons: 10, drones: 6,  ai: 6 } },
  battleship: { role: "warship", cls: "battleship", name: "Battleship", ico: "⚔️", tier: 4, build: 8, cost: { credits: 26000, metals: 280, alloys: 40, electronics: 50, radioactives: 40, weapons: 16, drones: 10, ai: 10, plasmatorp: 4 } },
  // ---- passenger liners (ferry population between worlds; cap is passengers in
  // thousands, same scale as a colony's own col.pop). Unarmed civil hulls — tanky
  // like a warship of the same class (they're meant to survive to be crippled, not
  // fight), but with near-zero firepower, and flat half-speed (fleetShipSpeed) no
  // matter the tier, since a warship's own speed never varies by class either ----
  shuttle_transit:  { role: "passenger", cls: "corvette",   name: "Transit Shuttle",   ico: "🛸", tier: 1, build: 2, cap: 1,  speed: 0.5, cost: { credits: 3000,  metals: 34,  electronics: 4,  radioactives: 8 } },
  packet_passenger: { role: "passenger", cls: "frigate",    name: "Passenger Packet",  ico: "🚢", tier: 2, build: 3, cap: 2.5, speed: 0.5, cost: { credits: 6200,  metals: 68,  electronics: 10, radioactives: 15, ai: 2 } },
  liner_luxury:     { role: "passenger", cls: "cruiser",    name: "Luxury Liner",      ico: "🛳️", tier: 3, build: 5, cap: 5,  speed: 0.5, cost: { credits: 11500, metals: 125, alloys: 14, electronics: 20, radioactives: 26, ai: 4 } },
  colony_ship:      { role: "passenger", cls: "battleship", name: "Colony Ship",       ico: "🛰️", tier: 4, build: 8, cap: 10, speed: 0.5, cost: { credits: 21000, metals: 230, alloys: 32, electronics: 36, radioactives: 40, ai: 8 } },
};
const FLEET_SHIP_KEYS = Object.keys(FLEET_SHIPS);
function fleetList() { if (!Array.isArray(S.fleet)) S.fleet = []; return S.fleet; }
function fleetIsHauler(def) { return def.role === "freighter" || def.role === "tanker"; }   // both are cargo hulls with weak guns, scaled off cap not combat class
function fleetIsPassenger(def) { return def.role === "passenger"; }   // unarmed civil hulls, tanky like a warship, scaled off cap for upkeep like a hauler
function fleetShipSpeed(def) { return def.speed != null ? def.speed : 1; }   // tankers/freighters/passenger liners carry their own; everything else defaults to full speed
function fleetShipHullMax(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return fleetIsHauler(def) ? Math.round(FLEET_HULL_BASE * 0.7 + (def.cap || 0) * 0.08) : Math.round(FLEET_HULL_BASE * c.hull); }
function fleetShipStr(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return fleetIsPassenger(def) ? Math.round(FLEET_FP_BASE * c.str * 0.05) : fleetIsHauler(def) ? Math.round(FLEET_FP_BASE * c.str * 0.35) : Math.round(FLEET_FP_BASE * c.str); }
function fleetShipUpkeep(def) { const c = SHIP_CLASSES[def.cls] || SHIP_CLASSES.corvette; return (fleetIsHauler(def) || fleetIsPassenger(def)) ? Math.round(15 + (def.cap || 0) * 0.06) : Math.round(40 * c.str); }
function fleetUpkeep() { return fleetList().filter(s => s.status !== "building").reduce((sum, s) => sum + (FLEET_SHIPS[s.key] ? fleetShipUpkeep(FLEET_SHIPS[s.key]) : 0), 0); }
function colonyShipyardTier(pid) { const col = S.colonies && S.colonies[pid]; return (col && col.buildings && col.buildings.shipyard) || 0; }
// a base's Small Shipyard module — a colony's full-range Shipyard always takes
// precedence if a colony and a base somehow coexist on the same world (neither
// colonize() nor buildBase() checks for the other), so these stay separate
// rather than blended by Math.max: a Small Shipyard is capped to light hulls
// (its own tiers:2 ceiling, catalogs.js) no matter how big a same-world
// colony Shipyard might independently be.
function baseShipyardTier(pid) { const b = S.bases && S.bases[pid]; return (b && b.modules && b.modules.shipyard_small) || 0; }
function shipyardTierAt(pid) { const c = colonyShipyardTier(pid); return c > 0 ? c : baseShipyardTier(pid); }
function shipyardVenueAt(pid) { return colonyShipyardTier(pid) > 0 ? "colony" : (baseShipyardTier(pid) > 0 ? "base" : null); }
function fleetBuildingAt(pid) { return fleetList().filter(s => s.home === pid && s.status === "building").length; }
function fleetNameFor(def, key) { const n = fleetList().filter(s => s.key === key).length + 1; return `${def.name} ${n}`; }
function fleetMatsOf(def) { const m = {}; Object.keys(def.cost).forEach(k => { if (k !== "credits") m[k] = def.cost[k]; }); return m; }
// A hull under construction draws its materials from wherever it's being built first —
// the colony's own storage for a colony Shipyard, the base's own storage for a base Small
// Shipyard — and only dips into the player's own hold for whatever the local stockpile can't
// cover. Same commodity-code vocabulary as colonyDeposit/transferToBase, so no new state shape.
function shipyardLocalStorage(pid) {
  const venue = shipyardVenueAt(pid);
  if (venue === "colony") return S.colonies[pid].storage;
  if (venue === "base") return S.bases[pid].storage;
  return null;
}
function canAffordMats(mats, local) { return Object.entries(mats).every(([k, v]) => ((local && local[k]) || 0) + (S.res[k] || 0) >= v); }
// build-menu preview: same red/green-by-affordability convention as colonization.js's matsString,
// but checking local stockpile + hold combined since that's what orderShip will actually draw on.
// COM[c] || META[c]: a cost dict can also name a meta resource (e.g. "tech") that lives in
// S.res alongside cargo but is never in COM's commodity catalog — Labor Relief's surge cost is.
function fleetMatsString(mats, local) {
  return Object.entries(mats).map(([c, q]) => {
    const have = ((local && local[c]) || 0) + (S.res[c] || 0);
    return `<span style="color:${have >= q ? "inherit" : "var(--bad)"}">${q}${(COM[c] || META[c]).ico}</span>`;
  }).join(" ");
}
function payMats(mats, local) {
  Object.entries(mats).forEach(([k, v]) => {
    const fromLocal = Math.min((local && local[k]) || 0, v);
    if (fromLocal > 0) local[k] -= fromLocal;
    const rest = v - fromLocal;
    if (rest > 0) S.res[k] = (S.res[k] || 0) - rest;
  });
}
function orderShip(shipKey) {
  const pid = S.location;
  const def = FLEET_SHIPS[shipKey]; if (!def) return;
  const yard = shipyardTierAt(pid);
  if (yard <= 0) return toast("No Shipyard here — build one at a colony, or a Small Shipyard module at a base.", "bad");
  if (def.tier > yard) return toast(`A Tier ${def.tier} Shipyard is needed to lay down a ${def.name}.`, "bad");
  if (fleetBuildingAt(pid) >= yard) return toast(`All ${yard} slipway(s) here are busy — wait for a hull to launch.`, "bad");
  if ((S.res.credits || 0) < def.cost.credits) return toast(`A ${def.name} costs ${fmt(def.cost.credits)} cr.`, "bad");
  const mats = fleetMatsOf(def), local = shipyardLocalStorage(pid);
  if (!canAffordMats(mats, local)) return toast("Need materials in " + (local ? "the local stockpile or " : "") + "your hold: " + Object.keys(mats).map(c => `${mats[c]} ${COM[c].name}`).join(", ") + ".", "bad");
  S.res.credits -= def.cost.credits; payMats(mats, local);
  const hm = fleetShipHullMax(def);
  fleetList().push({ id: "sh" + S.turn + "_" + Math.floor(Math.random() * 1e4), key: shipKey, name: fleetNameFor(def, shipKey), home: pid, status: "building", buildLeft: def.build, hull: hm, hullMax: hm });
  log(`🏗️ Laid down a ${def.ico} ${def.name} at ${currentPlanet().name} — ${def.build} cycles to launch.`, "event");
  toast(`${def.name} under construction`, "good"); sfx("event"); saveGame(); renderAll();
}
const SCRAP_REFUND_PCT = 0.4, SCRAP_RECYCLE_BONUS_PCT = 0.6;
// a Tier 2 base Small Shipyard is a proper recycling line, not just a slipway —
// gated to the base module specifically (not colony Shipyards) per the brainstorm's
// own framing of the salvage bonus as a Small Shipyard perk.
function scrapRefundPct() { return baseShipyardTier(S.location) >= 2 ? SCRAP_RECYCLE_BONUS_PCT : SCRAP_REFUND_PCT; }
function scrapShip(id) {
  const i = fleetList().findIndex(s => s.id === id); if (i < 0) return;
  const s = fleetList()[i], def = FLEET_SHIPS[s.key];
  if (s.status === "mission" || s.status === "escort" || s.status === "logistics" || s.status === "convoy" || s.status === "patrol" || s.status === "tanker_run") return toast("That ship is on duty — recall it first.", "bad");
  const pct = scrapRefundPct(), bonus = pct > SCRAP_REFUND_PCT;
  const refund = def ? Math.round((def.cost.metals || 0) * pct) : 0;
  if (typeof confirm === "function"
      && !confirm(`Scrap the ${s.name}? This cannot be undone${refund ? ` (salvages ${refund} metals${bonus ? " — recycling bonus" : ""})` : ""}.`)) return;
  if (refund) S.res.metals = (S.res.metals || 0) + refund;
  fleetList().splice(i, 1);
  log(`♻️ Scrapped the ${def ? def.ico + " " + s.name : s.name}${refund ? ` — salvaged ${refund} ⛓️ metals${bonus ? " (recycling bonus)" : ""}` : ""}.`, "");
  toast("Ship scrapped", ""); saveGame(); renderAll();
}
function fleetRepairCost(s) { const miss = (s.hullMax || 0) - (s.hull || 0); return { miss, credits: Math.round(miss * 9), metals: Math.ceil(miss / 12) }; }
function repairFleetShip(id) {
  const s = fleetList().find(x => x.id === id); if (!s || s.status === "building") return;
  if (shipyardTierAt(S.location) <= 0 || s.home !== S.location) return toast("Repair at the ship's home shipyard.", "bad");
  const c = fleetRepairCost(s); if (c.miss <= 0) return toast("That ship is already sound.", "bad");
  const local = shipyardLocalStorage(S.location), mats = { metals: c.metals };
  if ((S.res.credits || 0) < c.credits || !canAffordMats(mats, local)) return toast(`Repair needs ${fmt(c.credits)} cr · ${c.metals} ⛓️.`, "bad");
  S.res.credits -= c.credits; payMats(mats, local); s.hull = s.hullMax; s.crippled = false;
  log(`🔧 Repaired the ${s.name} for ${fmt(c.credits)} cr.`, "good"); toast("Ship repaired", "good"); sfx("repair"); saveGame(); renderAll();
}
// ---- reassign a ship's home shipyard — lets a fleet built up piecemeal across
// several colonies be consolidated (or just moved closer to where you operate),
// since repair, convoy assignment and slipway accounting are all keyed off `home` ----
function shipyardReassignCost(def) { return Math.max(200, Math.round(def.cost.credits * 0.08)); }
function reassignShipyard(shipId) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  const pid = S.location, yard = shipyardTierAt(pid);
  if (yard <= 0) return toast("No Shipyard here — build one at a colony, or a Small Shipyard module at a base.", "bad");
  if (def.tier > yard) return toast(`A Tier ${yard} Shipyard can't service a ${def.name} — needs Tier ${def.tier}.`, "bad");
  if (s.home === pid) return toast(`The ${s.name} is already based here.`, "bad");
  const cost = shipyardReassignCost(def);
  if ((S.res.credits || 0) < cost) return toast(`Re-registering home port costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  const oldHome = (PLANETS.find(p => p.id === s.home) || {}).name || "its old port";
  s.home = pid;
  log(`⚓ Your ${def.ico} ${s.name} re-registers its home port from ${oldHome} to <span class="c">${currentPlanet().name}</span> for ${fmt(cost)} cr.`, "event");
  toast(`${s.name} now based at ${currentPlanet().name}`, "good"); sfx("event"); saveGame(); renderAll();
}
// ---- ship customization: a Small Shipyard can refit its own hulls with a permanent
// Cargo or Combat loadout, up to 3 levels, paid from hold materials. A ship commits to
// a lean on its first refit and can't switch — matches Escort's per-vessel stance
// precedent (escort.js) but on a different currency (plain hold materials, not the
// escort weapons/drones/ai pool) since this is a construction-venue mechanic, not a
// combat one. Gated to the ship's home BASE Small Shipyard specifically (not a colony
// Shipyard) — the brainstorm frames customization as a Small Shipyard perk, and it
// gives the base module a reason to matter even once a colony Shipyard outranks it.
const LOADOUT_MAX_LEVEL = 3, LOADOUT_CARGO_PER_LEVEL = 40, LOADOUT_HULL_PER_LEVEL = 15, LOADOUT_STR_PER_LEVEL = 8;
const LOADOUT_LEANS = { cargo: { ico: "📦", name: "Cargo Loadout", hint: `+${LOADOUT_CARGO_PER_LEVEL} cargo capacity per level` },
                         combat: { ico: "🔥", name: "Combat Loadout", hint: `+${LOADOUT_HULL_PER_LEVEL} hull · +${LOADOUT_STR_PER_LEVEL} firepower per level` } };
function loadoutUpgradeCost(lvl) { return { metals: 20 * lvl, electronics: 10 * lvl }; }
function shipCargoCap(s) { const def = FLEET_SHIPS[s.key]; return def ? (def.cap || 0) + (s.cargoBonus || 0) : 0; }
function shipStrEff(s) { const def = FLEET_SHIPS[s.key]; return def ? fleetShipStr(def) + (s.combatBonus || 0) : 0; }
function upgradeLoadout(shipId, lean) {
  if (!LOADOUT_LEANS[lean]) return;
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  if (baseShipyardTier(S.location) <= 0 || s.home !== S.location) return toast("Refit at the ship's home Small Shipyard.", "bad");
  if (s.loadout && s.loadout !== lean) return toast(`${s.name} is already committed to a ${LOADOUT_LEANS[s.loadout].name} — scrap and rebuild to switch.`, "bad");
  const lvl = s.loadoutLevel || 0;
  if (lvl >= LOADOUT_MAX_LEVEL) return toast(`${s.name}'s loadout is already maxed.`, "bad");
  const cost = loadoutUpgradeCost(lvl + 1);
  if (!canAfford(cost)) return toast("Need materials in your hold: " + Object.keys(cost).map(c => `${cost[c]} ${COM[c].name}`).join(", ") + ".", "bad");
  pay(cost);
  s.loadout = lean; s.loadoutLevel = lvl + 1;
  if (lean === "cargo") { s.cargoBonus = (s.cargoBonus || 0) + LOADOUT_CARGO_PER_LEVEL; }
  else { s.hullMax = (s.hullMax || 0) + LOADOUT_HULL_PER_LEVEL; s.hull = (s.hull || 0) + LOADOUT_HULL_PER_LEVEL; s.combatBonus = (s.combatBonus || 0) + LOADOUT_STR_PER_LEVEL; }
  log(`🛠️ Refit the ${def.ico} ${s.name} — ${LOADOUT_LEANS[lean].ico} ${LOADOUT_LEANS[lean].name} Lv${s.loadoutLevel}/${LOADOUT_MAX_LEVEL}.`, "event");
  toast(`${s.name}: ${LOADOUT_LEANS[lean].name} Lv${s.loadoutLevel}`, "good"); sfx("repair"); saveGame(); renderAll();
}
// ---- fleet warships as loyal, free combat allies (raids & escorts) ----
// A warship set to FOLLOW travels with the player rather than being pinned to one world — mirrors
// assignLogistics' idle-warship gate, but for any world (not colony-only) and warships only, since
// raid/Battle Group support only ever needs warships. Recalling frees it back to idle, same shape
// as recallLogistics. (Still stored as status:"patrol" — the on-call duty itself, not the old
// per-world pin, which is what "station" used to encode; a following ship never sets it.)
function assignPatrol(shipId) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "warship") return toast("Only warships can follow you.", "bad");
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  s.status = "patrol"; s.station = null;
  log(`🛰️ Your ${def.ico} ${s.name} will follow you now — on call for any raid, wherever you travel.`, "event");
  toast(`${s.name} is now following you`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallPatrol(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "patrol") return;
  s.status = "idle"; s.station = null;
  log(`🛰️ Your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} stopped following you.`, "");
  toast(`${s.name} recalled`, ""); saveGame(); renderAll();
}
// every following warship is raidable everywhere, always — no longer pinned to one world
function fleetRaidable() { return fleetList().filter(s => s.status === "patrol" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }
// idle warships docked at the player's own current location — eligible to rally into the convoy
// escort (escortRallyFleet). A distinct pool from fleetRaidable(): "following" duty is for raid
// support wherever the player roams, but rallying into an escort run departing from here only
// makes sense for a hull that's actually docked here right now, not one already off on call.
function fleetEscortable() { return fleetList().filter(s => s.status === "idle" && s.home === S.location && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }
// is ANY fleet ship physically present at this world, in any duty (on a mission there, stationed
// there, following the player who's there, or simply docked idle/building at its own home)? Used
// both by the galaxy map's fleet pills and to grant free pirate intel wherever the fleet has eyes.
function fleetPresentAt(pid) {
  return fleetList().some(s =>
    (s.status === "mission" && s.mission && s.mission.planet === pid) ||
    (s.status === "logistics" && s.station === pid) ||
    (s.status === "patrol" && pid === S.location) ||
    ((s.status === "idle" || s.status === "building") && s.home === pid));
}
function fleetAsAlly(s) { const def = FLEET_SHIPS[s.key]; return { isFleet: true, fleetId: s.id, allyName: s.name, name: s.name, ico: def.ico, strength: Math.round(shipStrEff(s) * 2.5), share: 0 }; }   // loyal, no loot cut
function raidSummonFleet(shipId) {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your wing is full (2 allies).", "bad");
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "warship" || s.status !== "patrol") return toast("That ship isn't following you.", "bad");
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
  if (s.home !== S.location) return toast(`The ${s.name} is docked at ${mdPlanetName(s.home)} — rally it from there.`, "bad");
  if (e.fleet.some(sh => sh.fleetId === shipId)) return toast(`The ${s.name} already flies with the convoy.`, "bad");
  e.fleet.push({ role: "escort", hired: true, support: true, fleetId: shipId, name: s.name, ico: def.ico, hullMax: s.hullMax, hull: Math.round(s.hull), str: Math.round(shipStrEff(s) * 1.3), alive: true, stance: "balanced", fit: { aggressive: 0, balanced: 0, defensive: 0 } });
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
// a Personal Convoy warship rides with the player already, so it fights alongside a deployed
// Battle Group (or stands in for one on its own) using its own Vanguard/Line/Reserve station —
// this pool is for COMBAT PARTICIPATION only (who takes fire, who adds firepower); deploy/recall/
// stand-down stay scoped to battleGroupShips() alone, since a convoy ship's status never changes
// just because it took part in a fight.
function battleFleetShips() { return battleGroupShips().concat(convoyWarships()); }
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
  const s = battleFleetShips().find(x => x.id === shipId); if (!s || !FORMATION_SLOTS[slot]) return;
  s.formation = slot; saveGame(); renderAll();
}
function battleGroupFrontTier() {   // the tier currently taking the brunt of incoming fire
  for (const t of FORMATION_TIERS) { const ships = battleFleetShips().filter(s => shipFormation(s) === t); if (ships.length) return ships; }
  return [];
}
function deployBattleGroup() {
  if (!S.prey) return toast("No engagement.", "bad");
  const idle = fleetRaidable(); if (!idle.length) return toast("No warships following you to deploy.", "bad");
  idle.forEach(s => { s.status = "battle"; });
  autoAssignFormation(idle.filter(s => !FORMATION_SLOTS[s.formation]));   // first-time deploys get a sensible default; prior manual picks stick
  log(`✦ Your battle fleet (${idle.length} ship${idle.length === 1 ? "" : "s"}) forms up around you — pooled firepower, no loot cut.`, "event");
  toast(`Battle fleet deployed (${idle.length})`, "event"); sfx("event"); afterAction();
}
// a deployed ship returns to following the player (not fully idle) — it stays on call for
// the next raid, wherever that is, without needing to be re-assigned every time. Every ship
// that can reach "battle" status came from fleetRaidable(), which only ever contains
// following ships, so stand-down always has a follow duty to return to.
function battleGroupStandDown(s) { s.status = "patrol"; }
function recallBattleGroup() {
  const grp = battleGroupShips(); if (!grp.length) return;
  grp.forEach(battleGroupStandDown);
  log(`✦ Your battle fleet peels off and returns to standby.`, "");
  toast("Battle fleet recalled", ""); saveGame(); renderAll();
}
function releaseBattleGroup() {   // combat ended: stand the group down (survivors keep their wear, repairable at a shipyard)
  const grp = battleGroupShips(); if (!grp.length) return;
  grp.forEach(battleGroupStandDown);
}
function battleGroupScreenMult() {   // your formation screens (or exposes) you — a standing Vanguard shields you further
  const grp = battleFleetShips(); if (!grp.length) return 1;
  const vanguardHolds = grp.some(s => shipFormation(s) === "vanguard");
  return battleGroupPostureObj().def * (vanguardHolds ? 0.85 : 1.1);
}
function battleGroupFirepower() {
  const grp = battleFleetShips(); if (!grp.length) return 0;
  const off = battleGroupPostureObj().off;
  return Math.round(grp.reduce((sum, s) => sum + shipStrEff(s) * (0.5 + 0.5 * (s.hull / s.hullMax)) * FORMATION_SLOTS[shipFormation(s)].fpMult, 0) * off);
}
// each combat round, the frontmost non-empty tier absorbs the hit (85% of the time; 15% stray
// fire ignores tiering) — a formation collapses tier by tier as its defenders are lost.
function battleGroupTakeFire(prey) {
  const grp = battleFleetShips(); if (!grp.length) return 0;
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
function colonyHaulCap(pid) { return colonyHaulers(pid).reduce((s, x) => s + shipCargoCap(x), 0); }
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
// ---- Tanker Runs: dispatch an idle tanker on an autonomous, multi-cycle fuel-hauling
// run to another world — the tanker-family mirror of a warship's fleet mission
// (assignFleetMission, below), but hauling FUEL instead of working a mandate task, and
// taking several cycles to arrive because tankers are genuinely slow (fleetShipSpeed).
// Escorting warships (chosen at dispatch, from the tanker's own home world) ride along
// and damp the piracy risk every cycle, same shape processConvoys already uses for
// stationed guards. Authority interception is a separate risk, gated on Wanted — a
// seizure, not a firefight, so it costs cargo/credits/rep rather than hull. ----
const TANKER_RUN_MIN_CYCLES = 2, TANKER_RUN_MAX_CYCLES = 12;
function tankerRunCycles(dist, speed) { return Math.max(TANKER_RUN_MIN_CYCLES, Math.min(TANKER_RUN_MAX_CYCLES, Math.round((dist || 6) / (3 * (speed || 1))))); }
function tankerRunGuards(s) { return ((s.run && s.run.escorts) || []).filter(id => fleetList().some(x => x.id === id && x.status === "tanker_run")).length; }
function assignTankerRun(shipId, destId, escortIds) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "tanker") return toast("Only tankers can run fuel.", "bad");
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  const dest = PLANETS.find(p => p.id === destId);
  if (!dest || !isActive(dest) || destId === s.home || !galaxyKnown(dest)) return toast("Pick a known destination.", "bad");
  const home = PLANETS.find(p => p.id === s.home);
  const dist = (home && home.distances && home.distances[destId]) || 6;
  const fuel = s.fuel || 0;                    // exactly whatever's already aboard via loadTanker() — dispatch never
                                                // draws MORE from local storage/hold on its own; a tanker may also
                                                // cast off empty (fuel === 0), e.g. to reposition or load at the destination
  s.fuel = 0;                                  // rolled into the run's own cargo below
  const escorts = [];
  (Array.isArray(escortIds) ? escortIds : []).forEach(id => {
    const w = fleetList().find(x => x.id === id), wd = w && FLEET_SHIPS[w.key];
    if (!w || !wd || wd.role !== "warship" || w.status !== "idle" || w.home !== s.home) return;
    w.status = "tanker_run"; w.escortFor = shipId; escorts.push(id);
  });
  const speed = fleetShipSpeed(def), cycles = tankerRunCycles(dist, speed);
  s.status = "tanker_run"; s.run = { to: destId, dist, totalCycles: cycles, cyclesLeft: cycles, fuel, escorts };
  log(`⛽ Your ${def.ico} ${s.name} casts off for <span class="c">${dest.name}</span>${fuel > 0 ? ` with ${fuel} fuel` : " empty"} — ${cycles} cycle(s), ${escorts.length ? `escorted by ${escorts.length} warship(s)` : "unescorted"}.`, "event");
  toast(`${s.name} → ${dest.name} (${cycles} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallTankerRun(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "tanker_run" || !s.run) return;
  if (s.run.cyclesLeft !== s.run.totalCycles) return toast(`The ${s.name} has already cleared port — it can't turn back now.`, "bad");
  s.fuel = s.run.fuel;                         // it never left port — the cargo stays aboard, ready to redispatch or unload
  (s.run.escorts || []).forEach(id => { const w = fleetList().find(x => x.id === id); if (w) { w.status = "idle"; w.escortFor = null; } });
  s.status = "idle"; s.run = null;
  log(`⛽ Recalled the ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} before it cleared port — cargo still aboard.`, "");
  toast(`${s.name} recalled`, ""); saveGame(); renderAll();
}
// send MORE protection to a tanker already under way — the Tanker Run mirror of escortRallyFleet
// (escort.js) rallying more hulls into an already-active Escort convoy. A reinforcement must be
// idle and docked at the SAME home port the tanker itself departed from (the only place it could
// plausibly set out from to catch up); once aboard it counts toward tankerRunGuards() for every
// remaining cycle of the trip, same as an escort assigned at dispatch, and is freed the same way
// on delivery or loss.
function reinforceTankerRun(tankerId, warshipId) {
  const s = fleetList().find(x => x.id === tankerId);
  if (!s || s.status !== "tanker_run" || !s.run) return toast("That tanker isn't on a run.", "bad");
  const w = fleetList().find(x => x.id === warshipId), wd = w && FLEET_SHIPS[w.key];
  if (!w || !wd || wd.role !== "warship" || w.status !== "idle") return toast("That ship isn't available.", "bad");
  if (w.home !== s.home) return toast(`Only warships docked at ${mdPlanetName(s.home)} can reinforce this run.`, "bad");
  w.status = "tanker_run"; w.escortFor = tankerId;
  s.run.escorts = s.run.escorts || []; s.run.escorts.push(warshipId);
  log(`🛡️ Your ${wd.ico} ${w.name} peels off to reinforce the ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name}'s run to ${mdPlanetName(s.run.to)}.`, "event");
  toast(`${w.name} escorting ${s.name}`, "good"); sfx("event"); saveGame(); renderAll();
}
// ---- Tanker Load/Unload: manual cargo management for an idle tanker docked at the player's
// current location — separate from a Tanker Run's own automatic top-up at dispatch (which still
// happens for whatever room is left after any fuel loaded here). Unlike Escort/Fleet mission
// cargo, this doesn't need a Shipyard — just a base or colony storeroom to draw from/deposit
// into, same reasoning localStockpileAt already uses for repairs. Deliberately base-before-colony
// on BOTH ends (unlike shipyardLocalStorage/localStockpileAt's colony-first precedence elsewhere)
// since the player asked for that exact order. Both take an optional qty — omit it (or pass
// null) to load/unload as much as possible, same as before this was made adjustable.
function loadTanker(shipId, qty) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "tanker") return;
  if (s.status !== "idle" || s.home !== S.location) return toast("Dock the tanker here to load it.", "bad");
  const room = shipCargoCap(s) - (s.fuel || 0);
  if (room <= 0) return toast(`The ${s.name} is already full.`, "bad");
  const want = qty == null ? room : Math.max(0, Math.min(room, Math.floor(qty)));
  if (want <= 0) return toast("Enter a quantity to load.", "bad");
  const b = S.bases[S.location], col = S.colonies[S.location];
  let loaded = 0;
  if (b && loaded < want) { const take = Math.min(want - loaded, b.storage.fuel || 0); if (take > 0) { b.storage.fuel -= take; loaded += take; } }
  if (col && loaded < want) { const take = Math.min(want - loaded, col.storage.fuel || 0); if (take > 0) { col.storage.fuel -= take; loaded += take; } }
  if (loaded <= 0) return toast("No fuel available here to load.", "bad");
  s.fuel = (s.fuel || 0) + loaded;
  log(`⛽ Loaded ${loaded} fuel onto the ${def.ico} ${s.name} at ${currentPlanet().name}.`, "event");
  toast(`${s.name}: +${loaded} fuel`, "good"); sfx("event"); saveGame(); renderAll();
}
function unloadTanker(shipId, qty) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "tanker") return;
  if (s.status !== "idle" || s.home !== S.location) return toast("Dock the tanker here to unload it.", "bad");
  const carried = s.fuel || 0;
  if (carried <= 0) return toast(`The ${s.name} is carrying no fuel.`, "bad");
  const amt = qty == null ? carried : Math.max(0, Math.min(carried, Math.floor(qty)));
  if (amt <= 0) return toast("Enter a quantity to unload.", "bad");
  let left = amt;
  const parts = [];
  const toShip = Math.min(left, Math.max(0, fuelCap() - (S.res.fuel || 0)));
  if (toShip > 0) { S.res.fuel += toShip; left -= toShip; parts.push(`${toShip} to your tank`); }
  const b = S.bases[S.location];
  if (left > 0 && b) {
    const take = Math.min(left, Math.max(0, baseStorageCap(S.location) - baseStorageUsed(b)));
    if (take > 0) { b.storage.fuel = (b.storage.fuel || 0) + take; left -= take; parts.push(`${take} to the base`); }
  }
  const col = S.colonies[S.location];
  if (left > 0 && col) {
    const take = Math.min(left, Math.max(0, colonyStorageCap(col, currentPlanet()) - colonyStorageUsed(col)));
    if (take > 0) { col.storage.fuel = (col.storage.fuel || 0) + take; left -= take; parts.push(`${take} to the colony`); }
  }
  if (left > 0) { const pay = Math.round(left * sellPrice(S.location, "fuel")); S.res.credits += pay; parts.push(`sold ${left} for ${fmt(pay)} cr`); left = 0; }
  s.fuel = carried - amt;
  log(`⛽ Unloaded ${amt} fuel from the ${def.ico} ${s.name} at ${currentPlanet().name} — ${parts.join(", ")}.`, "good");
  toast(`${s.name}: -${amt} fuel`, "good"); sfx("event"); saveGame(); renderAll();
}
// ---- Passenger boarding/debarking: a passenger liner riding in the Personal Convoy can pick up
// and drop off souls wherever the player currently stands. Boarding is always a paid-ticket sale
// (fare revenue, win-win with the passengers themselves) — at one of your OWN colonies the
// tickets are drawn from that colony's own population (real emigration, col.pop falls); anywhere
// else (a core/faction world, a base, open space) it's abstracted as booking passage from the
// local populace, no source stockpile needed. Debarking at one of your own colonies delivers the
// souls into col.pop (same housing-capped growth the migrant-wave event already uses); anywhere
// else they simply disembark (flavor only — fulfils a point-to-point fare run with no colony tie).
const PASSENGER_FARE = 40;   // credits per head, collected on boarding
function boardPassengers(shipId, qty) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "passenger") return;
  if (s.status !== "convoy") return toast("Add the liner to your Personal Convoy first.", "bad");
  if (s.crippled) return toast(`The ${s.name} is a crippled hulk — repair it before booking passengers aboard.`, "bad");
  const room = shipCargoCap(s) - (s.passengers || 0);
  if (room <= 0) return toast(`The ${s.name} is already full.`, "bad");
  let want = qty == null ? room : Math.max(0, Math.min(room, qty));
  const col = S.colonies[S.location], planet = currentPlanet();
  if (col) want = Math.min(want, Math.max(0, col.pop - 1));   // never strip a colony down past 1k of its own people
  if (want <= 0) return toast(col ? "This colony has no one left to spare." : "Enter a quantity to board.", "bad");
  if (col) col.pop -= want;
  s.passengers = (s.passengers || 0) + want;
  const fare = Math.round(want * PASSENGER_FARE);
  S.res.credits += fare;
  log(`🧳 ${fmt(want)}k passengers boarded the ${def.ico} ${s.name} at ${planet.name}${col ? " (emigrating)" : ""} — ${fmt(fare)} cr in fares.`, "event");
  toast(`${s.name}: +${fmt(want)}k passengers, +${fmt(fare)} cr`, "good"); sfx("event"); saveGame(); renderAll();
}
function debarkPassengers(shipId, qty) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def || def.role !== "passenger") return;
  if (s.status !== "convoy") return toast("Only a liner in your Personal Convoy can debark here.", "bad");
  const carried = s.passengers || 0;
  if (carried <= 0) return toast(`The ${s.name} is carrying no passengers.`, "bad");
  const want = qty == null ? carried : Math.max(0, Math.min(carried, qty));
  if (want <= 0) return toast("Enter a quantity to debark.", "bad");
  const col = S.colonies[S.location], planet = currentPlanet();
  s.passengers = carried - want;
  if (col) {
    const housing = colonyHousing(col, planet);
    col.pop = Math.min(housing, col.pop + want);
    log(`✨ ${fmt(want)}k settlers from the ${def.ico} ${s.name} joined <span class="c">${planet.name}</span> (pop now ${fmt(col.pop)}k).`, "good");
  } else {
    log(`🧳 ${fmt(want)}k passengers disembarked the ${def.ico} ${s.name} at ${planet.name}.`, "event");
  }
  toast(`${s.name}: -${fmt(want)}k passengers`, "good"); sfx("event"); saveGame(); renderAll();
}
function tankerRunPirateRisk(s) {
  const r = s.run, def = FLEET_SHIPS[s.key];
  const lvl = Math.max(pirateLevel(r.to), pirateLevel(s.home));
  if (lvl <= 0) return;
  const guards = tankerRunGuards(s);
  const chance = (0.05 + lvl * 0.04) * Math.pow(0.45, guards);
  if (Math.random() >= chance) return;
  const dmg = Math.round(lvl * 6 * (0.5 + Math.random()) / (1 + guards));
  const loss = Math.min(r.fuel, Math.round(r.fuel * 0.25 * (0.5 + Math.random()) / (1 + guards)));
  s.hull = Math.max(0, s.hull - dmg); r.fuel -= loss;
  const name = mdPlanetName(r.to);
  if (s.hull <= 0) {
    s._dead = true;
    (r.escorts || []).forEach(id => { const w = fleetList().find(x => x.id === id); if (w) { w.status = "idle"; w.escortFor = null; } });
    log(`💥 Pirates destroyed your ${def.ico} ${s.name} running fuel toward ${name} — the whole cargo lost with it.`, "bad");
    if (typeof toast === "function") toast(`${s.name} lost to pirates!`, "bad");
    digestNote("threats", `${s.name} lost at ${name}`);
  } else {
    log(`🏴‍☠️ Pirates ambushed your tanker run toward ${name} — ${s.name} took ${dmg} damage${loss ? ` and lost ${loss} fuel` : ""}${guards ? " (your escort drove them off)" : " — pair it with a warship escort"}.`, "bad");
    digestNote("threats", `tanker run ambushed nearing ${name}`);
  }
}
function tankerRunInterceptRisk(s) {
  if ((S.pirate.wanted || 0) < 25) return;
  const r = s.run, dest = PLANETS.find(p => p.id === r.to); if (!dest) return;
  const chance = (S.pirate.wanted / 100) * dest.enforce * 0.5;
  if (Math.random() >= chance || r.fuel <= 0) return;
  const seized = r.fuel; r.fuel = 0;
  const fine = Math.min(S.res.credits || 0, Math.round(seized * COM.fuel.base * 0.3) + 100);
  S.res.credits -= fine; addRep(dest.faction, -4);
  log(`🚨 Customs intercepted your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} nearing ${mdPlanetName(r.to)} — ${seized} fuel confiscated, fined ${fmt(fine)} cr. Your Wanted status made it a target.`, "bad");
  if (typeof toast === "function") toast(`${s.name}: fuel seized!`, "bad");
}
function tankerRunDeliver(s) {
  const r = s.run, def = FLEET_SHIPS[s.key], dest = PLANETS.find(p => p.id === r.to);
  if (r.fuel <= 0) {
    log(`⛽ Your ${def.ico} ${s.name} arrived at ${dest.name} empty.`, "good");
    toast(`${s.name}: arrived at ${dest.name}`, "good");
  } else {
    const owned = (S.colonies && S.colonies[r.to]) || (S.bases && S.bases[r.to]);
    if (owned) {
      owned.storage.fuel = (owned.storage.fuel || 0) + r.fuel;
      log(`⛽ Your ${def.ico} ${s.name} delivered ${r.fuel} fuel to ${dest.name}'s storage.`, "good");
      toast(`${s.name}: delivered ${r.fuel} fuel`, "good");
    } else {
      const pay = Math.round(r.fuel * sellPrice(r.to, "fuel"));
      S.res.credits += pay;
      log(`⛽ Your ${def.ico} ${s.name} sold ${r.fuel} fuel at ${dest.name} for ${fmt(pay)} cr.`, "good");
      toast(`${s.name}: +${fmt(pay)} cr`, "good");
    }
  }
  digestNote("arrivals", `${s.name} completed a tanker run to ${dest.name}`);
  (r.escorts || []).forEach(id => { const w = fleetList().find(x => x.id === id); if (w) { w.status = "idle"; w.escortFor = null; w.home = r.to; } });
  s.status = "idle"; s.home = r.to; s.run = null;
}
function processTankerRuns() {
  const runs = fleetList().filter(s => s.status === "tanker_run" && s.run);
  runs.forEach(s => {
    tankerRunPirateRisk(s);
    if (s._dead || s.status !== "tanker_run") return;
    tankerRunInterceptRisk(s);
    if (s.status !== "tanker_run") return;
    if (--s.run.cyclesLeft <= 0) tankerRunDeliver(s);
  });
  if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
}
// ---- personal convoy: freighters ride WITH you on every jump, extending your OWN
// cargo hold on the road; warships (and any pirate bands riding with you) escort
// them, blunting an ambush's opening volley. Ambush ODDS are pure route risk —
// pirate activity at both ends of the jump (maybeAmbush, combat.js) — your escort
// can't stop you being found, only change what happens when you are. Distinct
// from logistics duty (above): that stations ships AT a colony to haul ITS goods
// on a per-cycle timer; this rides with the player and resolves on the per-jump
// travel-ambush cadence instead (maybeAmbush, combat.js).
// No cap on how many freighters can join (Slice 16) — the balancing lever is no
// longer a cargo ceiling but travel time: convoyTravelLegs() below stretches every
// jump to however many cycles tankerRunCycles() gives the SLOWEST freighter aboard,
// same shape a solo Tanker Run already uses, so a bigger convoy hauls more but the
// player moves only as fast as its slowest hauler. ----
function convoyShips()      { return fleetList().filter(s => s.status === "convoy"); }
function convoyFreighters() { return convoyShips().filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter"); }
function convoyWarships()   { return convoyShips().filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"); }
function convoyPassengerShips() { return convoyShips().filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "passenger"); }
function convoyGuardCount() { return convoyWarships().length + bandList().filter(bandFollowing).length; }   // your own escorts + any pirate bands riding with you
function convoyCargoBonus() {
  const frs = convoyFreighters(); if (!frs.length) return 0;
  return Math.round(frs.reduce((sum, s) => sum + shipCargoCap(s) * (0.5 + 0.5 * (s.hull / s.hullMax)), 0));   // a battered freighter hauls less, same shape as escShipFP — no ceiling, stack as many as you like
}
function convoyFuelSurcharge() {   // towing a convoy burns extra fuel every jump — scales with how many ships ride along, capped
  const n = convoyShips().length; if (!n) return 0;
  return Math.min(0.5, n * 0.08);
}
// travel()'s cycle cost for the jump about to depart from S.location toward destId —
// 1 with no convoy freighters (a normal jump); otherwise tankerRunCycles(dist, speed)
// keyed off the SLOWEST freighter riding along, so towing a big convoy of fast Light
// Freighters and one lumbering Bulk Hauler moves at the Bulk Hauler's pace, not the average.
function convoyTravelLegs(destId) {
  const frs = convoyFreighters(); if (!frs.length) return 1;
  const speed = Math.min(...frs.map(s => fleetShipSpeed(FLEET_SHIPS[s.key])));
  const dist = currentPlanet().distances[destId] || 6;
  return tankerRunCycles(dist, speed);
}
function assignConvoy(shipId) {
  const s = fleetList().find(x => x.id === shipId), def = s && FLEET_SHIPS[s.key];
  if (!s || !def) return;
  if (s.status !== "idle") return toast(`The ${s.name} isn't free.`, "bad");
  if (s.home !== S.location) return toast(`Dock at ${(PLANETS.find(p => p.id === s.home) || {}).name || "its home port"} to bring the ${s.name} aboard.`, "bad");
  s.status = "convoy";
  // first-time joiners get a role-shaped default station — warships screen up front,
  // freighters (the payload) hang back, same convention buildEscortFleet uses; a prior
  // manual pick sticks, same as deployBattleGroup's sticky formations
  if (!FORMATION_SLOTS[s.formation]) s.formation = def.role === "warship" ? "vanguard" : "reserve";
  log(`🚚 Your ${def.ico} ${s.name} falls in with your personal convoy.`, "event");
  toast(`${s.name} joined your convoy`, "good"); sfx("event"); saveGame(); renderAll();
}
function recallConvoy(shipId) {
  const s = fleetList().find(x => x.id === shipId); if (!s || s.status !== "convoy") return;
  s.status = "idle";
  log(`🚚 Recalled your ${(FLEET_SHIPS[s.key] || {}).ico || ""} ${s.name} from your personal convoy.`, "");
  toast(`${s.name} recalled`, ""); saveGame(); renderAll();
}
// ---- convoy formation: every convoy ship (and you — the same S.pirate.formation station
// the Raid tab's battle-fleet panel sets) sits in a Vanguard/Line/Reserve tier, reusing
// FORMATION_SLOTS/FORMATION_TIERS/shipFormation above as-is, same as Escort and Battle Group. ----
function setConvoyFormation(shipId, slot) {
  const s = convoyShips().find(x => x.id === shipId); if (!s || !FORMATION_SLOTS[slot]) return;
  s.formation = slot; saveGame(); renderAll();
}
function convoyFrontTier() {   // frontmost non-empty tier among you + your convoy — mirrors battleGroupFrontTier/escortFrontTier/raidFrontTier
  const pool = [{ isPlayer: true }].concat(convoyShips().map(s => ({ isPlayer: false, ship: s })));
  for (const t of FORMATION_TIERS) {
    const grp = pool.filter(o => (o.isPlayer ? playerFormation() : shipFormation(o.ship)) === t);
    if (grp.length) return grp;
  }
  return [];
}
// pirates ambushing you open with a volley — WHO takes it is a positioning question: 85% of
// the time the frontmost non-empty tier (you included), 15% stray fire reaching anyone, the
// same split battleGroupTakeFire/chooseIntent use. Guards (warships + following bands) blunt
// the DAMAGE, 1/(1+guards) — they no longer damp the odds of the ambush itself (maybeAmbush
// reads route piracy alone). Traveling with no convoy at all keeps the old flow: no volley,
// the encounter itself (pay/run/fight) is the whole threat.
// ---- Shared hull-loss resolution: a passenger liner still carrying souls is never actually
// destroyed by combat damage — it's crippled (pinned at 1 hull, out of the fight) and its
// passengers are automatically evacuated (rescued, not delivered — no colony credit for them,
// the cost of letting your liner get caught). Only once a hit lands with the hold already empty
// (an empty run, or a hull that already evacuated once) does the normal destroy-and-remove path
// apply. Returns "ok" | "crippled" | "dead" so call sites can pick their own flavor text. ----
function fleetShipHit(s, dmg) {
  const def = FLEET_SHIPS[s.key] || {};
  s.hull = Math.max(0, s.hull - dmg);
  if (s.hull > 0) return "ok";
  if (def.role === "passenger" && (s.passengers || 0) > 0) {
    s.hull = 1;
    s.passengers = 0;
    s.crippled = true;   // a hulk adrift — can't take on new passengers again until repaired (repairFleetShip clears this)
    return "crippled";
  }
  s._dead = true;
  return "dead";
}
function convoyAmbushRisk(lvl) {
  if (!convoyShips().length) return;
  const guards = convoyGuardCount();
  const front = convoyFrontTier();
  const pool = (front.length && Math.random() < 0.85) ? front : [{ isPlayer: true }].concat(convoyShips().map(s => ({ isPlayer: false, ship: s })));
  const target = pick(pool);
  const dmg = Math.round(lvl * 6 * (0.5 + Math.random()) / (1 + guards));
  if (target.isPlayer) {
    const taken = takeHullDamage(dmg);
    log(`🏴‍☠️ The opening volley finds YOUR hull — −${taken}. Your ${FORMATION_SLOTS[playerFormation()].name} station put you in their sights.`, "bad");
    return;
  }
  const f = target.ship, def = FLEET_SHIPS[f.key] || {};
  const isFreighter = def.role === "freighter";
  // cargo only spoils when the hit lands on a hauler — a warship tanking the volley keeps the goods safe
  const loss = isFreighter ? Math.min(S.res.credits || 0, Math.round(lvl * 40 * (0.5 + Math.random()) / (1 + guards))) : 0;
  if (loss > 0) { S.res.credits -= loss; if (typeof cycleLedger === "function") cycleLedger("convoy losses", -loss); }
  const outcome = fleetShipHit(f, dmg);
  if (outcome === "dead") {
    log(`💥 In the ambush, pirates ran down your ${def.ico || ""} ${f.name} (${FORMATION_SLOTS[shipFormation(f)].name})${isFreighter ? " — lost with its cargo" : ""}.`, "bad");
    if (typeof toast === "function") toast(`${f.name} lost to pirates!`, "bad");
  } else if (outcome === "crippled") {
    log(`🆘 Your ${def.ico || ""} ${f.name} (${FORMATION_SLOTS[shipFormation(f)].name}) is crippled — its passengers are evacuated to safety and the hulk is adrift, in need of repair.`, "bad");
    if (typeof toast === "function") toast(`${f.name} crippled — passengers evacuated!`, "bad");
  } else {
    log(`🏴‍☠️ Your convoy's ${def.ico || ""} ${f.name} (${FORMATION_SLOTS[shipFormation(f)].name}) took the opening volley — ${dmg} damage${loss ? ` and ${fmt(loss)} cr of goods spoiled` : ""}${guards ? " — your guards blunted it" : ""}.`, "bad");
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
  processTankerRuns();
  const up = fleetUpkeep();
  if (up > 0) { const paid = Math.min(S.res.credits || 0, up); S.res.credits -= paid; if (typeof cycleLedger === "function") cycleLedger("fleet upkeep", -paid); if (paid < up) log(`⚠️ You couldn't fully cover fleet upkeep (${fmt(up)} cr) — crews grumble.`, "bad"); }
}

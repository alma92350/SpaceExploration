/* ============================================================
   STELLAR FRONTIER — resources: extraction, reserves, pollution
   Generic cost/reward helpers used everywhere (canAfford, pay, gain,
   addRep, fmt, costString); hand extraction bound to a world's deposits
   (mine/forage/capture/exploit, plus salvage); finite per-planet reserves
   that deplete with player extraction and slowly recover (renewables fast,
   ores/relics barely at all); and the pollution/climate footprint industry
   and extraction leave behind, which decays when the player eases off.

   Loaded after feedback.js, before game.js. combatLocked, fxMult and
   nonFrontierPlanets still live in game.js/galaxygen.js at this point in
   the split — safe, since every function here is only CALLED later, once
   every script has finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

/* ---------- Resource helpers ---------- */
function canAfford(cost) { return Object.entries(cost).every(([k, v]) => (S.res[k] || 0) >= v); }
function pay(cost) { Object.entries(cost).forEach(([k, v]) => { S.res[k] -= v; }); }
function gain(reward) {
  Object.entries(reward).forEach(([k, v]) => {
    if (k === "perk") { S.perks[v] = true; return; }
    if (k === "rep")  { Object.entries(v).forEach(([f, n]) => addRep(f, n)); return; }
    S.res[k] = (S.res[k] || 0) + v;
  });
}
function addRep(f, n) { S.rep[f] = Math.max(-100, Math.min(100, (S.rep[f] || 0) + n)); }
function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
function costString(cost) {
  return Object.entries(cost).map(([k, v]) => {
    if (k === "rep") return Object.entries(v).map(([f, n]) => `${n>0?"+":""}${n} ${FACTIONS[f].ico}`).join(" ");
    if (k === "perk") return `Title: ${v}`;
    const ico = META[k] ? META[k].ico : COM[k] ? COM[k].ico : "";
    return `${fmt(v)} ${ico}`;
  }).join("  ");
}

/* ---------- Resource reserves & depletion ----------
   Every planet deposit holds a finite reserve. Extraction draws it down and
   yield falls with it — an over-mined world asymptotes to a ~25% trickle
   (never zero, no dead-ends), nudging you toward fresh worlds. Renewables
   (food, ice, gas) slowly regrow; ores/crystals/isotopes/relics do not.
*/
const RESERVE_PER_DEP = 2500;                       // reserve stock per 1.0 of deposit richness
const RENEWABLE_RES = { biomass: true, spice: true, ice: true, gas: true };
function reserveOf(pid, c) {
  if (!S.reserves) S.reserves = {};
  if (!S.reserves[pid]) S.reserves[pid] = {};
  if (!S.reserves[pid][c]) {
    const p = PLANETS.find(x => x.id === pid);
    const max = Math.round(RESERVE_PER_DEP * ((p && p.deposits && p.deposits[c]) || 0));
    S.reserves[pid][c] = { cur: max, max };
  }
  return S.reserves[pid][c];
}
function reserveFrac(pid, c) { const r = reserveOf(pid, c); return r.max > 0 ? r.cur / r.max : 1; }
function depletionMult(pid, c) { return 0.25 + 0.75 * reserveFrac(pid, c); }   // yield falloff, floored at 25%
function drawReserve(pid, c, amount) { const r = reserveOf(pid, c); r.cur = Math.max(0, r.cur - amount); }
function processReserves() {
  // Reserves only fall from PLAYER extraction (hand-mining + your colonies' extractors);
  // nothing drains them in the background. Every deposit also recovers slowly, so a world
  // is only depleted while you out-extract its natural recovery — over-exploitation, not fate.
  PLANETS.forEach(p => {
    if (!p.deposits) return;
    Object.keys(p.deposits).forEach(c => {
      const r = reserveOf(p.id, c);
      if (r.cur >= r.max) return;
      const rate = RENEWABLE_RES[c] ? 0.04 : 0.008;   // food/ice/gas rebound fast; ores/isotopes recover very slowly
      r.cur = Math.min(r.max, r.cur + Math.ceil(r.max * rate));
    });
  });
}

/* ---------- Pollution & climate ----------
   Industry and extraction foul the world they run on (0–100 per planet).
   Pollution decays naturally when activity stops — like depletion, it is a
   consequence of the player's footprint, not fate. The sector-wide mean
   drives a slow CLIMATE index with global effects on agriculture.
*/
function pollutionOf(pid) { return (S.pollution && S.pollution[pid]) || 0; }
function addPollution(pid, amt) {
  if (!S.pollution) S.pollution = {};
  if (typeof policyActive === "function" && policyActive("greenpact")) amt *= 0.5;  // emissions accord
  S.pollution[pid] = Math.max(0, Math.min(100, (S.pollution[pid] || 0) + amt));
}
function pollutionYieldMult(pid) { return 1 - pollutionOf(pid) * 0.003; }   // up to −30% extraction on a fouled world
function pollutionFarmMult(pid) {                                          // smog + climate both hurt crops (up to −40% / −25%)
  return (1 - pollutionOf(pid) * 0.004) * (1 - (S.climate || 0) * 0.0025);
}
function processPollution() {
  if (!S.pollution) S.pollution = {};
  Object.keys(S.pollution).forEach(pid => {
    S.pollution[pid] = Math.max(0, S.pollution[pid] - (policyActive("greenpact") ? 1.8 : 1)); // natural recovery when you ease off
    if (S.pollution[pid] <= 0) delete S.pollution[pid];
  });
  // climate: a slow, smoothed echo of sector-wide pollution — clamped, decaying, never runaway
  const _np2 = nonFrontierPlanets(); const mean = _np2.reduce((s, p) => s + pollutionOf(p.id), 0) / _np2.length;
  let cl = (S.climate || 0) + (mean * 4 - (S.climate || 0)) * 0.08;   // a few fouled worlds = real sector stress
  if (S.techs.terraform) cl -= 0.4;                                        // terraforming actively heals the sector
  if (policyActive("greenpact")) cl -= 0.2;
  S.climate = Math.max(0, Math.min(100, cl));
}

/* ---------- Extraction (mine / forage / capture / exploit) — location bound ---------- */
function extractMods(comId) {
  // returns {moduleMult, techMult, requiredModuleOk, blockMsg}
  const verb = COM[comId].extract;
  let mod = 1, tech = 1, ok = true, blockMsg = "";
  if (verb === "mine") { mod = 1 + S.upgrades.miner * 0.35; if (S.techs.deepcore) tech = 1.25; }
  else if (verb === "forage") { mod = 1 + S.upgrades.hydro * 0.35; if (S.techs.xenobio) tech = 1.25; }
  else if (verb === "capture") { // gas — needs scoop
    if (S.upgrades.gasscoop < 1) { ok = false; blockMsg = "Requires a Gas Scoop module."; }
    mod = 1 + S.upgrades.gasscoop * 0.30; if (S.techs.gasharvest) tech = 1.40;
  } else if (verb === "exploit") { mod = 1 + S.upgrades.salvager * 0.10; } // relics; light gear help
  return { mod, tech, ok, blockMsg };
}

function extract(comId) {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  const dep = p.deposits && p.deposits[comId];
  if (!dep) return toast(`${COM[comId].name} cannot be extracted here.`, "bad");
  if (cargoFree() <= 0) return toast("Cargo hold full!", "bad");
  const { mod, tech, ok, blockMsg } = extractMods(comId);
  if (!ok) return toast(blockMsg, "bad");
  let yld = Math.round(14 * dep * mod * tech * depletionMult(p.id, comId) * pollutionYieldMult(p.id) * fxMult("yieldMult"));
  yld = Math.min(yld, cargoFree());
  if (yld <= 0) return toast("No room in the hold.", "bad");
  S.res[comId] += yld; drawReserve(p.id, comId, yld);
  const verb2 = COM[comId].extract;
  addPollution(p.id, COM[comId].hazard ? 1.2 : (verb2 === "mine" || verb2 === "exploit") ? 0.6 : 0.2);
  useAction();
  const verbName = { mine: "Mined", forage: "Foraged", capture: "Captured", exploit: "Recovered" }[COM[comId].extract];
  log(`${verbName} <span class="c">${yld}</span> ${COM[comId].ico} ${COM[comId].name} on ${p.name}.`, "good");
  toast(`+${yld} ${COM[comId].ico} ${COM[comId].name}`, "good");
  if (COM[comId].extract === "exploit" && p.enforce > 0.3 && Math.random() < 0.3)
    log("Looting ruins draws unwanted attention…", "bad");
  afterAction();
}

function salvage() {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  if (!p.salvage) return toast("No wrecks to salvage here.", "bad");
  if (S.upgrades.salvager < 1) return toast("Requires a Salvage Rig module.", "bad");
  if (cargoFree() <= 0) return toast("Cargo hold full!", "bad");
  const mult = (1 + S.upgrades.salvager * 0.30) * (S.techs.salvaging ? 1.5 : 1);
  let metals = Math.round(8 * mult), parts = Math.round(3 * mult);
  metals = Math.min(metals, cargoFree());
  parts = Math.min(parts, cargoFree() - metals);
  S.res.metals += metals; S.res.electronics += parts;
  let bonus = "";
  if (Math.random() < 0.25 && cargoFree() - metals - parts > 0) {
    const find = Math.random() < 0.5 ? "relics" : "weapons";
    const q = 1 + Math.floor(Math.random() * 3);
    S.res[find] += Math.min(q, cargoFree() - metals - parts);
    bonus = ` Found ${q} ${COM[find].ico} ${COM[find].name}!`;
  }
  useAction();
  log(`Salvaged <span class="c">${metals}</span> metals & ${parts} electronics from wrecks.${bonus}`, "good");
  toast(`Salvage: +${metals} ⛓️ +${parts} 🖥️`, "good");
  afterAction();
}

/* ============================================================
   STELLAR FRONTIER — planetary crises
   Temporary disasters strike a world, disrupt its ecosystem/economy and spike
   the prices of what it suddenly needs. Triggered both at random (weighted by
   a world's nature) and by the player's own footprint (pollution, climate,
   over-exploitation). Prices spike through the normal target+clamp+mean-
   reversion machinery, so they swell during the crisis and fade as it passes.
   Three player responses: donate relief (the hero's path), gouge prices (the
   vulture's), or loot the chaos outright.

   Loaded after data.js and galaxygen.js, before game.js, which calls into
   startCrisis()/processCrises() from the turn loop and reads S.crises /
   CRISES elsewhere (pirate/encounter modifiers, rendering).
   ============================================================ */

"use strict";

const CRISES = {
  quake:      { ico: "🌍", name: "Earthquake",          spike: { machinery: 1.6, goods: 1.4, medicine: 1.5 }, pollute: 2 },
  volcano:    { ico: "🌋", name: "Volcanic Eruption",   spike: { metals: 1.5, machinery: 1.5, medicine: 1.4 }, pollute: 8 },
  plague:     { ico: "🦠", name: "Plague Outbreak",     spike: { medicine: 2.0, biomass: 1.3 },               pollute: 0 },
  industrial: { ico: "⚡", name: "Industrial Disaster", spike: { goods: 1.5, energy: 1.5, medicine: 1.4 },     pollute: 12 },
  unrest:     { ico: "✊", name: "Civil Unrest",         spike: { goods: 1.5, luxury: 1.6, weapons: 1.5 },      pollute: 0 },
  famine:     { ico: "🌾", name: "Famine",              spike: { biomass: 1.8, medicine: 1.3 },                pollute: 0 },
  collapse:   { ico: "⛏️", name: "Mine Collapse",       spike: { ore: 1.5, metals: 1.6, crystals: 1.5 },       pollute: 3 },
};
const CRISIS_DUR = [3, 6], CRISIS_MAX_ACTIVE = 2;
function crisisMul(pid, c) {
  const cr = S.crises && S.crises[pid];
  return cr ? (CRISES[cr.type].spike[c] || 1) : 1;
}
// how prone a world is to each crisis, from its nature + current state
function crisisWeights(p) {
  const w = { quake: 1, plague: 1 };
  const tag = (p.tag || "").toLowerCase();
  const dep = p.deposits || {};
  if (tag.includes("volcan") || dep.radioactives) w.volcano = 2;
  if (dep.ore || dep.crystals) {
    const c = dep.ore ? "ore" : "crystals";
    w.collapse = 2 + (1 - reserveFrac(p.id, c)) * 4;          // over-mined → more collapses
  }
  if (dep.biomass || tag.includes("agri") || tag.includes("garden")) w.famine = 2;
  if (effIndustry(p) >= 6 || pollutionOf(p.id) >= 25) w.industrial = 2 + pollutionOf(p.id) / 25; // dirty/industrial → disasters
  if (p.enforce <= 0.3) w.unrest = 2;
  const col = S.colonies[p.id];
  if (col && col.happiness < 45) w.unrest = (w.unrest || 1) + 3;  // unhappy colony → riots
  w.famine = (w.famine || 1) + (S.climate || 0) / 30;            // climate stress → famine anywhere
  return w;
}
function weightedKey(w) {
  const tot = Object.values(w).reduce((s, x) => s + x, 0);
  let r = Math.random() * tot;
  for (const k of Object.keys(w)) { r -= w[k]; if (r <= 0) return k; }
  return Object.keys(w)[0];
}
function startCrisis(p, forceType) {
  if (!S.crises) S.crises = {};
  if (S.crises[p.id]) return;
  const type = forceType || weightedKey(crisisWeights(p));
  const def = CRISES[type];
  S.crises[p.id] = { type, cyclesLeft: rint(CRISIS_DUR[0], CRISIS_DUR[1]) };
  const goods = Object.keys(def.spike).map(c => COM[c].ico).join("");
  log(`${def.ico} <span class="c">${def.name}</span> strikes ${p.name}! ${goods} prices spike as the world reels.`, "bad");
  digestNote("threats", `${def.name} at ${p.name}`);
  toast(`${def.ico} ${def.name} on ${p.name}!`, "bad");
  jot(`${def.name} struck ${p.name}.`, "crisis");
  // the stricken world posts a relief appeal — a contract with heart
  const need = Object.keys(def.spike).sort((a, b) => def.spike[b] - def.spike[a])[0];
  const qty = rint(12, 25);
  S.contracts.push({
    id: "relief" + S.turn + p.id, kind: "relief", faction: p.faction, commodity: need, qty,
    planetId: p.id, deadline: S.turn + S.crises[p.id].cyclesLeft + 2,
    reward: { credits: Math.round(qty * COM[need].base * 0.7), influence: 8, rep: { [p.faction]: 12 } },
  });
  log(`🆘 ${p.name} appeals for relief: ${qty} ${COM[need].ico} ${COM[need].name} (see 🎯 Missions).`, "event");
}

/* ------------------------------------------------------------
   CRISIS RESPONSES — the hero's path (and, later, the vulture's)
   ------------------------------------------------------------ */
// Donate a needed good to a stricken world: no payment — you're paid in
// gratitude (faction rep, influence, popularity/legitimacy) and the crisis
// shortens if the relief is substantial.
function donateRelief(c, qty) {
  const p = currentPlanet(), cr = S.crises[p.id];
  if (!cr) return toast("No crisis here to relieve.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  const def = CRISES[cr.type], needMul = def.spike[c];
  if (!needMul) return toast(`${p.name} doesn't need ${COM[c].name} right now.`, "bad");
  qty = Math.min(Math.floor(qty), S.res[c] || 0);
  if (qty <= 0) return toast(`You have no ${COM[c].name} to give.`, "bad");
  S.res[c] -= qty;
  const score = qty * (needMul - 1) * 2;                       // scarcer needs earn more gratitude
  const rep = Math.min(20, Math.max(2, Math.round(score * 0.5)));
  const inf = Math.min(15, Math.max(1, Math.round(score * 0.3)));
  addRep(p.faction, rep);
  S.res.influence = (S.res.influence || 0) + inf;
  applyPolDelta({ popularity: Math.min(8, Math.round(score * 0.2)), legitimacy: Math.min(5, Math.round(score * 0.15)) });
  if (qty >= 12 && cr.cyclesLeft > 1) { cr.cyclesLeft--; log(`Your relief shipment visibly speeds ${p.name}'s recovery.`, "good"); }
  const col = S.colonies[p.id];
  if (col) col.happiness = Math.min(100, col.happiness + 4);
  useAction();
  log(`🩹 You donated ${qty} ${COM[c].ico} ${COM[c].name} to ${p.name}'s ${def.name.toLowerCase()} relief — the people won't forget. (+${rep} ${FACTIONS[p.faction].ico} rep, +${inf} 🏛️)`, "good");
  toast(`Relief delivered — +${rep} rep, +${inf} 🏛️`, "good");
  jot(`Brought relief to ${p.name}: donated ${qty} ${COM[c].name} during the ${def.name.toLowerCase()} (+${rep} ${FACTIONS[p.faction].name} standing).`, "deed");
  afterAction();
}
function donateReliefQty(c) { donateRelief(c, +document.getElementById("relief-" + c).value || 10); }
// The vulture's path: sell a needed good at an extortionate premium. Fat
// margins on top of crisis prices — paid for in reputation, legitimacy, heat.
function gougeSell(c, qty) {
  const p = currentPlanet(), cr = S.crises[p.id];
  if (!cr) return toast("No crisis here to exploit.", "bad");
  const def = CRISES[cr.type];
  if (!def.spike[c]) return toast(`${p.name} isn't desperate for ${COM[c].name}.`, "bad");
  qty = Math.min(Math.floor(qty), S.res[c] || 0);
  if (qty <= 0) return toast(`You have no ${COM[c].name} to gouge with.`, "bad");
  const revenue = Math.round(sellPrice(p.id, c) * 1.35 * qty);   // a vulture's premium on crisis prices
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue; S.stats.sales = (S.stats.sales || 0) + revenue;
  const repHit = Math.min(12, 2 + Math.round(qty * 0.15));
  addRep(p.faction, -repHit);
  applyPolDelta({ legitimacy: -2, heat: 3 });
  log(`🦅 You gouged ${p.name}'s desperate for ${qty} ${COM[c].ico} ${COM[c].name} — ${fmt(revenue)} cr, and they'll remember the price. (−${repHit} ${FACTIONS[p.faction].ico} rep, +heat)`, "bad");
  toast(`Gouged +${fmt(revenue)} cr (−${repHit} rep)`, "bad");
  jot(`Profiteered on ${p.name} during the ${def.name.toLowerCase()}: sold ${qty} ${COM[c].name} dear for ${fmt(revenue)} cr (−${repHit} ${FACTIONS[p.faction].name} standing).`, "deed");
  afterAction();
}
function gougeSellQty(c) { gougeSell(c, +document.getElementById("relief-" + c).value || 10); }
// Loot the chaos: scavenge valuables out of the disorder. Quick credits and
// salvage, at the cost of standing — and the law notices.
function lootCrisis() {
  const p = currentPlanet(), cr = S.crises[p.id];
  if (!cr) return toast("No crisis here to loot.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  const def = CRISES[cr.type];
  const credits = rint(250, 700);
  const good = pick(Object.keys(def.spike));
  const q = Math.min(rint(4, 10), cargoFree());
  S.res.credits += credits;
  if (q > 0) S.res[good] = (S.res[good] || 0) + q;
  addRep(p.faction, -7); addRep("frontier", 2);
  S.pirate.wanted = Math.min(100, S.pirate.wanted + 6); clampPirate();
  const col = S.colonies[p.id];
  if (col) col.happiness = Math.max(0, col.happiness - 3);
  useAction();
  log(`🦅 You looted the chaos on ${p.name} — ${fmt(credits)} cr${q > 0 ? ` and ${q} ${COM[good].ico} ${COM[good].name}` : ""} pulled from the wreckage. (−7 rep, +6 Wanted)`, "bad");
  toast(`Looted +${fmt(credits)} cr (+6 Wanted)`, "bad");
  jot(`Looted the chaos on ${p.name} amid the ${def.name.toLowerCase()} for ${fmt(credits)} cr.`, "deed");
  afterAction();
}
function maybeStartCrisis() {
  if (Object.keys(S.crises).length >= CRISIS_MAX_ACTIVE) return;
  const _np1 = nonFrontierPlanets(); const meanPoll = _np1.reduce((s, p) => s + pollutionOf(p.id), 0) / _np1.length;
  const chance = 0.08 + (S.climate || 0) / 600 + meanPoll / 600;   // your footprint raises the odds
  if (Math.random() > chance) return;
  const cands = PLANETS.filter(p => isVisible(p) && !S.crises[p.id]);   // never spoil an undiscovered frontier world by naming it in a crisis
  if (!cands.length) return;
  const w = cands.map(p => 1 + pollutionOf(p.id) / 20 + effIndustry(p) / 4 + (p.enforce <= 0.3 ? 1 : 0)
    + (p.deposits && (p.deposits.ore || p.deposits.crystals) ? (1 - reserveFrac(p.id, p.deposits.ore ? "ore" : "crystals")) * 2 : 0));
  const tot = w.reduce((s, x) => s + x, 0);
  let r = Math.random() * tot, idx = 0;
  for (; idx < cands.length; idx++) { r -= w[idx]; if (r <= 0) break; }
  startCrisis(cands[Math.min(idx, cands.length - 1)]);
}
function processCrises() {
  if (!S.crises) S.crises = {};
  Object.keys(S.crises).forEach(pid => {
    const cr = S.crises[pid], def = CRISES[cr.type], p = PLANETS.find(x => x.id === pid);
    if (def.pollute) addPollution(pid, def.pollute);
    const col = S.colonies[pid];
    if (col) {
      col.happiness = Math.max(0, col.happiness - (cr.type === "unrest" ? 6 : 3));
      if (cr.type === "unrest") col.unrest = (col.unrest || 0) + 1;
    }
    if (--cr.cyclesLeft <= 0) {
      delete S.crises[pid];
      log(`${def.ico} <span class="c">${p.name}</span> is recovering from the ${def.name.toLowerCase()}; prices ease.`, "good");
    }
  });
  maybeStartCrisis();
}

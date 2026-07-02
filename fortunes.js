/* ============================================================
   STELLAR FRONTIER — fortunes & signals
   Temporary boons & banes ("drops", read at point of use via fxAdd()/
   fxMult() — nothing mutates base stats, so every effect is fully
   reversible), and Signals: the hunt for faint contacts you chase and
   INVESTIGATE for a rarity-weighted roll — a Fortune, a material
   windfall, or a dead end. Documented together as one feature in
   docs/FORTUNES.md (Signals is "slice 2" of that design). Both
   engines are here in full, including their per-cycle tickers
   (processFx, processSignals) and ambient triggers (maybeFortune,
   maybeSignal) — only the rendering (renderFortunesPanel,
   renderSignals) and endTurn(), which calls the tickers, stay in
   game.js, same as every other render* function and the rest of the
   turn-orchestration glue.

   Loaded after fleet.js, before game.js. S, log, toast, sfx, jot,
   announce, fireworks, fmt, addRep, actionsLeft, useAction,
   combatLocked, netWorth (read defensively via a typeof guard) and
   afterAction still live in other files/game.js at this point in the
   split — safe, since every function here is only CALLED later, once
   every script has finished loading, same pattern as every prior
   slice.
   ============================================================ */

"use strict";

/* ============================================================
   FORTUNES — temporary boons & banes ("drops")
   Effects are READ at point of use via fxAdd()/fxMult(); nothing
   mutates base stats, so they're fully reversible. Duration runs
   INVERSE to strength (an impact budget): a punchy boon is brief,
   a gentle one lingers. Slice 1: ambient + activity triggers.
   ============================================================ */
const FX = {
  // ============ TIER 1 — mild; can roll from ambient luck & faint signals ============
  // boons
  cleanburn:  { ico: "⛽", name: "Clean Burn", kind: "boon", domain: "logistics", tier: 1, phases: ["early", "mid"], weight: 10,
                mods: { fuelMult: -0.25 }, blurb: "Tuned drives — jumps cost 25% less fuel." },
  plating:    { ico: "🛰️", name: "Salvaged Plating", kind: "boon", domain: "combat", tier: 1, phases: ["early", "mid", "late"], weight: 9,
                mods: { incomingMult: -0.18 }, blurb: "Bolted-on armor — you take 18% less damage." },
  tradewinds: { ico: "🤝", name: "Trade Winds", kind: "boon", domain: "economy", tier: 1, phases: ["early", "mid", "late"], weight: 10,
                mods: { buyDisc: 0.12, sellPrem: 0.10 }, blurb: "Favorable contracts — buy 12% cheaper, sell 10% dearer." },
  eureka:     { ico: "🔬", name: "Eureka!", kind: "boon", domain: "science", tier: 1, phases: ["early", "mid", "late"], weight: 9,
                mods: { researchMult: 0.35 }, blurb: "Inspired lab — +35% research output." },
  richseam:   { ico: "⛏️", name: "Rich Seam", kind: "boon", domain: "industry", tier: 1, phases: ["early", "mid"], weight: 9,
                mods: { yieldMult: 0.30 }, blurb: "Generous deposits — +30% extraction & production yield." },
  safelanes:  { ico: "🕊️", name: "Safe Lanes", kind: "boon", domain: "escort", tier: 1, phases: ["mid", "late"], weight: 7,
                mods: { escortThreatMult: -0.30 }, blurb: "Quiet routes — convoy threat drops while it lasts." },
  lyinglow:   { ico: "🌫️", name: "Lying Low", kind: "boon", domain: "piracy", tier: 1, phases: ["mid", "late"], weight: 7,
                mods: { wantedDrift: -3 }, blurb: "Off the radar — Wanted cools 3 extra each cycle." },
  // banes
  ionstorm:   { ico: "🕳️", name: "Ion Storm", kind: "bane", domain: "combat", tier: 1, phases: ["early", "mid", "late"], weight: 7,
                mods: { weaponMult: -0.18 }, blurb: "Fouled targeting — −18% weapon damage (wears off)." },
  leanpick:   { ico: "🪨", name: "Lean Pickings", kind: "bane", domain: "industry", tier: 1, phases: ["early", "mid", "late"], weight: 6,
                mods: { yieldMult: -0.22 }, blurb: "Played-out seams — −22% extraction & production yield." },
  fuelfoul:   { ico: "🛢️", name: "Fouled Injectors", kind: "bane", domain: "logistics", tier: 1, phases: ["early", "mid", "late"], weight: 6,
                mods: { fuelMult: 0.25 }, clearCost: 500, blurb: "Gunked drives — jumps cost 25% more fuel." },
  // ============ TIER 2 — strong; mostly from signals you hunt down ============
  // boons
  overclock:  { ico: "⚡", name: "Overclocked Reactor", kind: "boon", domain: "logistics", tier: 2, phases: ["early", "mid", "late"], weight: 9,
                mods: { actions: 1 }, blurb: "Crew runs hot — +1 action each cycle." },
  warband:    { ico: "💥", name: "Gun Runners' Cache", kind: "boon", domain: "combat", tier: 2, phases: ["mid", "late"], weight: 9,
                mods: { weaponMult: 0.20 }, blurb: "Fresh ordnance — +20% weapon damage." },
  capital:    { ico: "🏛️", name: "Political Capital", kind: "boon", domain: "politics", tier: 2, phases: ["mid", "late"], weight: 8,
                mods: { influenceMult: 0.40, repMult: 0.50 }, blurb: "The room is with you — +40% influence & +50% rep when lobbying." },
  feared:     { ico: "🏴‍☠️", name: "Feared Name", kind: "boon", domain: "piracy", tier: 2, phases: ["mid", "late"], weight: 8,
                mods: { lootMult: 0.25 }, blurb: "Your reputation precedes you — +25% raid credits." },
  expandhold: { ico: "📦", name: "Expanded Hold", kind: "boon", domain: "logistics", tier: 2, phases: ["early", "mid", "late"], weight: 7,
                mods: { cargoBonus: 90 }, blurb: "Jury-rigged bays — +90 cargo capacity." },
  // banes
  reactorleak:{ ico: "🧯", name: "Reactor Leak", kind: "bane", domain: "logistics", tier: 2, phases: ["early", "mid", "late"], weight: 7,
                mods: { actions: -1 }, clearCost: 600, blurb: "Power bleeds away — −1 action each cycle." },
  crackdown:  { ico: "🚨", name: "Customs Crackdown", kind: "bane", domain: "economy", tier: 2, phases: ["mid", "late"], weight: 7,
                mods: { buyDisc: -0.12, sellPrem: -0.10 }, clearCost: 800, blurb: "Inspectors everywhere — buy 12% dearer, sell 10% cheaper." },
  saboteur:   { ico: "🔧", name: "Saboteur Aboard", kind: "bane", domain: "combat", tier: 2, phases: ["mid", "late"], weight: 6,
                mods: { incomingMult: 0.18 }, clearCost: 700, blurb: "Sabotaged systems — you take 18% more damage." },
  marked:     { ico: "🎯", name: "Marked", kind: "bane", domain: "piracy", tier: 2, phases: ["mid", "late"], weight: 6,
                mods: { wantedDrift: 2 }, clearCost: 900, blurb: "Bounty hunters whisper your name — Wanted climbs 2 each cycle." },
  // ============ TIER 3 — rare & grand; the prize of a rare signal ============
  // boons
  warlord:    { ico: "⚔️", name: "Warlord's Edge", kind: "boon", domain: "combat", tier: 3, phases: ["mid", "late"], weight: 6,
                mods: { weaponMult: 0.30, lootMult: 0.20 }, blurb: "Peak fighting trim — +30% weapon damage & +20% raid take." },
  goldenage:  { ico: "💰", name: "Golden Age", kind: "boon", domain: "economy", tier: 3, phases: ["mid", "late"], weight: 6,
                mods: { buyDisc: 0.18, sellPrem: 0.15 }, blurb: "Booming markets — buy 18% cheaper, sell 15% dearer." },
  renaissance:{ ico: "🌟", name: "Renaissance", kind: "boon", domain: "science", tier: 3, phases: ["mid", "late"], weight: 6,
                mods: { researchMult: 0.50, influenceMult: 0.40 }, blurb: "A flowering of genius — +50% research & +40% influence." },
  // bane
  blockade:   { ico: "⛔", name: "Sector Blockade", kind: "bane", domain: "economy", tier: 3, phases: ["mid", "late"], weight: 5,
                mods: { buyDisc: -0.20, sellPrem: -0.18, wantedDrift: 2 }, clearCost: 1500, blurb: "Lanes choked off — brutal trade spreads and rising heat." },
};
// ---- Almanac mastery: discover EVERY effect in a domain for a permanent passive edge ----
const FX_MASTERY = {
  combat:    { ico: "⚔️", name: "Combat Mastery",    mods: { weaponMult: 0.08 }, reward: 1500, blurb: "+8% weapon damage, always." },
  economy:   { ico: "💱", name: "Trade Mastery",     mods: { buyDisc: 0.05, sellPrem: 0.05 }, reward: 1500, blurb: "Permanently buy 5% cheaper & sell 5% dearer." },
  logistics: { ico: "🚀", name: "Logistics Mastery", mods: { fuelMult: -0.10 }, reward: 1500, blurb: "Jumps always cost 10% less fuel." },
  science:   { ico: "🔬", name: "Science Mastery",   mods: { researchMult: 0.15 }, reward: 1500, blurb: "+15% research output, always." },
  industry:  { ico: "🏭", name: "Industry Mastery",  mods: { yieldMult: 0.12 }, reward: 1500, blurb: "+12% extraction & production yield, always." },
  escort:    { ico: "🛡️", name: "Escort Mastery",    mods: { escortThreatMult: -0.12 }, reward: 1500, blurb: "Convoy threat always runs 12% lower." },
  politics:  { ico: "🏛️", name: "Politics Mastery",  mods: { influenceMult: 0.15 }, reward: 1500, blurb: "+15% influence from lobbying, always." },
  piracy:    { ico: "🏴‍☠️", name: "Piracy Mastery",   mods: { lootMult: 0.10 }, reward: 1500, blurb: "+10% raid credits, always." },
};
function masteryBonus(tag) { let s = 0; const M = S.fxMastery || {}; for (const dn in M) if (M[dn] && FX_MASTERY[dn]) s += (FX_MASTERY[dn].mods || {})[tag] || 0; return s; }
function domainComplete(dn) { const keys = Object.keys(FX).filter(k => FX[k].domain === dn); return keys.length > 0 && keys.every(k => S.fxSeen && S.fxSeen[k]); }
function grantMastery(dn) {
  if (!S.fxMastery) S.fxMastery = {};
  if (S.fxMastery[dn] || !FX_MASTERY[dn]) return;
  S.fxMastery[dn] = true;
  const m = FX_MASTERY[dn];
  S.res.credits += (m.reward || 0);
  log(`🏅 <b>${m.name}</b> achieved — you've catalogued every ${FX_DOMAINS[dn] ? FX_DOMAINS[dn].replace(/^\S+\s/, "") : dn} Fortune! Permanent: ${m.blurb} (+${fmt(m.reward || 0)} cr).`, "event");
  if (typeof toast === "function") toast(`🏅 ${m.name}!`, "good");
  if (typeof announce === "function") announce(`🏅 ${m.name}`, m.blurb, false);
  if (typeof sfx === "function") sfx("promote");
}
const FX_MAX_ACTIVE = 4, FX_BUDGET = 1.1;
function fxActive() { return Array.isArray(S.fx) ? S.fx.filter(f => f && FX[f.key]) : []; }
function fxAdd(tag) { return fxActive().reduce((s, f) => s + ((FX[f.key].mods || {})[tag] || 0), 0) + masteryBonus(tag); }   // active effects + permanent mastery
function fxMult(tag) { return Math.max(0.1, 1 + fxAdd(tag)); }                                            // multiplicative tags (weaponMult, fuelMult, ...)
function fxHas(key) { return fxActive().some(f => f.key === key); }
function fxStrength(def) { const m = def.mods || {}; let s = 0; for (const k in m) s += (k === "actions") ? Math.abs(m[k]) * 0.35 : Math.abs(m[k]); return Math.max(0.05, s); }
function fxDuration(def) { let d = (FX_BUDGET / fxStrength(def)) * (0.8 + Math.random() * 0.5); if (def.kind === "bane") d *= 1.25; return Math.max(1, Math.min(20, Math.round(d))); }
function gamePhase() {
  const nw = (typeof netWorth === "function") ? netWorth() : (S.res.credits || 0);
  if (S.turn >= 55 || nw >= 60000 || (S.office || 0) >= 2) return "late";
  if (S.turn >= 22 || nw >= 12000 || ((S.pirate && S.pirate.raids) || 0) > 0 || (S.office || 0) >= 1) return "mid";
  return "early";
}
function grantFx(key, opts = {}) {
  const def = FX[key]; if (!def) return null;
  if (!Array.isArray(S.fx)) S.fx = [];
  const dur = opts.dur || fxDuration(def);
  const existing = S.fx.find(f => f.key === key);
  if (existing) { existing.cyclesLeft = Math.max(existing.cyclesLeft, dur); existing.dur = Math.max(existing.dur || existing.cyclesLeft, dur); }   // refresh, never stack
  else {
    if (S.fx.length >= FX_MAX_ACTIVE) {                                          // make room — evict the soonest to expire
      let wi = 0; for (let i = 1; i < S.fx.length; i++) if (S.fx[i].cyclesLeft < S.fx[wi].cyclesLeft) wi = i;
      S.fx.splice(wi, 1);
    }
    S.fx.push({ key, cyclesLeft: dur, dur, gained: S.turn });
  }
  if (!S.fxSeen) S.fxSeen = {}; S.fxSeen[key] = true;                            // almanac: you've now experienced this one
  if (domainComplete(def.domain)) grantMastery(def.domain);                      // completed a domain? permanent mastery
  const good = def.kind === "boon";
  log(`${def.ico} <b>${def.name}</b> — ${def.blurb} <span class="hint">(${dur} cyc)</span>`, good ? "good" : "bad");
  toast(`${def.ico} ${def.name} (${dur} cyc)`, good ? "good" : "bad");
  sfx(good ? "event" : "alarm");
  return key;
}
function processFx() {     // tick down at the start of each cycle; expire at zero
  if (!Array.isArray(S.fx)) { S.fx = []; return; }
  for (let i = S.fx.length - 1; i >= 0; i--) {
    const f = S.fx[i], def = FX[f.key];
    if (!def) { S.fx.splice(i, 1); continue; }
    if (--f.cyclesLeft <= 0) { S.fx.splice(i, 1); log(`${def.ico} ${def.name} has worn off.`, ""); }
  }
  if (S.pirate) { const drift = fxAdd("wantedDrift"); if (drift) S.pirate.wanted = Math.max(0, Math.min(100, (S.pirate.wanted || 0) + drift)); }   // Lying Low / Marked
}
function fxClearCost(f) { const def = FX[f.key]; return (!def || !def.clearCost) ? 0 : Math.max(150, Math.round(def.clearCost * f.cyclesLeft / 4)); }   // cheaper the closer it is to wearing off
function clearFx(key) {    // pay to shake off a clearable bane
  const f = (S.fx || []).find(x => x.key === key), def = f && FX[f.key];
  if (!f || !def || def.kind !== "bane" || !def.clearCost) return;
  const cost = fxClearCost(f);
  if ((S.res.credits || 0) < cost) return toast(`Clearing this needs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  S.fx = S.fx.filter(x => x !== f);
  log(`🧹 You shook off <b>${def.name}</b> for ${fmt(cost)} cr.`, "good");
  toast(`${def.name} cleared`, "good"); sfx("good"); saveGame(); renderAll();
}
function purgeRandomBane() {   // a lucky break removes an active bane (used by rescue signals)
  const banes = fxActive().filter(f => FX[f.key].kind === "bane");
  if (!banes.length) return null;
  const f = pick(banes); S.fx = S.fx.filter(x => x !== f);
  return FX[f.key];
}
function fxPool(kind, maxTier) { const ph = gamePhase(), mt = maxTier || 1; return Object.keys(FX).filter(k => { const d = FX[k]; return (!kind || d.kind === kind) && (d.tier || 1) <= mt && (!d.phases || d.phases.includes(ph)); }); }
function fxWeightedPick(keys) { const tot = keys.reduce((s, k) => s + (FX[k].weight || 5), 0); let r = Math.random() * tot; for (const k of keys) { r -= (FX[k].weight || 5); if (r <= 0) return k; } return keys[keys.length - 1]; }
function rollFx(kind, maxTier) { const pool = fxPool(kind, maxTier || 1).filter(k => !fxHas(k)); return pool.length ? grantFx(fxWeightedPick(pool)) : null; }   // ambient/activity = tier 1; strong effects come from the hunt
function maybeFortune() { if (Math.random() < 0.12) rollFx(Math.random() < 0.68 ? "boon" : "bane"); }   // ambient hope tick
/* ============================================================
   SIGNALS — the hunt. Faint contacts you chase and INVESTIGATE
   (an action + fuel) for a rarity-weighted roll: a Fortune, a
   material windfall, or a dead end. They decay if ignored, so
   timing and where-you-are matter. This is the "pleasure to search".
   ============================================================ */
const SIGNAL_KINDS = {
  anomaly:  { ico: "⟁", name: "anomalous readings", blurb: "Strange energy signatures — could be a Fortune, could be nothing." },
  cache:    { ico: "📦", name: "drifting cache", blurb: "An unclaimed container tumbling through the dark — likely salvage." },
  derelict: { ico: "🛸", name: "derelict hulk", blurb: "A dead ship adrift — pick its bones for salvage." },
  intel:    { ico: "📡", name: "encrypted chatter", blurb: "Scrambled comms hint at an edge worth chasing." },
  distress: { ico: "🆘", name: "distress beacon", blurb: "A looping mayday — a rescue, or bait for a trap." },
};
const SIGNAL_MAX = 3, SIGNAL_TTL = [0, 6, 5, 4], SIGNAL_FUEL = [0, 5, 8, 12];
function sigPlanetName(id) { const p = PLANETS.find(x => x.id === id); return p ? p.name : "?"; }
function signalTier() { const r = Math.random(); if (r < 0.6) return 1; if (r < (gamePhase() === "late" ? 0.85 : 0.9)) return 2; return 3; }
function planetsForSignal() {
  const here = currentPlanet();
  const near = PLANETS.filter(p => isActive(p) && galaxyKnown(p) && p.id !== here.id)
    .sort((a, b) => ((here.distances || {})[a.id] || 9) - ((here.distances || {})[b.id] || 9)).slice(0, 4);
  return [here, ...near];
}
// a frontier world's signals skew richer: an advantage roll on tier, and a kind nudged toward its archetype's flavor
function frontierSignalKind(arch) {
  if (arch.lawless) return pick(["cache", "derelict"]);
  if (arch.deposits.includes("relics") || arch.deposits.includes("crystals")) return pick(["anomaly", "intel"]);
  return null;   // no strong flavor match — let the normal random pick apply
}
function spawnSignal(opts = {}) {
  if (!Array.isArray(S.signals)) S.signals = [];
  if (S.signals.length >= SIGNAL_MAX) return null;
  const planet = opts.planet || pick(planetsForSignal()).id;
  const arch = frontierArchetypeFor(PLANETS.find(p => p.id === planet));
  const kind = opts.kind || (arch && frontierSignalKind(arch)) || pick(Object.keys(SIGNAL_KINDS));
  const tier = opts.tier || (arch ? Math.max(signalTier(), signalTier()) : signalTier());
  if (S.signals.some(s => s.planet === planet && s.kind === kind)) return null;   // no dupes at a spot
  const s = { id: "sig" + S.turn + "_" + Math.floor(Math.random() * 1e4), kind, tier, planet, ttl: SIGNAL_TTL[tier] || 5, born: S.turn };
  S.signals.push(s);
  const k = SIGNAL_KINDS[kind], tl = ["", "faint", "strong", "rare"][tier];
  log(`${k.ico} A ${tl} signal — ${k.name} — flickers near <span class="c">${sigPlanetName(planet)}</span>. Investigate before it fades (${s.ttl} cyc).`, "event");
  toast(`${k.ico} Signal near ${sigPlanetName(planet)}`, "event"); sfx("event");
  return s;
}
function maybeSignal() { if (Math.random() < 0.20) spawnSignal(); }   // ambient: a new lead appears
function processSignals() {
  if (!Array.isArray(S.signals)) { S.signals = []; return; }
  for (let i = S.signals.length - 1; i >= 0; i--) {
    const s = S.signals[i];
    if (--s.ttl <= 0) { S.signals.splice(i, 1); log(`${SIGNAL_KINDS[s.kind].ico} The ${SIGNAL_KINDS[s.kind].name} near ${sigPlanetName(s.planet)} faded before you reached it.`, ""); }
  }
}
function signalOutcome(s) {        // weighted: boon / bane / loot / dud, by tier and biased by kind
  const W = { boon: [0, 45, 52, 60][s.tier], bane: [0, 12, 15, 16][s.tier], loot: [0, 18, 23, 22][s.tier], dud: [0, 25, 10, 2][s.tier] };
  const bias = { anomaly: { boon: 1.4, loot: 0.5 }, intel: { boon: 1.4, loot: 0.5 }, cache: { loot: 2.0, boon: 0.7 }, derelict: { loot: 2.0, boon: 0.7 }, distress: { bane: 1.7 } }[s.kind] || {};
  Object.keys(W).forEach(k => W[k] *= (bias[k] || 1));
  const tot = W.boon + W.bane + W.loot + W.dud; let r = Math.random() * tot;
  for (const k of ["boon", "bane", "loot", "dud"]) { r -= W[k]; if (r <= 0) return k; }
  return "dud";
}
function rollFxKeyForSignal(kind, maxTier) { const pool = fxPool(kind, maxTier || 1).filter(k => !fxHas(k)); return pool.length ? fxWeightedPick(pool) : null; }
function signalLoot(s) {
  const t = s.tier, k = SIGNAL_KINDS[s.kind], pn = sigPlanetName(s.planet), r = Math.random();
  if (r < 0.45) { const cr = (180 + Math.round(Math.random() * 520)) * t; S.res.credits += cr; log(`${k.ico} Salvage from the ${k.name} near ${pn}: +${fmt(cr)} cr.`, "good"); toast(`Salvage +${fmt(cr)} cr`, "good"); }
  else if (r < 0.75) { const tp = (4 + Math.round(Math.random() * 8)) * t; S.res.tech += tp; log(`${k.ico} Recovered data cores near ${pn}: +${tp} 🔬 tech.`, "good"); toast(`+${tp} 🔬`, "good"); }
  else {
    const room = cargoFree(), c = pick(["metals", "electronics", "luxury", "goods", "relics", "spice"].filter(x => COM[x])), q = Math.min(room, 2 + t + Math.round(Math.random() * 3));
    if (q > 0 && c) { S.res[c] = (S.res[c] || 0) + q; log(`${k.ico} Hauled ${q} ${COM[c].ico} ${COM[c].name} from the ${k.name} near ${pn}.`, "good"); toast(`+${q} ${COM[c].ico}`, "good"); }
    else { const cr = (180 + Math.round(Math.random() * 300)) * t; S.res.credits += cr; log(`${k.ico} Hold full — you sold the salvage for ${fmt(cr)} cr.`, "good"); toast(`Salvage +${fmt(cr)} cr`, "good"); }
  }
  sfx("good");
}
function resolveSignal(s) {
  const k = SIGNAL_KINDS[s.kind], pn = sigPlanetName(s.planet), out = signalOutcome(s);
  if (out === "dud") { log(`${k.ico} You comb the ${k.name} near ${pn} but turn up nothing of use.`, ""); toast("A dead end.", ""); sfx("event"); return; }
  if (out === "loot") return signalLoot(s);
  // a rescued distress call sometimes brings help that purges one of your banes
  if (out === "boon" && s.kind === "distress" && Math.random() < 0.45) {
    const purged = purgeRandomBane();
    if (purged) { log(`${k.ico} The crew you answered near ${pn} repaid you — they helped you shake off <b>${purged.name}</b>.`, "good"); toast(`${purged.name} cleared`, "good"); sfx("good"); return; }
  }
  const key = rollFxKeyForSignal(out, s.tier);   // a rarer signal can grant a stronger (higher-tier) effect
  if (!key) return signalLoot(s);                // pool exhausted — give salvage instead of nothing
  log(`${k.ico} The ${k.name} near ${pn} pays off…`, out === "boon" ? "good" : "bad");
  const dm = 1 + 0.3 * (s.tier - 1);             // rarer signals grant longer-lasting effects
  grantFx(key, { dur: Math.min(20, Math.max(1, Math.round(fxDuration(FX[key]) * dm))) });
}
function investigateSignal(id) {
  if (typeof combatLocked === "function" && combatLocked()) return;
  const s = (S.signals || []).find(x => x.id === id); if (!s) return toast("That signal is gone.", "bad");
  if (s.planet !== S.location) return toast(`You must be at ${sigPlanetName(s.planet)} to investigate.`, "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const fuel = SIGNAL_FUEL[s.tier] || 6;
  if (S.res.fuel < fuel) return toast(`Investigating needs ${fuel} ⛽.`, "bad");
  S.res.fuel -= fuel; useAction();
  S.signals = S.signals.filter(x => x !== s);   // consumed whatever the result
  resolveSignal(s);
  afterAction();
}
// buy intel at a port: pay to flush a fresh lead onto your scope (agency over the hunt)
const SIGNAL_SCAN = { scan: { cost: 700, tiers: [1, 2], label: "Sensor Scan" }, deep: { cost: 2400, tiers: [2, 3], label: "Deep-Space Scan" } };
function buySignalScan(kind) {
  if (typeof combatLocked === "function" && combatLocked()) return;
  const cfg = SIGNAL_SCAN[kind]; if (!cfg) return;
  if (!Array.isArray(S.signals)) S.signals = [];
  if (S.signals.length >= SIGNAL_MAX) return toast("Your scope is already crowded with leads.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if ((S.res.credits || 0) < cfg.cost) return toast(`A ${cfg.label} costs ${fmt(cfg.cost)} cr.`, "bad");
  let s = null; for (let i = 0; i < 4 && !s; i++) s = spawnSignal({ tier: pick(cfg.tiers) });
  if (!s) return toast("The scan turned up no fresh leads — try again next cycle.", "bad");
  S.res.credits -= cfg.cost; useAction();
  log(`🛰️ You commissioned a ${cfg.label} (−${fmt(cfg.cost)} cr) and flagged a lead.`, "event");
  afterAction();
}

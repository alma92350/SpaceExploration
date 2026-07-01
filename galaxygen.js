/* ============================================================
   STELLAR FRONTIER — procedural galaxy generation
   The rotating roster of active core worlds, the seeded frontier ring
   beyond the charted 20, the lane graph that gives travel real geography,
   the shareable Sector Code, and core-world stat variance. See
   docs/GALAXYGEN.md for the full design history (slices 1-6).

   Loaded after data.js (needs PLANETS, COM, CORE_BASELINE) and before
   game.js, which calls into everything here (chooseActivePlanets,
   generateFrontierRing, applyCoreVariance, seedCodeFor/seedFromCode, ...)
   from freshState(), init() and newGame().

   probeFrontier() (slice 4) and renderStarmap() (slice 5) stay in game.js
   for now — they cross-cut with the ambush/encounter system and the
   Galaxy tab's rendering respectively, both later slices of this split.
   ============================================================ */

"use strict";

recomputeDistances();   // function declared below with the frontier-ring generator; hoisted, so this call is safe here

/* ---------- Rotating roster ----------
   There are 15 core trade worlds, but each new game only features a random 9 of
   them, so every playthrough has a different map. The 5 colonizable colony
   worlds are always present (the colony game depends on them).
*/
const CORE_PLANETS = PLANETS.filter(p => !p.colonizable);   // 15 in the pool
const COLONY_WORLDS = PLANETS.filter(p => p.colonizable);   // 5, always active
const CORE_PER_GAME = 9;
function chooseActivePlanets() {
  const pool = CORE_PLANETS.slice();
  for (let i = pool.length - 1; i > 0; i--) {               // Fisher–Yates shuffle
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const active = {};
  pool.slice(0, CORE_PER_GAME).forEach(p => active[p.id] = true);
  COLONY_WORLDS.forEach(p => active[p.id] = true);
  return active;
}
function pickStart(active) {
  const cores = CORE_PLANETS.filter(p => active[p.id]);
  cores.sort((a, b) => b.enforce - a.enforce || a.x - b.x); // most civilised active world
  return cores[0].id;
}
function isActive(p) { return !S.active || !!S.active[p.id]; }
function activePlanets() { return PLANETS.filter(isActive); }
function activeCoreTotal() { return CORE_PLANETS.filter(isActive).length; }
function nonFrontierPlanets() { return PLANETS.filter(p => !p.frontier); }   // sector-wide averages (climate, pirate threat) ignore the uncharted ring

/* ---------- Frontier Ring — procedural worlds beyond the charted 20 ----------
   The 20 hand-authored worlds above are untouched. A further ring of worlds is
   generated once per save, seeded by S.frontierSeed (rolled fresh each new
   game — every playthrough's frontier differs), and appended live onto
   PLANETS at init() time — same "PLANETS is static source, replay after every
   load" pattern as replayTerritoryFlips(), just constructing new objects
   instead of mutating existing ones. Every frontier world is `hidden`, so
   charting them runs through the EXISTING Deep-Space Survey / explore()
   pipeline unchanged — procedural generation, but discovery stays manual.
*/
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/* ---------- Sector Code — slice 3 of procedural galaxy generation ----------
   S.frontierSeed and S.laneSeed together determine the whole generated
   galaxy, but two raw 31-bit integers aren't something a player can read
   out loud or type in. laneSeed is derived from frontierSeed (a cheap,
   fixed mix — not rolled independently) so ONE short base-36 code is
   enough to reproduce an entire sector: same frontier ring, same lane
   graph, same hazards and hyperlanes.
*/
function deriveLaneSeed(frontierSeed) { return (frontierSeed ^ 0x9E3779B9) >>> 0; }
/* ---------- Core variance — slice 6 of procedural galaxy generation ----------
   The charted 20's names, descriptions, factions and positions stay exactly
   as hand-written — that's deliberate, not left for later; the writing is
   the point. What varies per Sector Code is what each world PRODUCES:
   deposit yields jitter ±30%, industry/tech jitter ±1, enforce jitters
   ±15% — enough that Ferros Prime's ore doesn't always sit at exactly 2.0,
   without ever turning a mineral-poor capital into a mining hub or a
   lawless rim world into a fortress. Always recomputed FROM CORE_BASELINE,
   never from whatever a previous seed left on the same 20 objects, so
   calling it again (a mid-session New Game reuses these same objects,
   unlike the frontier ring, which gets spliced out and rebuilt) can never
   compound drift — same seed in, same stats out, no matter how many times.
*/
function deriveCoreSeed(frontierSeed) { return (frontierSeed ^ 0x2545F491) >>> 0; }
function applyCoreVariance(seed) {
  const rand = mulberry32(seed);
  CORE_BASELINE.forEach(base => {
    const p = PLANETS.find(x => x.id === base.id); if (!p) return;
    const deposits = {};
    Object.entries(base.deposits).forEach(([res, val]) => { deposits[res] = Math.max(0.3, Math.round(val * (0.7 + rand() * 0.7) * 10) / 10); });
    p.deposits = deposits;
    p.industry = Math.max(1, Math.min(10, Math.round(base.industry + (rand() * 2 - 1))));
    p.tech = Math.max(1, Math.min(10, Math.round(base.tech + (rand() * 2 - 1))));
    p.enforce = Math.max(0.02, Math.min(0.98, Math.round(base.enforce * (0.85 + rand() * 0.3) * 100) / 100));
  });
}
function seedCodeFor(seed) { return Math.abs(seed | 0).toString(36).toUpperCase(); }
function seedFromCode(code) {
  if (!code) return null;
  const n = parseInt(String(code).trim(), 36);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) % (2 ** 31) : null;
}
const FRONTIER_NAME_POOL = [
  "Kestrel Drift", "Solace", "Vaultbreak", "Ashwind", "Thornfield", "Meridian Reach",
  "Coldharbor", "Rustmoor", "Driftwake", "Halcyon Deep", "Ember Hollow", "Voidmarch",
  "Greywater", "Sablecrest", "Ninth Verge", "Cradle's End", "Farrow", "Ironveil",
  "Duskgate", "Wraithmoor", "Sungrave", "Nightreach", "Palimpsest", "Last Anchorage",
];
const FRONTIER_ARCHETYPES = [
  { tag: "Rogue Outpost", color: "#dc2626", deposits: ["ore", "radioactives", "relics"],
    ind: [1, 3], tech: [1, 3], enf: [0.02, 0.14], lawless: true,
    desc: r => `A rogue outpost at the edge of the charts, trading in ${r} with no questions asked and fewer patrols to ask them.` },
  { tag: "Derelict Field", color: "#94a3b8", deposits: ["relics", "crystals", "ice"],
    ind: [1, 2], tech: [1, 3], enf: [0.02, 0.12], lawless: true,
    desc: r => `A graveyard of drifting hulks past the last charted lane — pick through the wreckage for ${r}, if the salvagers haven't beaten you to it.` },
  { tag: "Gas Shoal", color: "#f59e0b", deposits: ["gas", "ice"],
    ind: [1, 4], tech: [2, 4], enf: [0.1, 0.3],
    desc: r => `A banded gas giant far past the trade lanes — skim its shoals for ${r} and hope your hull holds.` },
  { tag: "Verdant Reach", color: "#22c55e", deposits: ["biomass", "spice"],
    ind: [1, 2], tech: [1, 2], enf: [0.05, 0.2], colonizable: true,
    desc: r => `An unclaimed, fertile world well beyond the frontier — ${r} grows wild for whoever founds a colony first.` },
  { tag: "Mineral Vein", color: "#b45309", deposits: ["ore", "crystals", "radioactives"],
    ind: [2, 5], tech: [1, 3], enf: [0.1, 0.35],
    desc: r => `A mineral-rich claim worked by whoever's guild got here first — ${r} in quantity, law thin on the ground.` },
  { tag: "Silent Reach", color: "#8b5cf6", deposits: ["crystals", "relics"],
    ind: [1, 3], tech: [3, 6], enf: [0.15, 0.4],
    desc: r => `A quiet research outpost far from any Syndicate oversight, still turning out ${r} for anyone who makes the trip.` },
  { tag: "Ember Waste", color: "#f97316", deposits: ["ore", "crystals", "radioactives"],
    ind: [1, 2], tech: [1, 2], enf: [0.03, 0.15], colonizable: true, lawless: true,
    desc: r => `A restless volcanic waste at the far rim — brutal to settle, but its crust is thick with ${r}.` },
  { tag: "Trade Shoal", color: "#06b6d4", deposits: ["ore", "crystals", "gas"],
    ind: [3, 6], tech: [2, 5], enf: [0.2, 0.45],
    desc: r => `A free-floating trade point strung along the outer lanes, moving ${r} to anyone willing to make the run out here.` },
];
const FRONTIER_FACTION_WEIGHTS = [["frontier", 60], ["miners", 20], ["syndicate", 10], ["agri", 10]];
function frontierWeightedPick(rand, weights) {
  const tot = weights.reduce((s, [, w]) => s + w, 0);
  let r = rand() * tot;
  for (const [k, w] of weights) { r -= w; if (r <= 0) return k; }
  return weights[weights.length - 1][0];
}
function frontierSlug(name) { return name.toLowerCase().replace(/[^a-z0-9]/g, ""); }

/* ---------- Lane Graph — slice 2 of procedural galaxy generation ----------
   Distance used to be pure |x1-x2|: a straight line, so every world's cost
   to reach was exactly its coordinate gap from wherever you stood. Travel
   itself stays single-hop/point-to-point (no new UI, no rebalancing of
   ambush/escort/mandate mechanics beyond the distance number they already
   read) — only how that distance NUMBER is computed changes: it's now the
   shortest path across a small seeded graph built on top of the same
   x-ordering, so the map gets real geography without touching any of the
   ~14 existing call sites that read p.distances[...] (fuelCost, rollPrices,
   escort/mandate economics, pirate intel, etc. all keep working unchanged —
   same de-risking as territory contest and the frontier ring).
   The graph: a backbone chain across every world in x-order (so unperturbed
   distances match the old model exactly), with two seeded perturbations —
   a fraction of backbone links get a hazard multiplier (an asteroid field or
   patrol gauntlet, making that particular stretch pricier than raw distance
   suggests) and a handful of hyperlane shortcuts bypass the backbone
   entirely between two distant worlds (a cheap bypass, tagged on both
   planets' `.hyperlanes` for the Galaxy tab to show). Guaranteed connected
   by construction (the chain alone reaches every world), so no path is
   ever missing — recomputeDistances() falls back to seed 1 the instant
   PLANETS is declared (before S exists), and is called again with the real
   per-save S.laneSeed once generateFrontierRing() runs from init().
*/
function buildLaneGraph(rand) {
  const sorted = PLANETS.slice().sort((a, b) => a.x - b.x);
  const adj = new Map(sorted.map(p => [p.id, []]));
  const hyperlanes = new Map(sorted.map(p => [p.id, new Set()]));
  function addEdge(a, b, w) {
    adj.get(a).push({ to: b, w }); adj.get(b).push({ to: a, w });
    hyperlanes.get(a).add(b); hyperlanes.get(b).add(a);
  }
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i], b = sorted[i + 1];
    let w = Math.max(1, b.x - a.x);
    if (rand() < 0.25) w = Math.round(w * (1.5 + rand() * 1.5));   // a hazard stretch along the backbone
    addEdge(a.id, b.id, w);
  }
  const shortcuts = 4 + Math.floor(rand() * 3);   // 4-6 hyperlanes bypassing the backbone
  for (let k = 0; k < shortcuts; k++) {
    const i = Math.floor(rand() * sorted.length), gap = 3 + Math.floor(rand() * 5);
    const j = Math.min(sorted.length - 1, i + gap);
    if (j <= i + 1) continue;
    const a = sorted[i], b = sorted[j];
    const w = Math.max(1, Math.round((b.x - a.x) * (0.3 + rand() * 0.3)));   // a real bypass, not a free ride
    addEdge(a.id, b.id, w);
  }
  return { adj, hyperlanes, ids: sorted.map(p => p.id) };
}
function laneShortestPaths(ids, adj) {
  const dist = {};
  ids.forEach(a => { dist[a] = {}; ids.forEach(b => { dist[a][b] = a === b ? 0 : Infinity; }); });
  adj.forEach((edges, id) => edges.forEach(({ to, w }) => { if (w < dist[id][to]) dist[id][to] = w; }));
  ids.forEach(k => ids.forEach(i => ids.forEach(j => {
    const via = dist[i][k] + dist[k][j];
    if (via < dist[i][j]) dist[i][j] = via;
  })));
  return dist;
}
function recomputeDistances(seed) {
  const rand = mulberry32(seed != null ? seed : 1);   // seed 1 is only ever used transiently, before S/S.laneSeed exists
  const { adj, hyperlanes, ids } = buildLaneGraph(rand);
  const dist = laneShortestPaths(ids, adj);
  PLANETS.forEach(a => {
    a.distances = {};
    a.hyperlanes = Array.from(hyperlanes.get(a.id) || []);
    PLANETS.forEach(b => { if (a.id !== b.id) a.distances[b.id] = Math.max(1, dist[a.id][b.id]); });
  });
}
function generateFrontierRing() {
  if (PLANETS.some(p => p.frontier)) return;   // already generated this load
  const rand = mulberry32(S.frontierSeed);
  const names = FRONTIER_NAME_POOL.slice();
  for (let i = names.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [names[i], names[j]] = [names[j], names[i]]; }
  const count = 8 + Math.floor(rand() * 5);   // 8-12 new worlds
  let x = Math.max(...PLANETS.map(p => p.x)) + 3 + Math.floor(rand() * 4);
  for (let i = 0; i < count && i < names.length; i++) {
    const arch = FRONTIER_ARCHETYPES[Math.floor(rand() * FRONTIER_ARCHETYPES.length)];
    const name = names[i];
    const id = frontierSlug(name);
    if (PLANETS.some(p => p.id === id)) continue;   // extremely unlikely collision with the charted 20 — skip rather than clash
    const industry = arch.ind[0] + Math.floor(rand() * (arch.ind[1] - arch.ind[0] + 1));
    const tech = arch.tech[0] + Math.floor(rand() * (arch.tech[1] - arch.tech[0] + 1));
    const enforce = Math.round((arch.enf[0] + rand() * (arch.enf[1] - arch.enf[0])) * 100) / 100;
    const deposits = {};
    arch.deposits.forEach(res => { if (rand() < 0.8) deposits[res] = Math.round((0.6 + rand() * 1.4) * 10) / 10; });
    if (!Object.keys(deposits).length) deposits[arch.deposits[0]] = 1.0;   // never leave a world with nothing to extract
    const faction = frontierWeightedPick(rand, FRONTIER_FACTION_WEIGHTS);
    const resNames = arch.deposits.filter(r => deposits[r]).map(r => COM[r].name.toLowerCase()).join("/");
    const p = {
      id, name, tag: arch.tag, color: arch.color, x, faction, industry, tech, enforce,
      desc: arch.desc(resNames || COM[arch.deposits[0]].name.toLowerCase()),
      deposits, hidden: true, frontier: true,
    };
    if (arch.colonizable && rand() < 0.55) p.colonizable = true;
    if ((arch.lawless || enforce < 0.15) && rand() < 0.7) p.salvage = true;
    if ((arch.lawless || enforce < 0.15) && rand() < 0.7) p.bounty = true;
    PLANETS.push(p);
    S.active[id] = true;
    x += 3 + Math.floor(rand() * 4);
  }
  recomputeDistances(S.laneSeed);
}

/* ============================================================
   STELLAR FRONTIER — a space exploration & economy game
   Pure vanilla JS. No dependencies. State persists to localStorage.

   v2 — "Deep Economy": tiered commodity chains, location-bound
   extraction (mine / forage / capture / exploit), multi-step
   production, factions + reputation, contraband & smuggling,
   and governor trade decrees.
   ============================================================ */

"use strict";

/* ---------- Meta resources (not cargo, shown in the top bar) ---------- */
const META = {
  credits:   { name: "Credits",   ico: "💰" },
  fuel:      { name: "Fuel",      ico: "⛽" },
  tech:      { name: "Tech Pts",  ico: "🔬" },
  influence: { name: "Influence", ico: "🏛️" },
};

/* ---------- Factions ---------- */
const FACTIONS = {
  core:      { name: "Core Authority",     ico: "⚖️", color: "#3b82f6",
               desc: "Lawful government of the inner worlds. Hates smugglers." },
  miners:    { name: "Mining Guild",       ico: "⛏️", color: "#b45309",
               desc: "Controls ore, metals and heavy industry." },
  agri:      { name: "Agri-Combine",       ico: "🌾", color: "#16a34a",
               desc: "Feeds the sector; values relief and fair trade." },
  syndicate: { name: "Tech Syndicate",     ico: "🔬", color: "#8b5cf6",
               desc: "Masters of electronics, research and... discretion." },
  frontier:  { name: "Frontier Coalition", ico: "🛰️", color: "#06b6d4",
               desc: "Free traders of the rim. Friendly to smugglers." },
};

/* ---------- Commodity catalog (tiered) ----------
   tier:    Raw | Refined | Component | Finished | Luxury | Strategic
   base:    reference price
   extract: mine | forage | capture | exploit  (raw resources only)
   illegalAt: list of planet ids where carrying/selling is contraband
   hazard:  true if dangerous to carry without a Shielded Hold
*/
const COM = {
  // ----- RAW -----
  ore:         { name: "Ore",            ico: "🪨", tier: "Raw", base: 9,  extract: "mine" },
  crystals:    { name: "Crystals",       ico: "💎", tier: "Raw", base: 30, extract: "mine" },
  radioactives:{ name: "Radioactives",   ico: "☢️", tier: "Raw", base: 36, extract: "mine",
                 illegalAt: ["terra", "verdani"], hazard: true },
  ice:         { name: "Ice",            ico: "🧊", tier: "Raw", base: 8,  extract: "mine" },
  biomass:     { name: "Biomass",        ico: "🌿", tier: "Raw", base: 7,  extract: "forage" },
  spice:       { name: "Spice",          ico: "🌶️", tier: "Raw", base: 34, extract: "forage" },
  gas:         { name: "Helium-3",       ico: "🎈", tier: "Raw", base: 18, extract: "capture" },
  relics:      { name: "Relics",         ico: "🏺", tier: "Raw", base: 52, extract: "exploit",
                 illegalAt: ["terra", "verdani", "kybernet", "forge"], hazard: false },
  // ----- REFINED -----
  metals:      { name: "Metals",         ico: "⛓️", tier: "Refined", base: 22 },
  energy:      { name: "Energy Cells",   ico: "⚡", tier: "Refined", base: 9 },
  fuel:        { name: "Fuel",           ico: "⛽", tier: "Refined", base: 14, isFuel: true },
  chemicals:   { name: "Chemicals",      ico: "⚗️", tier: "Refined", base: 16 },
  medicine:    { name: "Medicine",       ico: "💊", tier: "Refined", base: 78 },
  // ----- COMPONENTS -----
  alloys:      { name: "Alloys",         ico: "🔩", tier: "Component", base: 80 },
  electronics: { name: "Electronics",    ico: "🖥️", tier: "Component", base: 95 },
  // ----- FINISHED -----
  goods:       { name: "Consumer Goods", ico: "📦", tier: "Finished", base: 130 },
  machinery:   { name: "Machinery",      ico: "⚙️", tier: "Finished", base: 250 },
  weapons:     { name: "Weapons",        ico: "🔫", tier: "Finished", base: 270,
                 illegalAt: ["terra", "verdani"], hazard: true },
  // ----- LUXURY / STRATEGIC -----
  luxury:      { name: "Luxury Goods",   ico: "💠", tier: "Luxury", base: 220 },
  antimatter:  { name: "Antimatter",     ico: "🌀", tier: "Strategic", base: 420,
                 illegalAt: ["terra", "verdani", "kybernet", "forge", "glacius"], hazard: true },
};
const COM_IDS = Object.keys(COM);
const CARGO_IDS = COM_IDS.filter(id => !COM[id].isFuel); // everything except fuel uses cargo
const TIERS = ["Raw", "Refined", "Component", "Finished", "Luxury", "Strategic"];

function isIllegalAt(comId, planetId) {
  const c = COM[comId];
  return c.illegalAt && c.illegalAt.includes(planetId);
}

/* ---------- Production recipes ----------
   out: commodity produced, qty: per-batch yield, in: input map, req: tech id
   kind: "refine" | "make" (for grouping); boosted differently by modules
*/
const RECIPES = [
  { id: "smelt",   out: "metals",      qty: 2, in: { ore: 2, energy: 2 },                         kind: "refine" },
  { id: "biogen",  out: "energy",      qty: 2, in: { biomass: 2 },                                kind: "refine" },
  { id: "gasgen",  out: "energy",      qty: 3, in: { gas: 1 },                                    kind: "refine" },
  { id: "reactor", out: "energy",      qty: 5, in: { radioactives: 1 }, req: "reactors",          kind: "refine", reactor: true },
  { id: "crackice",out: "fuel",        qty: 2, in: { ice: 3 },                                    kind: "refine" },
  { id: "crackgas",out: "fuel",        qty: 2, in: { gas: 1 }, req: "gasfuel",                    kind: "refine" },
  { id: "chem",    out: "chemicals",   qty: 2, in: { biomass: 2, energy: 1 },                     kind: "refine" },
  { id: "medlab",  out: "medicine",    qty: 1, in: { spice: 1, chemicals: 1, energy: 1 }, req: "biotech", kind: "make" },
  { id: "alloy",   out: "alloys",      qty: 1, in: { metals: 2, energy: 2 }, req: "metallurgy",   kind: "make" },
  { id: "chipfab", out: "electronics", qty: 1, in: { crystals: 1, metals: 1, energy: 2 }, req: "electronics", kind: "make" },
  { id: "consumer",out: "goods",       qty: 1, in: { alloys: 1, chemicals: 1, energy: 1 },        kind: "make" },
  { id: "machine", out: "machinery",   qty: 1, in: { alloys: 1, electronics: 1, energy: 1 },      kind: "make" },
  { id: "weapfab", out: "weapons",     qty: 1, in: { alloys: 1, electronics: 1, radioactives: 1 }, req: "weapontech", kind: "make" },
  { id: "luxefab", out: "luxury",      qty: 1, in: { spice: 2, electronics: 1, energy: 1 },       kind: "make" },
  { id: "antifab", out: "antimatter",  qty: 1, in: { relics: 2, electronics: 1, energy: 3 }, req: "antimatter", kind: "make" },
];

/* ---------- Planets (10) ----------
   deposits: { commodityId: yieldMult }  — what can be extracted HERE
   salvage / bounty: special capture actions available here
   enforce: 0..1 contraband enforcement strength
   faction: controlling faction id
*/
const PLANETS = [
  { id: "terra", name: "Terra Nova", tag: "Capital • Garden World", color: "#3b82f6", x: 0,
    faction: "core", industry: 6, tech: 7, enforce: 0.92,
    desc: "Cradle of the colonies — lush, populous, politically dominant and mineral-poor. Smuggling here is suicide.",
    deposits: { biomass: 1.4, spice: 0.6 } },
  { id: "glacius", name: "Glacius", tag: "Ice World", color: "#7dd3fc", x: 2,
    faction: "core", industry: 2, tech: 3, enforce: 0.5,
    desc: "A frozen ball of water-ice. Crack it for fuel and life-support across the sector.",
    deposits: { ice: 2.0, gas: 0.4 } },
  { id: "ferros", name: "Ferros Prime", tag: "Mining World", color: "#b45309", x: 3,
    faction: "miners", industry: 4, tech: 3, enforce: 0.42,
    desc: "A scarred iron giant. Drowning in ore and radioactives, starved for food.",
    deposits: { ore: 2.0, crystals: 0.7, radioactives: 1.0 } },
  { id: "verdani", name: "Verdani", tag: "Agri-World", color: "#16a34a", x: 5,
    faction: "agri", industry: 3, tech: 4, enforce: 0.7,
    desc: "Endless terraced farms feed half the sector. Spice grows wild in the highlands.",
    deposits: { biomass: 2.0, spice: 1.0 } },
  { id: "helix", name: "Helix Belt", tag: "Asteroid Belt", color: "#9ca3af", x: 6,
    faction: "miners", industry: 3, tech: 4, enforce: 0.4, salvage: true,
    desc: "A glittering ring of rubble — ore, crystals and the wrecks of those who came before.",
    deposits: { ore: 1.6, crystals: 1.4, radioactives: 1.0 } },
  { id: "kybernet", name: "Kybernet", tag: "Tech Hub", color: "#8b5cf6", x: 8,
    faction: "syndicate", industry: 8, tech: 10, enforce: 0.6,
    desc: "A neon arcology of laboratories and fabricators. Highest tech, high prices, looser laws.",
    deposits: { crystals: 1.2 } },
  { id: "nimbus", name: "Nimbus", tag: "Gas Giant", color: "#f59e0b", x: 9,
    faction: "frontier", industry: 3, tech: 5, enforce: 0.3,
    desc: "A banded storm-world. Skim its clouds for Helium-3 — if your ship can take the pressure.",
    deposits: { gas: 2.0 } },
  { id: "forge", name: "Forge Station", tag: "Industrial World", color: "#ef4444", x: 11,
    faction: "miners", industry: 10, tech: 6, enforce: 0.6,
    desc: "A planet-sized factory. Turns raw materials into finished goods at unmatched scale.",
    deposits: { ore: 1.0 } },
  { id: "oort", name: "Oort Reach", tag: "Frontier Outpost", color: "#06b6d4", x: 15,
    faction: "frontier", industry: 2, tech: 2, enforce: 0.15, salvage: true, bounty: true,
    desc: "The lawless edge of charted space. Rich, dangerous, and the best place to move hot cargo.",
    deposits: { ore: 1.2, radioactives: 1.2, relics: 0.6 } },
  { id: "erebus", name: "Erebus", tag: "Ancient Ruins", color: "#a78bfa", x: 18,
    faction: "frontier", industry: 1, tech: 3, enforce: 0.05, salvage: true, bounty: true,
    desc: "A dead world wrapped in the ruins of a vanished civilisation. Relics for the brave, law for no one.",
    deposits: { relics: 1.3, radioactives: 0.6 } },
];
PLANETS.forEach(a => {
  a.distances = {};
  PLANETS.forEach(b => { if (a.id !== b.id) a.distances[b.id] = Math.max(1, Math.abs(a.x - b.x)); });
});

/* ---------- Ship upgrades (15, 3 tiers each) ---------- */
const UPGRADES = [
  { id: "cargo",   name: "Cargo Hold",        ico: "📦", tiers: 3, baseCost: 1200, costMul: 2.2,
    desc: "Expand cargo capacity for all commodities.", effect: t => `+${t*150} cargo` },
  { id: "fueltank",name: "Fuel Tanks",        ico: "🛢️", tiers: 3, baseCost: 800,  costMul: 2.0,
    desc: "Carry more fuel for longer voyages.", effect: t => `+${t*40} fuel cap` },
  { id: "engine",  name: "Ion Engine",        ico: "🚀", tiers: 3, baseCost: 1500, costMul: 2.4,
    desc: "Efficient drive — every jump burns less fuel.", effect: t => `-${t*12}% jump fuel` },
  { id: "miner",   name: "Mining Laser",      ico: "⛏️", tiers: 3, baseCost: 1400, costMul: 2.3,
    desc: "Boost yield when mining ore, crystals, ice & radioactives.", effect: t => `+${t*35}% mining` },
  { id: "hydro",   name: "Bio-Harvester",     ico: "🌱", tiers: 3, baseCost: 1300, costMul: 2.3,
    desc: "Boost yield when foraging biomass & spice.", effect: t => `+${t*35}% foraging` },
  { id: "gasscoop",name: "Gas Scoop",         ico: "🎈", tiers: 3, baseCost: 1600, costMul: 2.4,
    desc: "REQUIRED to capture Helium-3 from gas giants. Higher tiers skim faster.", effect: t => `enables + ${t*30}% gas` },
  { id: "salvager",name: "Salvage Rig",       ico: "🧲", tiers: 3, baseCost: 1500, costMul: 2.4,
    desc: "REQUIRED to salvage derelicts & belts for metals and parts.", effect: t => `enables + ${t*30}% salvage` },
  { id: "factory", name: "Fabricator Module", ico: "🏭", tiers: 3, baseCost: 1800, costMul: 2.5,
    desc: "Refine and assemble faster — more output per production run.", effect: t => `+${t*30}% production` },
  { id: "reactor", name: "Fusion Reactor",    ico: "☀️", tiers: 3, baseCost: 1700, costMul: 2.5,
    desc: "Supercharges energy-cell production runs.", effect: t => `+${t*40}% energy output` },
  { id: "lab",     name: "Research Lab",      ico: "🔬", tiers: 3, baseCost: 1700, costMul: 2.5,
    desc: "Generate more tech points from research.", effect: t => `+${t*40}% research` },
  { id: "shield",  name: "Deflector Shield",  ico: "🛡️", tiers: 3, baseCost: 1600, costMul: 2.4,
    desc: "Reduce losses from pirates, hazards and customs scans.", effect: t => `-${t*20}% losses` },
  { id: "hazmat",  name: "Shielded Hold",     ico: "☣️", tiers: 3, baseCost: 1500, costMul: 2.3,
    desc: "Safely carry radioactives, weapons & antimatter — fewer accidents & detections.", effect: t => `-${t*25}% hazard risk` },
  { id: "smuggler",name: "Smuggler's Hold",   ico: "🕳️", tiers: 3, baseCost: 2200, costMul: 2.7,
    desc: "Hidden compartments slash the chance customs find contraband.", effect: t => `-${t*22}% bust risk` },
  { id: "trade",   name: "Trade Computer",    ico: "💹", tiers: 3, baseCost: 2000, costMul: 2.6,
    desc: "Sharper deals — better buy/sell spreads everywhere.", effect: t => `${t*4}% better prices` },
  { id: "envoy",   name: "Diplomatic Suite",  ico: "🤝", tiers: 3, baseCost: 1500, costMul: 2.4,
    desc: "Gain more influence and faction reputation from politics.", effect: t => `+${t*40}% influence` },
];

/* ---------- Technology tree ---------- */
const TECHS = [
  { id: "deepcore",   name: "Deep-Core Drilling", cost: 30,  ico: "🪨", req: [],
    desc: "+25% to all mining yields." },
  { id: "xenobio",    name: "Xeno-Biology",       cost: 30,  ico: "🌿", req: [],
    desc: "+25% to all foraging yields." },
  { id: "gasharvest", name: "Cloud Skimming",     cost: 45,  ico: "🎈", req: [],
    desc: "+40% Helium-3 capture and unlocks deeper gas layers." },
  { id: "salvaging",  name: "Salvage Drones",     cost: 45,  ico: "🧲", req: [],
    desc: "+50% salvage yields and better wreck finds." },
  { id: "metallurgy", name: "Metallurgy",         cost: 50,  ico: "🔩", req: ["deepcore"],
    desc: "Unlock Alloy fabrication (metals → alloys)." },
  { id: "electronics",name: "Microelectronics",   cost: 60,  ico: "🖥️", req: ["metallurgy"],
    desc: "Unlock Electronics fabrication (crystals + metals)." },
  { id: "reactors",   name: "Fission Reactors",   cost: 55,  ico: "☢️", req: [],
    desc: "Unlock high-output Energy from radioactives." },
  { id: "gasfuel",    name: "Fuel Cracking",      cost: 40,  ico: "⛽", req: ["gasharvest"],
    desc: "Refine fuel directly from Helium-3 gas." },
  { id: "biotech",    name: "Biotech",            cost: 70,  ico: "💊", req: ["xenobio"],
    desc: "Unlock Medicine synthesis (spice + chemicals)." },
  { id: "markets",    name: "Galactic Exchange",  cost: 60,  ico: "📈", req: [],
    desc: "Reveal price trends and stabilise markets." },
  { id: "weapontech", name: "Munitions",          cost: 90,  ico: "🔫", req: ["metallurgy", "electronics"],
    desc: "Unlock Weapons manufacture. (Politically sensitive.)" },
  { id: "diplomacy",  name: "Galactic Charter",   cost: 90,  ico: "📜", req: ["markets"],
    desc: "Unlock faction & senate politics and high-tier missions." },
  { id: "antimatter", name: "Antimatter Containment", cost: 160, ico: "🌀", req: ["reactors", "electronics"],
    desc: "Unlock Antimatter synthesis from relics & energy." },
  { id: "terraform",  name: "Terraforming",       cost: 200, ico: "🌍", req: ["biotech", "antimatter"],
    desc: "The pinnacle of science. Required to complete your legacy." },
];

/* ---------- Missions (faction & resource themed) ---------- */
const MISSIONS = [
  { id: "relief",   name: "Famine Relief Run",     tier: 1, faction: "agri",
    cost: { influence: 6 }, need: { commodity: "biomass", qty: 40 },
    reward: { influence: 14, credits: 900, rep: { agri: 15 } },
    desc: "Ship 40 biomass to a starving colony for the Agri-Combine. Cheap to fulfil, great for early standing." },
  { id: "orepact",  name: "Mining Guild Ore Pact", tier: 1, faction: "miners",
    cost: { influence: 6 }, need: { commodity: "metals", qty: 25 },
    reward: { credits: 1600, rep: { miners: 18 } },
    desc: "Supply 25 metals to the Mining Guild's foundries." },
  { id: "smuggle",  name: "Discreet Cargo",        tier: 2, faction: "frontier",
    cost: { influence: 10 }, need: { commodity: "relics", qty: 10 },
    reward: { credits: 3200, rep: { frontier: 20, core: -15 } },
    desc: "Move 10 relics no-questions-asked for the Frontier Coalition. The Core will not approve." },
  { id: "summit",   name: "Host a Tech Summit",    tier: 2, faction: "syndicate", reqTech: "diplomacy",
    cost: { influence: 22, tech: 25 },
    reward: { credits: 3000, influence: 10, rep: { syndicate: 20 } },
    desc: "Convene the sector's scientists. Prestige, profit and Syndicate favour." },
  { id: "senate",   name: "Win a Senate Seat",     tier: 3, reqTech: "diplomacy",
    cost: { influence: 60, credits: 4000 }, needRep: { core: 30 },
    reward: { influence: 40, perk: "senator" },
    desc: "Claim a seat on the Galactic Senate (needs Core standing). Unlocks the Governorship." },
  { id: "governor", name: "Become Sector Governor",tier: 3, reqTech: "diplomacy", reqPerk: "senator",
    cost: { influence: 140, credits: 15000 },
    reward: { perk: "governor" },
    desc: "Rule the sector — and unlock trade Decrees. A cornerstone of your legacy." },
];

/* ============================================================
   GAME STATE
   ============================================================ */
let S;
const ACTIONS_PER_CYCLE = 4;
const BASE_CARGO = 120;
const BASE_FUEL = 100;

function freshState() {
  const res = { credits: 3000, fuel: 100, tech: 0, influence: 0 };
  CARGO_IDS.forEach(id => res[id] = 0);
  return {
    turn: 1,
    location: "terra",
    res,
    upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, 0])),
    techs: {},
    missions: {},
    perks: {},
    rep: { core: 0, miners: 0, agri: 0, syndicate: 0, frontier: 0 },
    decrees: { monopoly: null, tariff: null },
    actionsUsed: 0,
    prices: {},
    visited: { terra: true },
    log: [],
    stats: { jumps: 0, trades: 0, profit: 0, busts: 0 },
    achieved: {},
    won: false,
  };
}

function cargoCap()  { return BASE_CARGO + S.upgrades.cargo * 150; }
function fuelCap()   { return BASE_FUEL + S.upgrades.fueltank * 40; }
function cargoUsed() { return CARGO_IDS.reduce((s, id) => s + (S.res[id] || 0), 0); }
function cargoFree() { return cargoCap() - cargoUsed(); }
function currentPlanet() { return PLANETS.find(p => p.id === S.location); }
function actionsLeft() { return ACTIONS_PER_CYCLE - S.actionsUsed; }
function useAction() { S.actionsUsed++; }

/* ============================================================
   PRICING  (per planet, supply/demand + reputation aware)
   ============================================================ */
function planetPriceMul(p, comId) {
  let m = 1;
  const c = COM[comId];
  const producesRaw = p.deposits && p.deposits[comId];
  if (producesRaw) m *= 0.55;                          // local raw → cheap
  if (c.tier === "Raw" && !producesRaw) m *= 1.25;      // imported raw → dear
  if (["Component", "Finished", "Luxury", "Strategic"].includes(c.tier))
    m *= 1 - (p.industry - 5) * 0.05;                   // industrial worlds make goods cheaper
  if (isIllegalAt(comId, p.id)) m *= 1.35;              // scarce/black-market premium
  return Math.max(0.4, Math.min(1.9, m));
}

function rollPrices() {
  PLANETS.forEach(p => {
    S.prices[p.id] = S.prices[p.id] || {};
    COM_IDS.forEach(c => {
      const target = COM[c].base * planetPriceMul(p, c);
      const stab = S.techs.markets ? 0.12 : 0.28;
      const cur = S.prices[p.id][c];
      let price = cur == null
        ? target * (1 + (Math.random() * 2 - 1) * stab)
        : cur + (target - cur) * 0.3 + target * (Math.random() * 2 - 1) * stab * 0.6;
      S.prices[p.id][c] = Math.max(2, Math.round(price));
    });
  });
}

function repPriceFactor(planet) {
  const r = S.rep[planet.faction] || 0;
  return Math.max(-0.12, Math.min(0.12, r / 100 * 0.12)); // friendly faction → up to ±12%
}
function tradeSpread() { return Math.max(0.84, 0.90 - S.upgrades.trade * 0.04); }
function buyPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  let v = S.prices[pid][c] * (1 + (1 - tradeSpread()) * 0.5);
  v *= 1 - repPriceFactor(p);            // friendly faction sells to you cheaper
  return Math.max(1, Math.round(v));
}
function sellPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  let v = S.prices[pid][c] * tradeSpread();
  v *= 1 + repPriceFactor(p);            // friendly faction pays you more
  if (S.decrees.tariff === c) v *= 1.15; // your governor tariff lifts your sell price
  return Math.max(1, Math.round(v));
}

/* ---------- Market depth & slippage ----------
   Big trades move the local price: dumping floods the market (price falls),
   bulk buying drains supply (price rises). Markets heal toward equilibrium
   each cycle via rollPrices(). This is what keeps arbitrage from compounding
   forever — you must spread trades across worlds and cycles.
*/
function marketDepth(p, c) {
  let d = 140;
  const t = COM[c].tier;
  if (t === "Luxury" || t === "Strategic") d = 70;
  else if (t === "Finished" || t === "Component") d = 100;
  if (p.deposits && p.deposits[c]) d *= 1.8; // local producers run deep markets
  if (S.techs.markets) d *= 1.4;             // Galactic Exchange = more liquidity
  return d;
}
/* fraction the price shifts for trading `qty` units (0..0.5) */
function tradeSlippage(p, c, qty) {
  return Math.min(0.5, (qty / marketDepth(p, c)) * 0.35);
}
function applyMarketMove(pid, c, slip, isSell) {
  const f = isSell ? (1 - slip) : (1 + slip);
  S.prices[pid][c] = Math.max(2, Math.round(S.prices[pid][c] * f));
}

/* ============================================================
   LOG & TOAST
   ============================================================ */
function log(msg, type = "") {
  S.log.unshift({ msg, type, turn: S.turn });
  if (S.log.length > 80) S.log.pop();
  renderLog();
}
function toast(msg, type = "") {
  if (typeof document === "undefined") return;
  const c = document.getElementById("toast-container");
  if (!c) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; }, 2200);
  setTimeout(() => el.remove(), 2700);
}

/* ============================================================
   CELEBRATIONS — fireworks canvas + announcement banner
   ============================================================ */
let _fxCanvas, _fxCtx, _fxParticles = [], _fxRAF = null, _fxUntil = 0, _fxLastLaunch = 0, _fxBigMode = false;
function _fxResize() { _fxCanvas.width = window.innerWidth; _fxCanvas.height = window.innerHeight; }
function _fxBurst(x, y, count, hue, big) {
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const spd = (big ? 4 : 2.6) + Math.random() * (big ? 5.5 : 3);
    _fxParticles.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 1, decay: 0.008 + Math.random() * 0.013, hue: hue + (Math.random() * 40 - 20),
      size: big ? 2.4 + Math.random() * 2 : 1.6 + Math.random() * 1.4 });
  }
}
function fireworks(duration = 2500, big = false) {
  if (typeof document === "undefined") return;
  if (!_fxCanvas) {
    _fxCanvas = document.getElementById("fx");
    if (!_fxCanvas || !_fxCanvas.getContext) return;
    _fxCtx = _fxCanvas.getContext("2d");
    window.addEventListener("resize", _fxResize);
  }
  _fxResize();
  _fxUntil = Math.max(_fxUntil, performance.now() + duration);
  _fxBigMode = big || _fxBigMode;
  if (_fxRAF) return;
  const tick = (t) => {
    const ctx = _fxCtx, W = _fxCanvas.width, H = _fxCanvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(5,7,15,0.18)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const big = _fxBigMode;
    if (t < _fxUntil && t - _fxLastLaunch > (big ? 200 : 340)) {
      _fxLastLaunch = t;
      const shells = big ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let k = 0; k < shells; k++)
        _fxBurst(W * (0.18 + Math.random() * 0.64), H * (0.18 + Math.random() * 0.42),
          big ? 60 + Math.floor(Math.random() * 40) : 42, Math.random() * 360, big);
    }
    for (let i = _fxParticles.length - 1; i >= 0; i--) {
      const p = _fxParticles[i];
      p.vy += 0.05; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) { _fxParticles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue},100%,${55 + p.life * 25}%,${p.life})`;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    if (t < _fxUntil || _fxParticles.length) _fxRAF = requestAnimationFrame(tick);
    else { _fxCtx.clearRect(0, 0, W, H); _fxRAF = null; _fxBigMode = false; }
  };
  _fxRAF = requestAnimationFrame(tick);
}
function announce(title, sub, finale = false) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("announce");
  if (!el) return;
  el.innerHTML = `<div class="ann-kicker">${finale ? "Legacy Complete" : "Objective Reached"}</div>`
    + `<div class="ann-title">${title}</div><div class="ann-sub">${sub}</div>`;
  el.classList.remove("hidden", "finale");
  if (finale) el.classList.add("finale");
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), finale ? 7000 : 3400);
}

/* ============================================================
   RESOURCE HELPERS
   ============================================================ */
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

/* ============================================================
   EXTRACTION  (mine / forage / capture / exploit) — location bound
   ============================================================ */
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
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  const dep = p.deposits && p.deposits[comId];
  if (!dep) return toast(`${COM[comId].name} cannot be extracted here.`, "bad");
  if (cargoFree() <= 0) return toast("Cargo hold full!", "bad");
  const { mod, tech, ok, blockMsg } = extractMods(comId);
  if (!ok) return toast(blockMsg, "bad");
  let yld = Math.round(14 * dep * mod * tech);
  yld = Math.min(yld, cargoFree());
  if (yld <= 0) return toast("No room in the hold.", "bad");
  S.res[comId] += yld;
  useAction();
  const verbName = { mine: "Mined", forage: "Foraged", capture: "Captured", exploit: "Recovered" }[COM[comId].extract];
  log(`${verbName} <span class="c">${yld}</span> ${COM[comId].ico} ${COM[comId].name} on ${p.name}.`, "good");
  toast(`+${yld} ${COM[comId].ico} ${COM[comId].name}`, "good");
  if (COM[comId].extract === "exploit" && p.enforce > 0.3 && Math.random() < 0.3)
    log("Looting ruins draws unwanted attention…", "bad");
  afterAction();
}

function salvage() {
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

function bounty() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  if (!p.bounty) return toast("No bounties available here.", "bad");
  const risk = 0.25 * (1 - S.upgrades.shield * 0.2);
  useAction();
  if (Math.random() < risk) {
    const dmg = Math.min(S.res.credits, 200 + Math.round(Math.random() * 400));
    S.res.credits -= dmg;
    log(`Bounty hunt went sour — repairs cost <span class="c">${fmt(dmg)}</span> credits.`, "bad");
    toast(`Bounty failed (−${fmt(dmg)} cr)`, "bad");
  } else {
    const cr = 600 + Math.round(Math.random() * 900);
    const inf = 4 + Math.round(Math.random() * 6);
    S.res.credits += cr; S.res.influence += inf;
    addRep("frontier", 6); addRep("core", 3);
    log(`Collected a pirate bounty: <span class="c">${fmt(cr)}</span> credits, +${inf} influence.`, "good");
    toast(`Bounty paid: +${fmt(cr)} cr`, "good");
  }
  afterAction();
}

/* ============================================================
   PRODUCTION  (refining & manufacturing)
   ============================================================ */
function recipeAvailable(r) { return !r.req || S.techs[r.req]; }
function recipeMaxBatches(r) {
  return Math.min(...Object.entries(r.in).map(([k, v]) => Math.floor((S.res[k] || 0) / v)));
}
function produce(recipeId) {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const r = RECIPES.find(x => x.id === recipeId);
  if (!recipeAvailable(r)) return toast("Technology not yet researched.", "bad");
  const p = currentPlanet();
  let cap = Math.floor((3 + p.industry) * (1 + S.upgrades.factory * 0.30));
  if (r.reactor) cap = Math.floor(cap * (1 + S.upgrades.reactor * 0.40));
  let batches = Math.min(cap, recipeMaxBatches(r));
  // limit by output cargo room (output qty per batch)
  const outIsFuel = COM[r.out].isFuel;
  const room = outIsFuel ? (fuelCap() - S.res.fuel) : cargoFree();
  batches = Math.min(batches, Math.floor(room / r.qty) + 0); // conservative
  if (batches <= 0) {
    const lack = Object.entries(r.in).find(([k, v]) => (S.res[k] || 0) < v);
    return toast(lack ? `Need more ${COM[lack[0]].name}.` : "No room for output.", "bad");
  }
  Object.entries(r.in).forEach(([k, v]) => { S.res[k] -= v * batches; });
  S.res[r.out] += r.qty * batches;
  useAction();
  const inStr = Object.entries(r.in).map(([k, v]) => `${v*batches} ${COM[k].ico}`).join(" + ");
  log(`Produced <span class="c">${r.qty*batches}</span> ${COM[r.out].ico} ${COM[r.out].name} (used ${inStr}) on ${p.name}.`, "good");
  toast(`+${r.qty*batches} ${COM[r.out].ico} ${COM[r.out].name}`, "good");
  afterAction();
}

/* ============================================================
   RESEARCH & POLITICS actions
   ============================================================ */
function research() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  const pts = Math.round((2 + p.tech) * (1 + S.upgrades.lab * 0.40));
  S.res.tech += pts; useAction();
  log(`Generated <span class="c">${pts}</span> tech points on ${p.name}.`, "good");
  toast(`+${pts} 🔬 tech`, "good");
  afterAction();
}
function doPolitics() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  let inf = Math.round((2 + (p.tech + p.industry) / 3) * (1 + S.upgrades.envoy * 0.40));
  if (S.perks.senator) inf = Math.round(inf * 1.3);
  if (S.perks.governor) inf = Math.round(inf * 1.6);
  S.res.influence += inf;
  const repGain = Math.round(3 * (1 + S.upgrades.envoy * 0.4));
  addRep(p.faction, repGain);
  useAction();
  log(`Lobbied on ${p.name}: +${inf} influence, +${repGain} ${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name} rep.`, "good");
  toast(`+${inf} 🏛️ influence`, "good");
  afterAction();
}

function afterAction() { checkWin(); saveGame(); renderAll(); }

/* ============================================================
   TRADE
   ============================================================ */
function buy(c, qty) {
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  const p = currentPlanet();
  const slip = tradeSlippage(p, c, qty);
  const cost = Math.round(buyPrice(S.location, c) * (1 + slip / 2) * qty); // avg price climbs with size
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (COM[c].isFuel) { if (S.res.fuel + qty > fuelCap()) return toast("Fuel tank too small.", "bad"); }
  else if (cargoUsed() + qty > cargoCap()) return toast("Cargo hold full.", "bad");
  S.res.credits -= cost; S.res[c] += qty; S.stats.trades++;
  applyMarketMove(S.location, c, slip, false); // bulk buying drains supply → price up
  addRep(currentPlanet().faction, 1);
  log(`Bought ${qty} ${COM[c].ico} ${COM[c].name} for <span class="c">${fmt(cost)}</span> cr${slip > 0.05 ? " (price rose)" : ""}.`);
  toast(`Bought ${qty} ${COM[c].name}`, "good");
  afterAction();
}
function sell(c, qty) {
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  if (S.res[c] < qty) return toast("You don't have that many.", "bad");
  // selling contraband where illegal triggers a customs check
  if (isIllegalAt(c, S.location)) {
    const busted = customsCheck(c, qty, "sale");
    if (busted) return; // goods confiscated
  }
  const p = currentPlanet();
  const slip = tradeSlippage(p, c, qty);
  const revenue = Math.round(sellPrice(S.location, c) * (1 - slip / 2) * qty); // avg price drops with size
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue;
  applyMarketMove(S.location, c, slip, true);  // flooding the market → price down
  addRep(currentPlanet().faction, 1);
  log(`Sold ${qty} ${COM[c].ico} ${COM[c].name} for <span class="c">${fmt(revenue)}</span> cr${slip > 0.05 ? " (price fell)" : ""}.`, "good");
  toast(`Sold ${qty} ${COM[c].name} (+${fmt(revenue)} cr)`, "good");
  afterAction();
}

/* ============================================================
   CONTRABAND / CUSTOMS
   ============================================================ */
function bustRisk(comId, qty, planet) {
  let r = planet.enforce * Math.min(0.85, 0.2 + qty / 60);     // scales with how much you carry
  r *= 1 - S.upgrades.smuggler * 0.22;                          // hidden compartments
  r *= 1 - S.upgrades.shield * 0.05;
  if (COM[comId].hazard) r *= S.upgrades.hazmat ? (1 - S.upgrades.hazmat * 0.25) : 1.25;
  r *= 1 - Math.max(0, repPriceFactor(planet)) * 1.2;          // good local standing helps
  r *= 1 - Math.min(0.30, (S.res.influence || 0) / 600);       // connections / greased palms
  if (S.perks.senator) r *= 0.85;
  if (S.perks.governor) r *= 0.7;
  return Math.max(0, Math.min(0.95, r));
}
function customsCheck(comId, qty, context) {
  const p = currentPlanet();
  const risk = bustRisk(comId, qty, p);
  if (Math.random() < risk) {
    const conf = S.res[comId];
    const fine = Math.min(S.res.credits, Math.round(conf * COM[comId].base * 0.4) + 200);
    S.res[comId] = 0; S.res.credits -= fine;
    addRep("core", -12); addRep(p.faction, -6); addRep("frontier", 3);
    S.stats.busts++;
    log(`🚨 CUSTOMS BUST at ${p.name}! ${conf} ${COM[comId].ico} ${COM[comId].name} seized, fined ${fmt(fine)} cr.`, "bad");
    toast(`🚨 Busted! ${COM[comId].name} seized`, "bad");
    afterAction();
    return true;
  }
  if (context === "sale") log(`Customs waved through your ${COM[comId].name}. Risky.`, "event");
  return false;
}
function scanOnArrival(planet) {
  // check each illegal commodity carried into a world
  CARGO_IDS.forEach(c => {
    if (S.res[c] > 0 && isIllegalAt(c, planet.id)) {
      const risk = bustRisk(c, S.res[c], planet);
      if (Math.random() < risk) {
        const conf = S.res[c];
        const fine = Math.min(S.res.credits, Math.round(conf * COM[c].base * 0.4) + 200);
        S.res[c] = 0; S.res.credits -= fine;
        addRep("core", -12); addRep(planet.faction, -6); addRep("frontier", 3);
        S.stats.busts++;
        log(`🚨 ${planet.name} customs scan! ${conf} ${COM[c].ico} ${COM[c].name} seized, fined ${fmt(fine)} cr.`, "bad");
        toast(`🚨 Cargo scan: ${COM[c].name} seized!`, "bad");
      }
    }
  });
}

/* ============================================================
   TRAVEL
   ============================================================ */
function fuelCost(destId) {
  let cost = currentPlanet().distances[destId] * 7;
  cost *= 1 - S.upgrades.engine * 0.12;
  if (S.techs.warpdrive) cost *= 0.8;
  return Math.max(1, Math.round(cost));
}
function travel(destId) {
  if (destId === S.location) return;
  const cost = fuelCost(destId);
  if (S.res.fuel < cost) return toast(`Not enough fuel (need ${cost}).`, "bad");
  const dest = PLANETS.find(p => p.id === destId);
  S.res.fuel -= cost; S.location = destId; S.visited[destId] = true; S.stats.jumps++;
  log(`Jumped to <span class="c">${dest.name}</span> (−${cost} ⛽).`, "event");
  toast(`Arrived at ${dest.name}`, "event");
  scanOnArrival(dest);
  endTurn(true);
}

/* ============================================================
   UPGRADES / RESEARCH / MISSIONS
   ============================================================ */
function upgradeCost(u) { return Math.round(u.baseCost * Math.pow(u.costMul, S.upgrades[u.id])); }
function buyUpgrade(uid) {
  const u = UPGRADES.find(x => x.id === uid);
  if (S.upgrades[uid] >= u.tiers) return;
  const cost = upgradeCost(u);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost; S.upgrades[uid]++;
  log(`Installed ${u.ico} ${u.name} (Tier ${S.upgrades[uid]}).`, "good");
  toast(`${u.name} → Tier ${S.upgrades[uid]}`, "good");
  afterAction();
}
function techUnlocked(t) { return !!S.techs[t.id]; }
function techAvailable(t) { return !techUnlocked(t) && t.req.every(r => S.techs[r]); }
function researchTech(tid) {
  const t = TECHS.find(x => x.id === tid);
  if (!techAvailable(t)) return;
  if (S.res.tech < t.cost) return toast("Not enough tech points.", "bad");
  S.res.tech -= t.cost; S.techs[tid] = true;
  log(`Researched ${t.ico} <span class="c">${t.name}</span>!`, "event");
  toast(`Unlocked: ${t.name}`, "event");
  afterAction();
}
function missionAvailable(m) {
  if (S.missions[m.id]) return false;
  if (m.reqTech && !S.techs[m.reqTech]) return false;
  if (m.reqPerk && !S.perks[m.reqPerk]) return false;
  return true;
}
function missionCanDo(m) {
  if (!canAfford(m.cost)) return false;
  if (m.need && (S.res[m.need.commodity] || 0) < m.need.qty) return false;
  if (m.needRep) return Object.entries(m.needRep).every(([f, n]) => (S.rep[f] || 0) >= n);
  return true;
}
function doMission(mid) {
  const m = MISSIONS.find(x => x.id === mid);
  if (!missionAvailable(m) || !missionCanDo(m)) return;
  pay(m.cost);
  if (m.need) S.res[m.need.commodity] -= m.need.qty;
  gain(m.reward);
  S.missions[mid] = true;
  log(`Completed mission: <span class="c">${m.name}</span>.`, "event");
  toast(`Mission complete: ${m.name}`, "event");
  afterAction();
}

/* ============================================================
   GOVERNOR DECREES
   ============================================================ */
function setDecree(kind, comId) {
  if (!S.perks.governor) return;
  S.decrees[kind] = (S.decrees[kind] === comId) ? null : comId;
  const label = kind === "monopoly" ? "Trade Monopoly" : "Tariff";
  log(`Governor decree — ${label}: ${S.decrees[kind] ? COM[comId].ico + " " + COM[comId].name : "lifted"}.`, "event");
  afterAction();
}

/* ============================================================
   TURN / EVENTS
   ============================================================ */
const EVENTS = [
  { msg: "Solar flare scrambles markets sector-wide.", type: "event",
    fn: () => COM_IDS.forEach(c => PLANETS.forEach(p => { S.prices[p.id][c] = Math.round(S.prices[p.id][c] * (0.7 + Math.random() * 0.7)); })) },
  { msg: "Pirates ambush your convoy!", type: "bad",
    fn: () => {
      const mit = 1 - S.upgrades.shield * 0.25;
      const target = ["goods", "metals", "electronics", "luxury"].find(c => S.res[c] > 0) || "ore";
      const stolen = Math.min(S.res[target], Math.round(S.res[target] * 0.25 * mit));
      const credLoss = Math.min(S.res.credits, Math.round(80 * mit));
      S.res[target] -= stolen; S.res.credits -= credLoss;
      return ` They grabbed ${stolen} ${COM[target].name} and ${fmt(credLoss)} credits.`;
    } },
  { msg: "A derelict freighter drifts by — salvage recovered.", type: "good",
    fn: () => { const c = 200 + Math.round(Math.random() * 800); S.res.credits += c; return ` +${fmt(c)} credits.`; } },
  { msg: "Bumper harvest — biomass & food prices crash.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].biomass = Math.round(S.prices[p.id].biomass * 0.6); }) },
  { msg: "Ore shortage — metals prices spike.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].metals = Math.round(S.prices[p.id].metals * 1.5); }) },
  { msg: "Energy crisis — power cells in huge demand.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].energy = Math.round(S.prices[p.id].energy * 1.6); }) },
  { msg: "Black-market boom — relics & spice prices surge.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].relics = Math.round(S.prices[p.id].relics * 1.5); S.prices[p.id].spice = Math.round(S.prices[p.id].spice * 1.4); }) },
  { msg: "Scientific breakthrough! Bonus tech points awarded.", type: "good",
    fn: () => { const t = 5 + Math.round(Math.random() * 10); S.res.tech += t; return ` +${t} tech.`; } },
  { msg: "Customs crackdown — enforcement tightens this cycle.", type: "event", fn: () => "" },
];
function maybeEvent() {
  if (Math.random() < 0.45) {
    const e = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const extra = e.fn() || "";
    log("📡 " + e.msg + extra, e.type);
    toast(e.msg, e.type === "bad" ? "bad" : "event");
  }
}
function applyDecreeIncome() {
  if (S.perks.governor && S.decrees.monopoly) {
    const c = S.decrees.monopoly;
    const income = Math.round(COM[c].base * 8);
    S.res.credits += income;
    log(`Monopoly on ${COM[c].ico} ${COM[c].name} paid <span class="c">${fmt(income)}</span> credits this cycle.`, "good");
  }
}
function endTurn(fromTravel = false) {
  S.turn++; S.actionsUsed = 0;
  rollPrices(); applyDecreeIncome(); maybeEvent();
  if (!fromTravel) log(`— Cycle ${S.turn} begins —`);
  checkWin(); saveGame(); renderAll();
}

/* ============================================================
   WIN CONDITION
   ============================================================ */
function netWorth() {
  let w = S.res.credits + S.res.fuel * COM.fuel.base;
  CARGO_IDS.forEach(c => w += S.res[c] * COM[c].base);
  return Math.round(w);
}
const OBJECTIVE_META = {
  worth:     { emoji: "💰", title: "Tycoon",           sub: "Net worth has passed 75,000 credits!" },
  terraform: { emoji: "🌍", title: "Master Scientist", sub: "Terraforming researched — you can reshape worlds!" },
  governor:  { emoji: "👑", title: "Sector Governor",  sub: "You now rule the entire sector!" },
  explored:  { emoji: "🧭", title: "Master Explorer",  sub: "All ten worlds have been charted!" },
};
function winProgress() {
  return {
    worth:     { have: netWorth() >= 75000,                  label: "Amass 75,000 credits net worth" },
    terraform: { have: !!S.techs.terraform,                  label: "Research Terraforming" },
    governor:  { have: !!S.perks.governor,                   label: "Become Sector Governor" },
    explored:  { have: PLANETS.every(p => S.visited[p.id]),  label: "Visit all 10 worlds" },
  };
}
function syncObjectives() {
  S.achieved = S.achieved || {};
  const wp = winProgress();
  Object.keys(wp).forEach(k => { if (wp[k].have) S.achieved[k] = true; });
  if (Object.values(wp).every(x => x.have)) S.won = true;
}
function checkWin() {
  S.achieved = S.achieved || {};
  const wp = winProgress();
  Object.keys(wp).forEach(key => {
    if (wp[key].have && !S.achieved[key]) {
      S.achieved[key] = true;
      const m = OBJECTIVE_META[key];
      announce(`${m.emoji} ${m.title}`, m.sub, false);
      fireworks(2400, false);
      toast(`🎆 Objective reached: ${m.title}!`, "good");
      log(`🎆 Objective reached: <span class="c">${m.title}</span> — ${m.sub}`, "good");
    }
  });
  if (!S.won && Object.values(wp).every(x => x.have)) {
    S.won = true;
    log("🏆 LEGACY COMPLETE — You have shaped the destiny of the sector!", "good");
    setTimeout(() => {
      announce("🏆 LEGACY COMPLETE", "You have shaped the destiny of the sector. A legend is born!", true);
      fireworks(8000, true);
      toast("🏆 You win! Legacy complete!", "good");
    }, 1100);
  }
}

/* ============================================================
   RENDERING
   ============================================================ */
function renderResources() {
  const el = document.getElementById("resources");
  const items = [
    ["credits", fmt(S.res.credits), ""],
    ["fuel", `${S.res.fuel}/${fuelCap()}`, ""],
    ["tech", fmt(S.res.tech), ""],
    ["influence", fmt(S.res.influence), ""],
  ].map(([k, v]) => `<div class="res" title="${META[k].name}"><span class="ico">${META[k].ico}</span><span class="val">${v}</span></div>`);
  items.push(`<div class="res" title="Cargo hold"><span class="ico">🚚</span><span class="val">${cargoUsed()}/${cargoCap()}</span></div>`);
  el.innerHTML = items.join("");
}
function renderShip() {
  document.getElementById("currentPlanet").textContent = currentPlanet().name;
  const cu = cargoUsed(), cc = cargoCap();
  const held = CARGO_IDS.filter(c => S.res[c] > 0)
    .map(c => `${COM[c].ico}${S.res[c]}`).join("  ") || '<span class="hint">empty</span>';
  const mods = UPGRADES.filter(u => S.upgrades[u.id] > 0).map(u => `${u.ico}${S.upgrades[u.id]}`).join(" ");
  document.getElementById("shipStats").innerHTML =
    `<div class="ship-stat"><span class="k">Cargo</span><span class="v">${cu}/${cc}</span></div>
     <div class="bar"><span style="width:${Math.min(100, cu/cc*100)}%"></span></div>
     <div class="ship-stat" style="margin-top:6px"><span class="k">Fuel</span><span class="v">${S.res.fuel}/${fuelCap()}</span></div>
     <div class="bar"><span style="width:${Math.min(100, S.res.fuel/fuelCap()*100)}%"></span></div>
     <div class="ship-stat" style="margin-top:8px"><span class="k">Actions</span><span class="v">${actionsLeft()}/${ACTIONS_PER_CYCLE}</span></div>
     <div class="ship-stat" style="margin-top:8px"><span class="k">Hold</span></div>
     <div style="font-size:12px;line-height:1.7">${held}</div>
     ${mods ? `<div class="ship-stat" style="margin-top:8px"><span class="k">Mods</span></div><div style="font-size:13px">${mods}</div>` : ""}`;
}
function renderLog() {
  const el = document.getElementById("log"); if (!el) return;
  el.innerHTML = S.log.map(e => `<div class="log-entry ${e.type}"><span style="opacity:.5">[${e.turn}]</span> ${e.msg}</div>`).join("");
}

function repBar(f) {
  const r = S.rep[f] || 0;
  const pct = (r + 100) / 2;
  const col = r >= 0 ? "var(--good)" : "var(--bad)";
  return `<div class="ship-stat"><span class="k">${FACTIONS[f].ico} ${FACTIONS[f].name}</span><span class="v" style="color:${col}">${r>0?"+":""}${r}</span></div>
    <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}

/* ----- Galaxy ----- */
function renderGalaxy() {
  const el = document.getElementById("panel-galaxy");
  const cards = PLANETS.map(p => {
    const here = p.id === S.location;
    const fc = here ? 0 : fuelCost(p.id);
    const canGo = !here && S.res.fuel >= fc;
    const deps = Object.keys(p.deposits || {}).map(c => COM[c].ico).join(" ")
      + (p.salvage ? " 🧲" : "") + (p.bounty ? " 🎯" : "");
    const enf = p.enforce > 0.7 ? '<span class="pill bad">strict law</span>'
      : p.enforce < 0.25 ? '<span class="pill good">lawless</span>' : '<span class="pill">patrolled</span>';
    return `<div class="planet-card ${here ? "current" : ""}">
      <div class="planet-orb" style="background:radial-gradient(circle at 35% 30%, ${p.color}, #000 130%)"></div>
      <div class="planet-name">${p.name} ${S.visited[p.id] ? "" : '<span class="badge">unknown</span>'}</div>
      <div class="planet-tag">${p.tag} · ${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}</div>
      <div class="planet-desc">${p.desc}</div>
      <div class="planet-levels">
        <span class="lvl-chip">🏭 Ind ${p.industry}/10</span>
        <span class="lvl-chip">🔬 Tech ${p.tech}/10</span>
        ${enf}
      </div>
      <div class="hint" style="margin-bottom:8px">Extract: ${deps || "—"}</div>
      ${here ? `<div class="pill good">◉ You are here</div>`
        : `<div class="row"><button class="btn btn-primary" ${canGo ? "" : "disabled"} onclick="travel('${p.id}')">Travel ▸</button>
            <span class="distance">⛽ ${fc} · ${currentPlanet().distances[p.id]} ly</span></div>`}
    </div>`;
  }).join("");
  const wp = winProgress();
  const goals = Object.values(wp).map(g => `<div class="ship-stat"><span class="k">${g.have ? "✅" : "⬜"} ${g.label}</span></div>`).join("");
  el.innerHTML = `<h2>Galactic Map</h2>
    <div class="subtitle">Ten worlds, each with its own resources, industry, laws and faction. Extraction is bound to where the resource exists. Travelling costs fuel and advances a cycle.</div>
    <div class="planet-grid">${cards}</div>
    <div class="section-title">🏆 Your Legacy (win conditions)</div>
    <div class="cards"><div class="card">${goals}<div class="hint">Net worth: ${fmt(netWorth())} cr</div></div></div>`;
}

/* ----- Market ----- */
function renderMarket() {
  const el = document.getElementById("panel-market");
  const p = currentPlanet();
  const showTrend = S.techs.markets;
  let rows = "";
  TIERS.forEach(tier => {
    const ids = COM_IDS.filter(c => COM[c].tier === tier);
    if (!ids.length) return;
    rows += `<tr><td colspan="6" class="section-title" style="padding-top:14px">${tier}</td></tr>`;
    ids.forEach(c => {
      const bp = buyPrice(p.id, c), sp = sellPrice(p.id, c), base = COM[c].base;
      const trend = bp > base * 1.12 ? '<span class="price-up">▲</span>' : bp < base * 0.88 ? '<span class="price-down">▼</span>' : '<span class="hint">—</span>';
      const illegal = isIllegalAt(c, p.id) ? ' <span class="pill bad" title="Contraband here">illegal</span>' : '';
      rows += `<tr>
        <td>${COM[c].ico} ${COM[c].name}${illegal}</td>
        <td class="num">${fmt(bp)}</td><td class="num">${fmt(sp)}</td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td>${showTrend ? trend : '<span class="hint">?</span>'}</td>
        <td><div class="trade-controls">
          <input class="qty" id="qty-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-good" onclick="buyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-good" title="Buy until cargo/tank is full" onclick="buyMax('${c}')">Fill</button>
          <button class="btn btn-sm btn-bad" onclick="sellQty('${c}')">Sell</button>
          <button class="btn btn-sm btn-bad" title="Sell your entire stock" onclick="sellAll('${c}')">All</button>
        </div></td></tr>`;
    });
  });
  el.innerHTML = `<h2>${p.name} Market</h2>
    <div class="subtitle">${p.tag}. ${showTrend ? "Galactic Exchange reveals trends &amp; deepens liquidity." : "Research the Galactic Exchange to reveal price trends."} Large trades move the price — dumping a lot crashes it, bulk buying spikes it; markets recover over cycles. Items marked <span class="pill bad">illegal</span> risk a customs bust here.</div>
    <table><thead><tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Hold</th><th>Trend</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="row" style="margin-top:14px"><span class="hint">Cargo ${cargoUsed()}/${cargoCap()} · Fuel ${S.res.fuel}/${fuelCap()} · Credits ${fmt(S.res.credits)}</span></div>`;
}
function buyQty(c) { buy(c, +document.getElementById("qty-" + c).value); }
function sellQty(c) { sell(c, +document.getElementById("qty-" + c).value); }
function sellAll(c) {
  if ((S.res[c] || 0) <= 0) return toast(`No ${COM[c].name} to sell.`, "bad");
  sell(c, S.res[c]); // sell() handles slippage & contraband checks
}
function buyMax(c) {
  const p = currentPlanet();
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();
  if (space <= 0) return toast(COM[c].isFuel ? "Fuel tank is full." : "Cargo hold is full.", "bad");
  // most we could fit, capped by credits; trim down for slippage raising the avg price
  let qty = Math.min(space, Math.floor(S.res.credits / buyPrice(S.location, c)));
  while (qty > 0) {
    const slip = tradeSlippage(p, c, qty);
    if (Math.round(buyPrice(S.location, c) * (1 + slip / 2) * qty) <= S.res.credits) break;
    qty--;
  }
  if (qty <= 0) return toast("Not enough credits to buy any.", "bad");
  buy(c, qty);
}

/* ----- Industry ----- */
function renderIndustry() {
  const el = document.getElementById("panel-industry");
  const p = currentPlanet();
  const al = actionsLeft();

  // Extraction cards (location bound)
  let extractCards = "";
  Object.keys(p.deposits || {}).forEach(c => {
    const { mod, tech, ok, blockMsg } = extractMods(c);
    const est = Math.round(14 * p.deposits[c] * mod * tech);
    const verb = { mine: "Mine", forage: "Forage", capture: "Capture", exploit: "Recover" }[COM[c].extract];
    const illegal = COM[c].illegalAt ? ' <span class="pill bad">hot cargo</span>' : '';
    extractCards += `<div class="card ${ok ? "" : "locked"}">
      <h4>${COM[c].ico} ${verb} ${COM[c].name}${illegal}</h4>
      <div class="desc">${({mine:"Mining",forage:"Foraging",capture:"Gas capture",exploit:"Ruin salvage"})[COM[c].extract]} — yield scales with this world's deposit and your gear.</div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">≈ ${est} ${COM[c].ico}</span></div>
      ${ok ? `<button class="btn btn-primary" ${al>0 && cargoFree()>0 ? "" : "disabled"} onclick="extract('${c}')">Extract (1 action)</button>`
           : `<div class="hint" style="color:var(--bad)">${blockMsg}</div>`}
    </div>`;
  });
  if (p.salvage) {
    const ok = S.upgrades.salvager >= 1;
    extractCards += `<div class="card ${ok ? "" : "locked"}">
      <h4>🧲 Salvage Wrecks</h4>
      <div class="desc">Strip derelicts for metals & electronics — chance of rare finds. Needs a Salvage Rig.</div>
      ${ok ? `<button class="btn btn-primary" ${al>0 && cargoFree()>0 ? "" : "disabled"} onclick="salvage()">Salvage (1 action)</button>`
           : `<div class="hint" style="color:var(--bad)">Requires a Salvage Rig module.</div>`}
    </div>`;
  }
  if (p.bounty) {
    extractCards += `<div class="card">
      <h4>🎯 Hunt Bounties</h4>
      <div class="desc">Track pirates for credits, influence and faction goodwill. Some risk without a Deflector Shield.</div>
      <button class="btn btn-primary" ${al>0 ? "" : "disabled"} onclick="bounty()">Hunt (1 action)</button>
    </div>`;
  }

  // Production cards
  const prodCards = RECIPES.map(r => {
    const avail = recipeAvailable(r);
    const inStr = Object.entries(r.in).map(([k, v]) => `${v}${COM[k].ico}`).join(" + ");
    let cap = Math.floor((3 + p.industry) * (1 + S.upgrades.factory * 0.30));
    if (r.reactor) cap = Math.floor(cap * (1 + S.upgrades.reactor * 0.40));
    const batches = Math.min(cap, recipeMaxBatches(r));
    const canRun = avail && batches > 0 && al > 0;
    const reqName = r.req ? TECHS.find(t => t.id === r.req).name : "";
    return `<div class="card ${avail ? "" : "locked"}">
      <h4>${COM[r.out].ico} ${COM[r.out].name}</h4>
      <div class="desc">${inStr} → ${r.qty} ${COM[r.out].ico} per batch.</div>
      ${avail ? `<div class="meta"><span class="hint">This run</span><span class="cost">${batches>0 ? "×"+batches+" batch"+(batches>1?"es":"") : "missing inputs"}</span></div>
        <button class="btn btn-primary" ${canRun ? "" : "disabled"} onclick="produce('${r.id}')">Produce (1 action)</button>`
        : `<div class="hint" style="color:var(--bad)">Requires tech: ${reqName}</div>`}
    </div>`;
  }).join("");

  el.innerHTML = `<h2>Industry — ${p.name}</h2>
    <div class="subtitle">Industry level ${p.industry}/10. Extract raw materials (only what this world holds), then refine and manufacture them. Each task uses 1 action. Actions left: <b>${al}</b>.</div>
    <div class="section-title">⛏️ Extraction (here)</div>
    <div class="cards">${extractCards || '<div class="hint">No raw deposits on this world — trade or produce instead.</div>'}</div>
    <div class="section-title">🏭 Production</div>
    <div class="cards">${prodCards}</div>`;
}

/* ----- Research ----- */
function renderResearch() {
  const el = document.getElementById("panel-research");
  const p = currentPlanet();
  const al = actionsLeft();
  const techCards = TECHS.map(t => {
    const done = techUnlocked(t), avail = techAvailable(t);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const reqTxt = t.req.length ? `Requires: ${t.req.map(r => TECHS.find(x => x.id === r).name).join(", ")}` : "";
    return `<div class="${cls}">
      <h4>${t.ico} ${t.name} ${done ? '<span class="pill good">researched</span>' : ""}</h4>
      <div class="desc">${t.desc}</div>
      ${reqTxt ? `<div class="hint">${reqTxt}</div>` : ""}
      <div class="meta"><span class="cost">${t.cost} 🔬</span>
        ${done ? "" : `<button class="btn btn-primary" ${avail && S.res.tech >= t.cost ? "" : "disabled"} onclick="researchTech('${t.id}')">Research</button>`}</div>
    </div>`;
  }).join("");
  el.innerHTML = `<h2>Research & Technology</h2>
    <div class="subtitle">Generate tech points, then unlock new extraction, production and strategic tech. You have <b>${fmt(S.res.tech)} 🔬</b>.</div>
    <div class="cards"><div class="card">
      <h4>🔬 Run Experiments</h4>
      <div class="desc">Output scales with this world's tech level (${p.tech}/10) and your Research Lab.</div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">+${Math.round((2 + p.tech) * (1 + S.upgrades.lab * 0.40))} 🔬</span></div>
      <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="research()">Research (1 action)</button>
    </div></div>
    <div class="section-title">Technology Tree</div>
    <div class="cards">${techCards}</div>`;
}

/* ----- Politics ----- */
function renderPolitics() {
  const el = document.getElementById("panel-politics");
  const p = currentPlanet();
  const al = actionsLeft();
  const status = S.perks.governor ? "Sector Governor 👑" : S.perks.senator ? "Senator 🎖️" : "Free Trader";
  const reps = Object.keys(FACTIONS).map(repBar).join("");

  const missionCards = MISSIONS.map(m => {
    const done = S.missions[m.id], avail = missionAvailable(m), can = avail && missionCanDo(m);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const needTxt = m.need ? `Deliver: ${m.need.qty} ${COM[m.need.commodity].ico} ${COM[m.need.commodity].name}. ` : "";
    const repTxt = m.needRep ? `Needs rep: ${Object.entries(m.needRep).map(([f, n]) => `${FACTIONS[f].ico}≥${n}`).join(", ")}. ` : "";
    const lock = !avail && !done ? (m.reqPerk && !S.perks[m.reqPerk] ? `Requires: ${m.reqPerk}` : m.reqTech && !S.techs[m.reqTech] ? `Requires tech: ${TECHS.find(x => x.id === m.reqTech).name}` : "") : "";
    return `<div class="${cls}">
      <h4>${m.name} <span class="badge">T${m.tier}</span> ${m.faction ? FACTIONS[m.faction].ico : ""} ${done ? '<span class="pill good">done</span>' : ""}</h4>
      <div class="desc">${m.desc}</div>
      <div class="hint">${needTxt}${repTxt}Cost: ${costString(m.cost)}</div>
      <div class="hint">Reward: ${costString(m.reward)}</div>
      ${lock ? `<div class="hint" style="color:var(--bad)">${lock}</div>` : ""}
      ${done ? "" : `<button class="btn btn-primary" ${can ? "" : "disabled"} onclick="doMission('${m.id}')">Undertake</button>`}
    </div>`;
  }).join("");

  // Governor decrees
  let decrees = "";
  if (S.perks.governor) {
    const opts = COM_IDS.map(c => `<button class="btn btn-sm ${S.decrees.monopoly===c?"btn-good":""}" onclick="setDecree('monopoly','${c}')">${COM[c].ico}</button>`).join(" ");
    const topts = COM_IDS.map(c => `<button class="btn btn-sm ${S.decrees.tariff===c?"btn-good":""}" onclick="setDecree('tariff','${c}')">${COM[c].ico}</button>`).join(" ");
    decrees = `<div class="section-title">👑 Governor Decrees</div>
      <div class="cards"><div class="card">
        <h4>Trade Monopoly ${S.decrees.monopoly ? COM[S.decrees.monopoly].ico + " " + COM[S.decrees.monopoly].name : ""}</h4>
        <div class="desc">Claim a commodity monopoly for passive credits every cycle. Click to set/clear.</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${opts}</div>
      </div><div class="card">
        <h4>Sell Tariff ${S.decrees.tariff ? COM[S.decrees.tariff].ico + " " + COM[S.decrees.tariff].name : ""}</h4>
        <div class="desc">Your political clout lifts YOUR sell price (+15%) for one commodity. Click to set/clear.</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${topts}</div>
      </div></div>`;
  }

  el.innerHTML = `<h2>Politics, Factions & Trade Law</h2>
    <div class="subtitle">Status: <b>${status}</b>. Build influence and faction reputation, run missions, and (as Governor) issue trade decrees. You have <b>${fmt(S.res.influence)} 🏛️</b>.</div>
    <div class="cards">
      <div class="card"><h4>🏛️ Lobby & Network</h4>
        <div class="desc">Earn influence and reputation with <b>${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}</b> (controls ${p.name}).</div>
        <div class="meta"><span class="hint">Est.</span><span class="cost">+${Math.round((2 + (p.tech + p.industry) / 3) * (1 + S.upgrades.envoy * 0.40) * (S.perks.governor ? 1.6 : S.perks.senator ? 1.3 : 1))} 🏛️</span></div>
        <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="doPolitics()">Lobby (1 action)</button>
      </div>
      <div class="card"><h4>🤝 Faction Standing</h4>${reps}</div>
    </div>
    ${decrees}
    <div class="section-title">Missions</div>
    <div class="cards">${missionCards}</div>`;
}

/* ----- Ship ----- */
function renderShipPanel() {
  const el = document.getElementById("panel-ship");
  const cards = UPGRADES.map(u => {
    const tier = S.upgrades[u.id], maxed = tier >= u.tiers, cost = upgradeCost(u);
    const dots = Array.from({ length: u.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
    const cls = maxed ? "card maxed" : tier > 0 ? "card owned" : "card";
    return `<div class="${cls}">
      <h4>${u.ico} ${u.name} <span class="tier-dots">${dots}</span></h4>
      <div class="desc">${u.desc}</div>
      <div class="hint">Current: ${tier > 0 ? u.effect(tier) : "not installed"}</div>
      ${maxed ? `<div class="pill good">◉ Fully upgraded</div>`
        : `<div class="meta"><span class="hint">Next: ${u.effect(tier + 1)}</span><span class="cost">${fmt(cost)} 💰</span></div>
           <button class="btn btn-primary" ${S.res.credits >= cost ? "" : "disabled"} onclick="buyUpgrade('${u.id}')">Install Tier ${tier + 1}</button>`}
    </div>`;
  }).join("");
  el.innerHTML = `<h2>Ship Outfitting — S.S. Wanderer</h2>
    <div class="subtitle">Fifteen upgrade systems, three tiers each. Some modules (Gas Scoop, Salvage Rig) unlock new extraction; others (Shielded & Smuggler's Holds) keep contraband out of customs' hands.</div>
    <div class="cards">${cards}</div>`;
}

function renderAll() {
  if (typeof document === "undefined") return;
  renderResources(); renderShip(); renderGalaxy(); renderMarket();
  renderIndustry(); renderResearch(); renderPolitics(); renderShipPanel(); renderLog();
  const tn = document.getElementById("turn"); if (tn) tn.textContent = S.turn;
}

/* ============================================================
   TABS / PERSISTENCE / INIT
   ============================================================ */
function setTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("panel-" + name).classList.remove("hidden");
}
const SAVE_KEY = "stellar-frontier-save-v2";
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function loadGame() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { S = JSON.parse(raw); return true; } } catch (e) {}
  return false;
}
function newGame() {
  if (typeof confirm === "function" && !confirm("Start a new game? Current progress will be lost.")) return;
  S = freshState(); rollPrices();
  log("Welcome, Captain. Your journey begins on Terra Nova.");
  saveGame(); renderAll(); setTab("galaxy");
}
function init() {
  if (!loadGame()) { S = freshState(); rollPrices(); log("Welcome, Captain. Your journey begins on Terra Nova."); }
  if (!S.prices || !S.prices.terra) rollPrices();
  syncObjectives();
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());
  const brand = document.querySelector(".brand");
  const ng = document.createElement("button");
  ng.className = "btn btn-sm"; ng.style.marginLeft = "8px"; ng.textContent = "⟲ New"; ng.title = "New game";
  ng.addEventListener("click", newGame); brand.appendChild(ng);
  renderAll(); setTab("galaxy");
}
window.addEventListener("DOMContentLoaded", init);

Object.assign(window, {
  travel, buyQty, sellQty, buyMax, sellAll, extract, salvage, bounty, produce,
  research, researchTech, doPolitics, doMission, buyUpgrade, setDecree, newGame,
});

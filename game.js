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
  if (typeof S !== "undefined" && S) {
    if (policyActive("legalize")) return false;                  // sector-wide free-trade law
    const st = lawStatus(planetId, comId);                       // player bans / legalizations
    if (st === "legal") return false;
    if (st === "ban") return true;
  }
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
  { id: "aquaria", name: "Aquaria", tag: "Ocean World", color: "#0ea5e9", x: 4,
    faction: "agri", industry: 2, tech: 5, enforce: 0.65,
    desc: "A world of endless seas. Vast kelp farms and clean water keep the inner colonies alive.",
    deposits: { biomass: 1.6, ice: 1.0 } },
  { id: "pyralis", name: "Pyralis", tag: "Desert World", color: "#fbbf24", x: 7,
    faction: "core", industry: 4, tech: 5, enforce: 0.72,
    desc: "Sun-blasted dunes that glitter with crystal fields and hide isotopes beneath the sand.",
    deposits: { crystals: 1.4, radioactives: 0.8 } },
  { id: "cobalt", name: "Cobalt Hub", tag: "Free Port", color: "#6366f1", x: 10,
    faction: "syndicate", industry: 6, tech: 7, enforce: 0.45,
    desc: "A free-port arcology where every commodity changes hands. Deep markets, slim margins, few questions.",
    deposits: { crystals: 0.9, gas: 0.5 } },
  { id: "korrath", name: "Korrath", tag: "Warlord World", color: "#dc2626", x: 14,
    faction: "frontier", industry: 3, tech: 2, enforce: 0.1, salvage: true, bounty: true,
    desc: "A contested frontier world. Bounties posted on every screen, wrecks in every orbit, law a rumour.",
    deposits: { ore: 1.3, radioactives: 1.1, relics: 0.7 } },
  { id: "vesper", name: "Vesper", tag: "Twilight World", color: "#64748b", x: 17,
    faction: "miners", industry: 5, tech: 4, enforce: 0.45,
    desc: "A perpetual-dusk world straddling the asteroid lanes — ore and gas hauled out in equal measure.",
    deposits: { ore: 1.5, crystals: 1.0, gas: 0.6 } },

  // ---- Colonizable frontier worlds (undeveloped; you grow their economy) ----
  { id: "aurora", name: "Aurora", tag: "Untamed World", color: "#34d399", x: 13,
    faction: "frontier", industry: 1, tech: 1, enforce: 0.1, colonizable: true,
    desc: "A green, unclaimed world ripe for settlement. Fertile soil and shallow ore seams await a founder.",
    deposits: { biomass: 1.3, ore: 0.9 } },
  { id: "cinder", name: "Cinder", tag: "Volcanic World", color: "#f97316", x: 16,
    faction: "frontier", industry: 1, tech: 1, enforce: 0.08, colonizable: true,
    desc: "A restless volcanic world — harsh, but its crust is gorged with ore, crystals and isotopes.",
    deposits: { ore: 1.5, crystals: 1.1, radioactives: 1.0 } },

  // ---- Hidden worlds (revealed by Deep-Space Survey) ----
  { id: "pandora", name: "Pandora", tag: "Jungle World", color: "#22c55e", x: 21,
    faction: "frontier", industry: 1, tech: 2, enforce: 0.05, colonizable: true, hidden: true,
    desc: "A riotous jungle world rumoured beyond the Reach. Drips with biomass and rare spice.",
    deposits: { biomass: 1.8, spice: 1.4 } },
  { id: "tartarus", name: "Tartarus", tag: "Shattered World", color: "#b91c1c", x: 24,
    faction: "frontier", industry: 1, tech: 1, enforce: 0.03, colonizable: true, hidden: true, salvage: true,
    desc: "A broken planet of metal and bone at the edge of the charts — ore, isotopes and ancient relics.",
    deposits: { ore: 1.6, radioactives: 1.3, relics: 1.0 } },
  { id: "elysium", name: "Elysium", tag: "Paradise World", color: "#38bdf8", x: 28,
    faction: "frontier", industry: 1, tech: 2, enforce: 0.02, colonizable: true, hidden: true,
    desc: "A legendary garden world said to lie past the dark. The finest colony site in the galaxy.",
    deposits: { biomass: 2.0, spice: 1.2, crystals: 1.0 } },
];
PLANETS.forEach(a => {
  a.distances = {};
  PLANETS.forEach(b => { if (a.id !== b.id) a.distances[b.id] = Math.max(1, Math.abs(a.x - b.x)); });
});

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
  { id: "cannons", name: "Weapon Systems",     ico: "🔫", tiers: 3, baseCost: 1800, costMul: 2.4,
    desc: "Mass drivers and torpedoes — the muscle for raiding ships on the lanes.", effect: t => `+${t*9} raid power` },
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
  { id: "colonial",   name: "Colonial Charter",   cost: 120, ico: "🏙️", req: ["diplomacy"],
    desc: "Unlock colonization: found and govern your own colonies on frontier worlds, and run deep-space surveys to chart new ones." },
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
  // (Senate seat & Governorship are no longer one-off missions — rise through the
  //  Office & Elections system in the Politics tab: by ballot, backroom, or force.)
];

/* ---------- Public office: the ladder of power ----------
   A career of offices (Councillor → Senator → Governor → First Consul) won three
   ways — Election (popularity), Appointment (influence + a faction patron) or a
   Coup (private security + nerve). Terms expire; keep your support up or be
   removed. S.office is the canonical rank; perks.senator/governor are synced from
   it so the rest of the game keeps working. Reaching Consul completes a political
   legacy (Statesman / Demagogue / Kingpin / Consul, by how you ruled).
*/
const OFFICES = [
  null,                                                          // 0 = private citizen
  { level: 1, id: "councillor", name: "Councillor",      ico: "🪧", term: 12 },
  { level: 2, id: "senator",    name: "Senator",         ico: "🎖️", term: 14 },
  { level: 3, id: "governor",   name: "Sector Governor", ico: "👑", term: 16 },
  { level: 4, id: "consul",     name: "First Consul",    ico: "⭐", term: 0 },   // life tenure
];
const ELECT_POP   = { 1: 25, 2: 40, 3: 55, 4: 70 };              // popularity to run
const APPOINT_INF = { 1: 40, 2: 70, 3: 110, 4: 160 };            // influence to be appointed
const APPOINT_REP = { 1: 25, 2: 30, 3: 45, 4: 60 };             // patron faction rep needed
const COUP_PMC    = { 1: 1, 2: 2, 3: 3, 4: 4 };                 // Private Security tier needed
function officeName(lvl) { return (lvl >= 1 && OFFICES[lvl]) ? OFFICES[lvl].name : "Private Citizen"; }
function currentOffice() { return OFFICES[S.office || 0]; }

/* ---------- Political organizations (the politician career) ----------
   You found organizations that run automatically every cycle (passive yields),
   draw a credit upkeep, and unlock active abilities. Tone (bright/grey/dark)
   colours them and shapes their effect on Legitimacy & Heat:
     popularity  public support (0..100) — elections, calms unrest
     legitimacy  statesman (+) ⟷ notorious (−)  (−100..100)
     heat        suspicion (0..100) — boils over into scandal
     slush       dirty credits — launder before spending openly
   Abilities cost credits / influence / slush and one action.
*/
const ORGS = [
  { id: "party", name: "People's Movement", ico: "📣", tone: "bright",
    foundCost: 4000, upkeep: 250, tiers: 4, costMul: 1.7,
    blurb: "A grassroots party that builds public support every cycle and lets you stage rallies.",
    passive: o => ({ popularity: 1 + o.tier }),
    abilities: [ { id: "rally", name: "Stage Rally", ico: "📣", cost: { credits: 400 },
      desc: "Spend on a rally for a burst of popularity.",
      effect: o => applyPolDelta({ popularity: 5 + 2 * o.tier }) } ] },

  { id: "lobby", name: "Lobbying Firm", ico: "🤝", tone: "grey",
    foundCost: 4500, upkeep: 350, tiers: 4, costMul: 1.8,
    blurb: "A backroom operation that turns money into influence, cycle after cycle.",
    passive: o => ({ influence: 1 + o.tier }),
    abilities: [ { id: "whip", name: "Buy Influence", ico: "💼", cost: { credits: 800 },
      desc: "Grease palms for a lump of influence.",
      effect: o => applyPolDelta({ influence: 6 + 3 * o.tier }) } ] },

  { id: "media", name: "Media Network", ico: "📺", tone: "grey",
    foundCost: 5000, upkeep: 350, tiers: 4, costMul: 1.8,
    blurb: "Own the narrative: polish your image, or smear opponents for cheap popularity.",
    passive: o => ({ popularity: o.tier }),
    abilities: [
      { id: "spin", name: "Spin Story", ico: "🧼", cost: { credits: 600 },
        desc: "Manage a scandal — cools investigators' interest (−Heat).",
        effect: o => applyPolDelta({ heat: -(8 + 4 * o.tier) }) },
      { id: "smear", name: "Smear Campaign", ico: "🗞️", cost: { influence: 10 },
        desc: "Manufacture outrage for popularity — cynical, and it leaves a trail.",
        effect: o => applyPolDelta({ popularity: 5 + 2 * o.tier, legitimacy: -4, heat: 6 }) } ] },

  { id: "foundation", name: "Charitable Foundation", ico: "🕊️", tone: "bright",
    foundCost: 5000, upkeep: 300, tiers: 4, costMul: 1.7,
    blurb: "Visible good works build legitimacy and calm your colonies — and make a tidy laundry.",
    passive: o => ({ popularity: o.tier, legitimacy: o.tier, unrest: -o.tier }),
    abilities: [
      { id: "launder", name: "Launder Funds", ico: "🧺",
        desc: "Wash dirty slush into clean credits (keeps a cut). Slightly raises Heat.",
        effect: o => {
          const rate = 0.5 + 0.08 * o.tier;
          const take = Math.min(S.pol.slush, 2000 + 1000 * o.tier);
          if (take <= 0) { toast("No slush to launder.", "bad"); return; }
          const clean = Math.round(take * rate);
          S.pol.slush -= take; S.res.credits += clean;
          applyPolDelta({ heat: 3 });
          log(`🧺 Foundation laundered ${fmt(take)} slush into ${fmt(clean)} clean credits.`, "event"); } } ] },

  { id: "intel", name: "Intelligence Cell", ico: "🕵️", tone: "grey",
    foundCost: 5500, upkeep: 400, tiers: 4, costMul: 1.9,
    blurb: "Counter-surveillance and quiet leverage. Keeps the heat off and the influence on.",
    passive: o => ({ influence: Math.ceil(o.tier / 2), heat: -o.tier }),
    abilities: [
      { id: "bury", name: "Bury Evidence", ico: "🗄️", cost: { credits: 1000 },
        desc: "Make a problem disappear — a big Heat cut, at the edge of the law.",
        effect: o => applyPolDelta({ heat: -(10 + 4 * o.tier), legitimacy: -2 }) } ] },

  { id: "pmc", name: "Private Security", ico: "🛡️", tone: "dark",
    foundCost: 6000, upkeep: 450, tiers: 4, costMul: 1.9,
    blurb: "Muscle for hire: guards your colonies, leans on opponents, shakes loose dirty money.",
    passive: o => ({ unrest: -(1 + o.tier) }),
    abilities: [
      { id: "shakedown", name: "Shakedown", ico: "💰", cost: {},
        desc: "Extort the local economy for slush. Ugly, and it gets noticed.",
        effect: o => applyPolDelta({ slush: 800 + 400 * o.tier, heat: 10, legitimacy: -5, popularity: -2 }) },
      { id: "intimidate", name: "Intimidate", ico: "😠", cost: { influence: 8 },
        desc: "Rule by fear — popularity through intimidation.",
        effect: o => applyPolDelta({ popularity: 4 + o.tier, legitimacy: -3, heat: 5 }) } ] },
];
const POL_TONE_CLS = { bright: "good", grey: "", dark: "bad" };

/* ---------- The Senate: bills & enacted policies ----------
   Win a Senate seat to legislate. Propose a Bill (costs influence); each faction
   is a voting bloc whose seats scale with the worlds it controls. Blocs vote on
   the bill's stance toward them, your standing, popularity & legitimacy — and
   the lobbying/bribes you apply on the floor. Passed bills become standing
   POLICIES that reshape the whole sector economy until repealed.
     stance: per-faction lean −3..+3 (how the law helps/hurts them)
     tone:   bright / grey / dark  (shifts your legitimacy & popularity on passage)
     reqPerk: office required to propose (senator implied; some need governor)
     oneShot: applied once on passage instead of becoming a standing policy
*/
const BILLS = [
  { id: "ubi", name: "Universal Basic Income", tone: "bright", proposeCost: 25,
    desc: "Treasury stipend for every citizen. Costs 2,000 cr/cycle; raises popularity and calms colonies.",
    stance: { core: -1, miners: 0, agri: 3, syndicate: -2, frontier: 1 } },
  { id: "anticorr", name: "Anti-Corruption Act", tone: "bright", proposeCost: 30,
    desc: "Independent oversight. Every shady act you commit now generates far more Heat.",
    stance: { core: 3, miners: 0, agri: 2, syndicate: -2, frontier: -2 } },
  { id: "greenpact", name: "Green Accord", tone: "bright", proposeCost: 25,
    desc: "Sector-wide emissions accord: industry pollutes half as much and fouled worlds heal faster.",
    stance: { core: 2, miners: -3, agri: 3, syndicate: 0, frontier: 1 } },
  { id: "freetrade", name: "Free Trade Act", tone: "grey", proposeCost: 25,
    desc: "Open the lanes: tighter spreads sector-wide — buy cheaper, sell dearer everywhere.",
    stance: { core: 0, miners: -2, agri: 1, syndicate: 2, frontier: 3 } },
  { id: "mining", name: "Mining Rights Act", tone: "grey", proposeCost: 25,
    desc: "Hand the belts to industry: raw-material sell prices rise +20% sector-wide.",
    stance: { core: 1, miners: 3, agri: -2, syndicate: 0, frontier: 0 } },
  { id: "tariff", name: "Protective Tariff Act", tone: "grey", proposeCost: 25,
    desc: "Protectionism: all sell prices rise +10%, but markets thin out.",
    stance: { core: 2, miners: 2, agri: 0, syndicate: -1, frontier: -3 } },
  { id: "dereg", name: "Deregulation Act", tone: "grey", proposeCost: 30,
    desc: "Gut the inspectors: customs-bust risk drops sharply sector-wide.",
    stance: { core: -3, miners: 1, agri: -1, syndicate: 2, frontier: 3 } },
  { id: "ban", name: "Trade Restriction Act", tone: "grey", proposeCost: 30, targeted: true,
    desc: "Outlaw a chosen good sector-wide — its contraband price climbs for those who'll still move it.",
    stance: { core: 2, miners: 0, agri: -1, syndicate: -1, frontier: 2 } },
  { id: "legalize", name: "Legalization Act", tone: "grey", proposeCost: 30,
    desc: "Strike all contraband laws: nothing is illegal anywhere — smuggling premiums collapse.",
    stance: { core: -3, miners: 0, agri: -1, syndicate: 1, frontier: 3 } },
  { id: "martial", name: "Martial Law", tone: "dark", proposeCost: 40, reqPerk: "governor",
    desc: "Troops on every dock: bust risk soars, but unrest is crushed. Resented by the public.",
    stance: { core: 3, miners: 1, agri: -2, syndicate: 0, frontier: -3 } },
  { id: "monopoly_grant", name: "Emergency Monopoly Grant", tone: "dark", proposeCost: 40, reqPerk: "governor",
    desc: "Cronyism by statute: pays you 1,200 cr/cycle — and quietly raises your Heat each cycle.",
    stance: { core: -2, miners: -1, agri: -1, syndicate: 2, frontier: -1 } },
  { id: "immunity", name: "Immunity Act", tone: "dark", proposeCost: 60, proposeCredits: 5000, reqPerk: "governor",
    oneShot: () => { S.pol.heat = 0; },
    desc: "Legislate yourself clean: instantly clears all Heat. A naked abuse of power.",
    stance: { core: -3, miners: 0, agri: -1, syndicate: 1, frontier: 2 } },
];
function policyActive(id) { return !!(S.policies && S.policies[id]); }
/* Player-imposed trade law on a good at a planet: "ban" | "legal" | null.
   Sources: temporary per-planet lobbying (S.planetLaws) and the sector-wide
   Trade Restriction Act (a targeted "ban" policy). */
function lawStatus(planetId, comId) {
  const pm = S.planetLaws && S.planetLaws[planetId] && S.planetLaws[planetId][comId];
  if (pm && pm.until > S.turn) return pm.type;
  if (policyActive("ban") && S.policies.ban.target === comId) return "ban";
  return null;
}
function priceShock(pid, c, factor) {
  if (S.prices && S.prices[pid] && S.prices[pid][c] != null)
    S.prices[pid][c] = Math.max(2, Math.round(S.prices[pid][c] * factor));
}

/* ============================================================
   PLANETARY CRISES
   Temporary disasters strike a world, disrupt its ecosystem/economy and spike
   the prices of what it suddenly needs. Triggered both at random (weighted by
   a world's nature) and by the player's own footprint (pollution, climate,
   over-exploitation). Prices spike through the normal target+clamp+mean-
   reversion machinery, so they swell during the crisis and fade as it passes.
   (Phase 1: the engine. Aid/exploit responses come next.)
   ============================================================ */
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
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue;
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
  const meanPoll = PLANETS.reduce((s, p) => s + pollutionOf(p.id), 0) / PLANETS.length;
  const chance = 0.08 + (S.climate || 0) / 600 + meanPoll / 600;   // your footprint raises the odds
  if (Math.random() > chance) return;
  const cands = PLANETS.filter(p => isActive(p) && !S.crises[p.id]);
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

const LAW_DURATION = 6;   // cycles a lobbied local trade law lasts

/* ---------- Player bases ----------
   A base is a permanent outpost on a planet. Its modules produce and store
   resources automatically EVERY cycle — even while you are light-years away.
   Extractor modules are offered per raw resource the planet actually holds
   (location-bound, like hand extraction); Solar Arrays and Storage Depots
   can be built anywhere.
*/
const BASE_FOUNDATION_COST = 6000;
const BASE_BASE_STORAGE = 200;       // free storage before any depot
const BASE_EXTRACTORS = {
  biomass:      { name: "Hydroponic Farm",  ico: "🌱" },
  spice:        { name: "Spice Plantation", ico: "🌶️" },
  ore:          { name: "Automated Mine",   ico: "⛏️" },
  crystals:     { name: "Crystal Quarry",   ico: "💎" },
  radioactives: { name: "Isotope Mine",     ico: "☢️" },
  ice:          { name: "Ice Harvester",    ico: "🧊" },
  gas:          { name: "Gas Skimmer",      ico: "🎈" },
  relics:       { name: "Excavation Site",  ico: "🏺" },
};
/* the modules buildable at a base on `planet` */
function baseModuleList(planet) {
  const list = [
    { id: "warehouse", name: "Storage Depot", ico: "🏬", tiers: 5, baseCost: 2500, costMul: 1.8, storage: true,
      desc: "Expands how much this base can stockpile." },
    { id: "solar", name: "Solar Array", ico: "🔆", tiers: 5, baseCost: 2000, costMul: 1.7, produces: "energy",
      desc: "Generates Energy Cells every cycle — buildable anywhere." },
  ];
  Object.keys(planet.deposits || {}).forEach(c => {
    const meta = BASE_EXTRACTORS[c] || { name: "Extractor: " + COM[c].name, ico: COM[c].ico };
    list.push({ id: "ext_" + c, name: meta.name, ico: meta.ico, tiers: 5, baseCost: 3000, costMul: 1.8,
      produces: c, extractor: true,
      desc: `Auto-harvests ${COM[c].name} every cycle (deposit ${planet.deposits[c]}×).` });
  });
  return list;
}
function moduleOutput(planet, mod, tier) {
  if (tier <= 0 || !mod.produces) return 0;
  if (mod.id === "solar") return tier * 6;
  return Math.round(tier * 5 * (planet.deposits[mod.produces] || 0));
}
/* Construction needs materials (in your hold), not just credits. */
const BASE_FOUNDATION_MATS = { metals: 25 };
const ADVANCED_MODULES = ["solar", "ext_gas", "ext_relics", "ext_radioactives", "ext_crystals"];
function moduleMats(def, nextTier) {
  const mats = { metals: 8 + nextTier * 6 };          // structural metal for every module
  if (ADVANCED_MODULES.includes(def.id)) mats.electronics = 1 + nextTier * 2; // hi-tech needs chips
  return mats;
}

/* ---------- Colonies ----------
   On a colonizable world you can found a COLONY: population, happiness, tax
   and buildings. Feeding and supplying it grows the population and raises the
   world's industry & tech — literally developing the planet's economy.
   Colony Factories/Labs/Population feed back into effIndustry()/effTech(),
   which drive production, research, politics and prices on that world.
*/
const COLONY_FOUNDATION_COST = 8000;
const COLONY_FOUNDATION_MATS = { metals: 30, goods: 10 };
// "Colonization start" — skip the trading phase and begin ready to settle.
const COLONY_START_CREDITS = 16000;                              // foundation + capital to build
const COLONY_START_KIT = { metals: 50, goods: 20, energy: 15, crystals: 10 };  // fits a base 120 hold
const COLONY_START_TECHS = ["markets", "diplomacy", "colonial"];// the charter line
const COLONY_FOOD = "biomass";       // what population eats
function colonyBuildingList(planet) {
  const list = [
    { id: "habitat", name: "Habitat Dome",    ico: "🏘️", tiers: 6, baseCost: 2000, costMul: 1.6,
      desc: "Housing. Raises this colony's maximum population.", housing: t => t * 12 },
    { id: "farm",    name: "Agri-Dome",       ico: "🌾", tiers: 6, baseCost: 1800, costMul: 1.6,
      produces: "biomass", desc: "Grows food (biomass) every cycle to feed the population." },
    // ---- Power: every industry runs on Energy. Pick a source that fits the world's deposits. ----
    { id: "solar",   name: "Solar Array",     ico: "🔆", tiers: 6, baseCost: 2200, costMul: 1.6,
      recipe: { in: {}, out: "energy", outQty: 8, rate: 1, stage: 1 },
      desc: "Generates Energy from sunlight every cycle — no fuel, buildable anywhere." },
    { id: "biomass_gen", name: "Biomass Generator", ico: "🌿", tiers: 6, baseCost: 2000, costMul: 1.6, pollute: 0.05,
      recipe: { in: { biomass: 2 }, out: "energy", outQty: 3, rate: 3, stage: 1 },
      desc: "Burns biomass into Energy — renewable power for farming worlds." },
    { id: "gas_turbine", name: "Gas Turbine", ico: "🎈", tiers: 6, baseCost: 2600, costMul: 1.65, pollute: 0.15,
      recipe: { in: { gas: 1 }, out: "energy", outQty: 4, rate: 3, stage: 1 },
      desc: "High-output Energy from Helium-3 — for gas-rich worlds." },
    { id: "reactor", name: "Fission Reactor", ico: "☢️", tiers: 5, baseCost: 4200, costMul: 1.7, req: "reactors", pollute: 0.5,
      recipe: { in: { radioactives: 1 }, out: "energy", outQty: 8, rate: 2, stage: 1 },
      desc: "Vast Energy from radioactives — the heart of an industrial colony. Small meltdown risk." },
    // ---- Refining & manufacturing chain: ore → metals → alloys → goods ----
    { id: "smelter", name: "Smelter",         ico: "🔥", tiers: 6, baseCost: 2600, costMul: 1.6, pollute: 0.3,
      recipe: { in: { ore: 2, energy: 2 }, out: "metals", outQty: 2, rate: 3, stage: 2 },
      desc: "Refines Ore into Metals (consumes Energy). One smelter feeds a matched Foundry + Fabricator." },
    { id: "chem_plant", name: "Chemical Plant", ico: "⚗️", tiers: 6, baseCost: 2600, costMul: 1.6, pollute: 0.2,
      recipe: { in: { biomass: 2, energy: 1 }, out: "chemicals", outQty: 2, rate: 3, stage: 2 },
      desc: "Processes biomass into Chemicals (consumes Energy)." },
    { id: "foundry", name: "Foundry",         ico: "🛠️", tiers: 6, baseCost: 3200, costMul: 1.7, req: "metallurgy", pollute: 0.25,
      recipe: { in: { metals: 2, energy: 2 }, out: "alloys", outQty: 1, rate: 2, stage: 3 },
      desc: "Forges Metals into Alloys (consumes Energy)." },
    { id: "fabricator", name: "Fabricator",   ico: "🖥️", tiers: 6, baseCost: 3400, costMul: 1.7, req: "electronics", pollute: 0.15,
      recipe: { in: { crystals: 1, metals: 1, energy: 2 }, out: "electronics", outQty: 1, rate: 2, stage: 3 },
      desc: "Etches Crystals + Metals into Electronics (consumes Energy)." },
    // ---- Stage 4: finished goods. The components above feed these high-value lines. ----
    { id: "factory", name: "Assembly Plant",  ico: "🏭", tiers: 6, baseCost: 3000, costMul: 1.7, pollute: 0.15,
      industry: 1, recipe: { in: { alloys: 1, chemicals: 1, energy: 1 }, out: "goods", outQty: 1, rate: 2, stage: 4 },
      desc: "+1 industry per tier. Assembles Alloys + Chemicals + Energy into Consumer Goods." },
    { id: "machine_works", name: "Machine Works", ico: "⚙️", tiers: 6, baseCost: 3600, costMul: 1.7, pollute: 0.2,
      recipe: { in: { alloys: 1, electronics: 1, energy: 1 }, out: "machinery", outQty: 1, rate: 2, stage: 4 },
      desc: "Builds Machinery from Alloys + Electronics — a high-value export." },
    { id: "luxury_atelier", name: "Luxury Atelier", ico: "💠", tiers: 6, baseCost: 3600, costMul: 1.7,
      recipe: { in: { spice: 2, electronics: 1, energy: 1 }, out: "luxury", outQty: 1, rate: 2, stage: 4 },
      desc: "Crafts Luxury Goods from Spice + Electronics — sells dear and keeps colonists content." },
    { id: "pharma_lab", name: "Pharma Lab",   ico: "💊", tiers: 6, baseCost: 3400, costMul: 1.7, req: "biotech",
      recipe: { in: { spice: 1, chemicals: 1, energy: 1 }, out: "medicine", outQty: 1, rate: 2, stage: 4 },
      desc: "Synthesises Medicine from Spice + Chemicals — keeps a colony healthy and happy." },
    { id: "arms_factory", name: "Arms Factory", ico: "🔫", tiers: 5, baseCost: 4000, costMul: 1.75, req: "weapontech", pollute: 0.5,
      recipe: { in: { alloys: 1, electronics: 1, radioactives: 1 }, out: "weapons", outQty: 1, rate: 2, stage: 4 },
      desc: "Forges Weapons from Alloys + Electronics + Radioactives — lucrative, but watch the law." },
    { id: "antimatter_forge", name: "Antimatter Forge", ico: "🌀", tiers: 4, baseCost: 5200, costMul: 1.8, req: "antimatter", pollute: 0.6,
      recipe: { in: { relics: 2, electronics: 1, energy: 3 }, out: "antimatter", outQty: 1, rate: 1, stage: 5 },
      desc: "Binds Relics + Electronics into Antimatter — the apex of colonial industry." },
    { id: "scrubber", name: "Atmo Scrubber",   ico: "🌬️", tiers: 5, baseCost: 2800, costMul: 1.65,
      desc: "Scrubs industrial pollution from air and soil — keeps an industrial world livable." },
    { id: "lab",     name: "Research Campus",  ico: "🔬", tiers: 6, baseCost: 3000, costMul: 1.7,
      tech: 1, desc: "+1 tech per tier, and sends tech points to your research each cycle." },
    { id: "spaceport", name: "Spaceport",      ico: "🛰️", tiers: 4, baseCost: 4000, costMul: 1.8,
      desc: "Boosts colony trade liquidity and tax revenue." },
    { id: "garrison",  name: "Garrison",        ico: "🛡️", tiers: 5, baseCost: 3500, costMul: 1.7,
      defense: 1, desc: "Planetary defenses. Repels pirate raids and keeps order during unrest." },
  ];
  Object.keys(planet.deposits || {}).forEach(c => {
    const meta = BASE_EXTRACTORS[c] || { name: "Extractor: " + COM[c].name, ico: COM[c].ico };
    list.push({ id: "ext_" + c, name: meta.name, ico: meta.ico, tiers: 6, baseCost: 2600, costMul: 1.6, pollute: 0.25,
      produces: c, extractor: true, desc: `Auto-harvests ${COM[c].name} every cycle.` });
  });
  return list;
}
function colonyBuildingMats(def, nextTier) {
  const mats = { metals: 10 + nextTier * 7 };
  if (["factory", "lab", "spaceport", "garrison", "reactor", "foundry", "fabricator",
       "machine_works", "luxury_atelier", "pharma_lab", "arms_factory", "antimatter_forge"].includes(def.id)
      || ADVANCED_MODULES.includes(def.id))
    mats.electronics = 2 + nextTier * 2;
  return mats;
}
/* compact "2🪨+2⚡ → 2⛓️ ×2/tier" line for an industry building's recipe */
function colonyRecipeStr(r) {
  const ins = Object.keys(r.in).length ? Object.entries(r.in).map(([c, q]) => `${q}${COM[c].ico}`).join("+") : "—";
  return `${ins} → ${r.outQty}${COM[r.out].ico} ×${r.rate}/tier`;
}
/* effective industry/tech: planet base + colony development */
function effIndustry(p) {
  const c = S.colonies && S.colonies[p.id];
  if (!c) return p.industry;
  return p.industry + (c.buildings.factory || 0) + Math.floor(c.pop / 12);
}
function effTech(p) {
  const c = S.colonies && S.colonies[p.id];
  if (!c) return p.tech;
  return p.tech + (c.buildings.lab || 0) + Math.floor(c.pop / 20);
}

/* ============================================================
   GAME STATE
   ============================================================ */
let S;
const ACTIONS_PER_CYCLE = 4;
const BASE_CARGO = 120;
const BASE_FUEL = 100;

function freshState(opts = {}) {
  const res = { credits: 3000, fuel: 100, tech: 0, influence: 0 };
  CARGO_IDS.forEach(id => res[id] = 0);
  const active = chooseActivePlanets();
  const techs = {};
  const pol = { popularity: 10, legitimacy: 0, heat: 0, slush: 0 };
  const orgs = {};
  let office = 0, officePath = null, term = 0;
  let start = pickStart(active);
  if (opts.colonyStart) {
    // Skip the trading phase: grant the charter line, seed capital + materials,
    // and arrive on a colonizable frontier world ready to found a colony now.
    COLONY_START_TECHS.forEach(t => techs[t] = true);
    res.credits = COLONY_START_CREDITS;
    Object.entries(COLONY_START_KIT).forEach(([c, q]) => res[c] = (res[c] || 0) + q);
    const home = COLONY_WORLDS.find(p => !p.hidden);   // colony worlds are always active
    if (home) start = home.id;
  }
  if (opts.politicsStart) {
    // Skip the trading grind and begin as a fledgling politician: the charter,
    // a campaign chest, some clout and a ready-made party to build on.
    ["markets", "diplomacy"].forEach(t => techs[t] = true);
    res.credits = 6000; res.influence = 30;
    pol.popularity = 25;
    orgs.party = { tier: 1 };
    office = 1; officePath = "elected"; term = OFFICES[1].term;   // start as a Councillor
  }
  return {
    turn: 1,
    active,              // which planets feature in this playthrough
    location: start,
    res,
    pol,                // political meters: popularity / legitimacy / heat / slush
    orgs,               // founded organizations: orgId -> { tier }
    policies: {},       // enacted laws: policyId -> { since, target }
    floor: null,        // bill currently before the Senate: { billId, sway, target }
    planetLaws: {},     // player per-planet trade laws: pid -> com -> { type, until }
    invest: null,       // active corruption investigation: { lead, evidence, defense, cycles }
    jail: 0,            // cycles remaining in detention
    pirate: { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0, bountyKills: 0, bountyEarned: 0 },  // outlaw career
    prey: null,         // current raid encounter: { type, name, ico, cargo, credits, strength, faction, wantedGain }
    interdiction: null, // active navy confrontation: { kind, planet, strength, bribe }
    haven: null,        // pirate hideout: { planet, tier, stash } — lie low, stash loot, collect tribute
    commission: null,   // privateer letter of marque: { patron, target, expires, quota, done, bounty, reward }
    office,             // public office rank (0..4); perks.senator/governor derive from it
    officePath,         // how the current office was won: elected / appointed / seized
    term,               // cycles left in the current term (0 = none / life tenure)
    legacyTitle: null,  // set when a political legacy (Consul) is completed
    upgrades: Object.fromEntries(UPGRADES.map(u => [u.id, 0])),
    techs,
    missions: {},
    perks: {},
    rep: { core: 0, miners: 0, agri: 0, syndicate: 0, frontier: 0 },
    decrees: { monopoly: null, tariff: null },
    bases: {},          // planetId -> { modules:{id:tier}, storage:{com:qty} }
    colonies: {},       // planetId -> { pop, happiness, tax, buildings, storage }
    discovered: {},     // hidden planetId -> true (revealed by survey)
    contracts: [],      // active time-bounded random contracts
    contractSeq: 0,
    actionsUsed: 0,
    prices: {},
    reserves: {},               // per-planet, per-commodity deposit reserves { cur, max }
    crises: {},                 // active planetary crises: pid -> { type, cyclesLeft }
    pirates: {},                // pirate activity per world (0-5); hunted down, regrows in lawless space
    pirateCalm: 0,              // until this turn, pirate attacks are suppressed (you cleared the lanes)
    encounter: null,            // travel ambush: { level, strength, toll }
    pollution: {},              // per-planet industrial pollution 0–100
    climate: 0,                 // sector-wide climate stress 0–100 (smoothed mean pollution)
    visited: { [start]: true },
    log: [],
    stats: { jumps: 0, trades: 0, profit: 0, busts: 0 },
    journal: [],               // captain's log: persistent narrative chronicle
    achieved: {},
    won: false,
  };
}

function cargoCap()  { return BASE_CARGO + S.upgrades.cargo * 150; }
function fuelCap()   { return BASE_FUEL + S.upgrades.fueltank * 40; }
function cargoUsed() { return CARGO_IDS.reduce((s, id) => s + (S.res[id] || 0), 0); }
function cargoFree() { return cargoCap() - cargoUsed(); }
function currentPlanet() { return PLANETS.find(p => p.id === S.location); }
function actionsLeft() { return (S.jail > 0) ? 0 : ACTIONS_PER_CYCLE - S.actionsUsed; }
function useAction() { S.actionsUsed++; }

/* ============================================================
   PRICING  (per planet, supply/demand + reputation aware)
   ============================================================ */
function planetPriceMul(p, comId) {
  let m = 1;
  const c = COM[comId];
  const producesRaw = p.deposits && p.deposits[comId];
  if (producesRaw) {
    m *= 0.55;                                          // local raw → cheap…
    if (typeof S !== "undefined" && S && S.reserves)    // …until the deposit runs dry
      m *= 1 + (1 - reserveFrac(p.id, comId)) * 0.8;    // stripped world: 0.55 → ~0.99 (scarcity premium)
  }
  if (c.tier === "Raw" && !producesRaw) {
    m *= 1.25;                                          // imported raw → dear…
    if (typeof S !== "undefined" && S && S.reserves)    // …and dearer when the region's suppliers run dry
      m *= 1 + (1 - regionalSupply(p, comId)) * 0.6;
  }
  if (["Component", "Finished", "Luxury", "Strategic"].includes(c.tier))
    m *= 1 - (effIndustry(p) - 5) * 0.05;               // industrial worlds make goods cheaper
  if (isIllegalAt(comId, p.id)) m *= 1.35;              // scarce/black-market premium
  return Math.max(0.4, Math.min(1.9, m));
}

/* distance-weighted reserve health of the worlds that PRODUCE a raw good —
   an importing world's supply line. 1 = abundant nearby, 0 = region stripped. */
function regionalSupply(p, comId) {
  let wsum = 0, acc = 0;
  PLANETS.forEach(q => {
    if (q.id === p.id || !q.deposits || !q.deposits[comId]) return;
    const w = (q.deposits[comId]) / (1 + (p.distances[q.id] || 99));   // rich, close suppliers matter most
    wsum += w; acc += w * reserveFrac(q.id, comId);
  });
  return wsum > 0 ? acc / wsum : 1;
}

function rollPrices() {
  // pass 1: each world's local price target (deposits, scarcity, industry, law)
  const targets = {};
  PLANETS.forEach(p => {
    targets[p.id] = {};
    COM_IDS.forEach(c => { targets[p.id][c] = Math.min(COM[c].base * planetPriceMul(p, c) * crisisMul(p.id, c), COM[c].base * 2.8); });
  });
  // pass 2: markets are regional — blend toward a distance-weighted neighborhood mean,
  // so scarcity on one world bleeds into its neighbors. Averaging is contractive: it
  // spreads shocks but can never amplify them (no runaway prices).
  const DIFFUSION = 0.15;
  PLANETS.forEach(p => {
    S.prices[p.id] = S.prices[p.id] || {};
    COM_IDS.forEach(c => {
      let wsum = 0, acc = 0;
      PLANETS.forEach(q => {
        if (q.id === p.id) return;
        const w = 1 / (1 + (p.distances[q.id] || 99));
        wsum += w; acc += w * targets[q.id][c];
      });
      const regional = wsum > 0 ? acc / wsum : targets[p.id][c];
      const target = targets[p.id][c] * (1 - DIFFUSION) + regional * DIFFUSION;
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
function tradeSpread() {
  let s = Math.max(0.84, 0.90 - S.upgrades.trade * 0.04);
  if (policyActive("freetrade")) s = Math.min(0.97, s + 0.06);  // open lanes tighten spreads
  return s;
}
function policyBuyMul(c) {
  return 1;   // (contraband premiums now flow through isIllegalAt -> planetPriceMul)
}
function policySellMul(c) {
  let m = 1;
  if (policyActive("tariff")) m *= 1.10;                        // protectionism
  if (policyActive("mining") && COM[c].tier === "Raw") m *= 1.20; // raw-material windfall
  return m;
}
function buyPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  let v = S.prices[pid][c] * (1 + (1 - tradeSpread()) * 0.5);
  v *= 1 - repPriceFactor(p);            // friendly faction sells to you cheaper
  v *= policyBuyMul(c);
  return Math.max(1, Math.round(v));
}
function sellPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  let v = S.prices[pid][c] * tradeSpread();
  v *= 1 + repPriceFactor(p);            // friendly faction pays you more
  if (S.decrees.tariff === c) v *= 1.15; // your governor tariff lifts your sell price
  v *= policySellMul(c);
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
  if (type === "event") jot(msg);            // notable happenings flow into the captain's log
  renderLog();
}
/* ---- Captain's Log ("journal de bord") ----
   A persistent, plain-text chronicle of the playthrough, downloadable as a
   Markdown dossier rich enough for an LLM to write a biography or novel from. */
function jot(msg, cat) {
  if (!S.journal) S.journal = [];
  const text = String(msg).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const last = S.journal[S.journal.length - 1];
  if (last && last.turn === S.turn && last.text === text) return;   // de-dupe
  S.journal.push({ turn: S.turn, cat: cat || "", text });
  if (S.journal.length > 2000) S.journal.shift();
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
/* ============================================================
   RESOURCE RESERVES & DEPLETION
   Every planet deposit holds a finite reserve. Extraction draws it down and
   yield falls with it — an over-mined world asymptotes to a ~25% trickle
   (never zero, no dead-ends), nudging you toward fresh worlds. Renewables
   (food, ice, gas) slowly regrow; ores/crystals/isotopes/relics do not.
   ============================================================ */
const RESERVE_PER_DEP = 2500;                       // reserve stock per 1.0 of deposit richness
const RENEWABLE_RES = { biomass: true, spice: true, ice: true, gas: true };
function reserveOf(pid, c) {
  if (!S.reserves) S.reserves = {};
  if (!S.crises) S.crises = {};
  if (!S.journal) S.journal = [];
  if (!S.pirates) S.pirates = {};
  if (S.pirateCalm == null) S.pirateCalm = 0;
  if (S.encounter === undefined) S.encounter = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  if (!S.pollution) S.pollution = {};
  if (S.climate == null) S.climate = 0;
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

/* ============================================================
   POLLUTION & CLIMATE
   Industry and extraction foul the world they run on (0–100 per planet).
   Pollution decays naturally when activity stops — like depletion, it is a
   consequence of the player's footprint, not fate. The sector-wide mean
   drives a slow CLIMATE index with global effects on agriculture.
   ============================================================ */
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
  const mean = PLANETS.reduce((s, p) => s + pollutionOf(p.id), 0) / PLANETS.length;
  let cl = (S.climate || 0) + (mean * 4 - (S.climate || 0)) * 0.08;   // a few fouled worlds = real sector stress
  if (S.techs.terraform) cl -= 0.4;                                        // terraforming actively heals the sector
  if (policyActive("greenpact")) cl -= 0.2;
  S.climate = Math.max(0, Math.min(100, cl));
}

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
  let yld = Math.round(14 * dep * mod * tech * depletionMult(p.id, comId) * pollutionYieldMult(p.id));
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


/* ============================================================
   PIRACY — prowl the lanes, raid ships, plunder cargo
   ============================================================ */
const HULL_MAX = 100;
const PROWL_FUEL = 6;
function clampPirate() {
  const P = S.pirate;
  P.wanted = Math.max(0, Math.min(100, P.wanted));
  P.dread = Math.max(0, Math.min(100, P.dread));
  P.hull = Math.max(0, Math.min(HULL_MAX, P.hull));
}
function raidPower() {
  return 6 + S.upgrades.cannons * 9 + S.pirate.dread * 0.15 + (S.techs.weapontech ? 6 : 0);
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
function dmgReduction() { return Math.min(0.6, S.upgrades.shield * 0.18); }
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
function genPirate(level) {
  const lv = Math.max(1, Math.min(5, level));
  const R = PIRATE_RANKS[lv];
  return {
    type: "pirate", isPirate: true, level: lv,
    name: R.name, ico: R.ico, faction: "frontier",
    cargo: { weapons: rint(2, 4 + lv), fuel: rint(3, 8) },
    credits: rint(100, 250) * lv,
    strength: Math.round(R.str * (0.85 + Math.random() * 0.3)),
    bounty: Math.round(R.bounty * (0.85 + Math.random() * 0.3)),
    wantedGain: 0,
  };
}
function huntPirates() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (S.interdiction) return toast("Deal with the navy first.", "bad");
  if (S.encounter) return toast("You're already in a fight.", "bad");
  if (S.prey) return toast("You're already shadowing a target.", "bad");
  const p = currentPlanet(), lvl = pirateLevel(p.id);
  if (lvl <= 0) return toast("No pirate activity to hunt here.", "bad");
  if (S.res.fuel < PROWL_FUEL) return toast(`Need ${PROWL_FUEL} fuel to sweep the system.`, "bad");
  S.res.fuel -= PROWL_FUEL; useAction();
  if (Math.random() < 0.12) {
    log("🎯 You swept the system but the pirates kept to their holes.", "");
    toast("No pirates found.", "");
    return afterAction();
  }
  S.prey = genPirate(Math.max(1, lvl + rint(-1, 1)));
  log(`🎯 Pirate contact: a ${S.prey.ico} <span class="c">${S.prey.name}</span> — bounty ${fmt(S.prey.bounty)} cr on its head.`, "event");
  toast(`Pirate sighted: ${S.prey.name}`, "event");
  afterAction();
}
function pirateKillRewards(prey) {
  const p = currentPlanet();
  if (!S.pirates) S.pirates = {};
  S.pirate.bountyKills = (S.pirate.bountyKills || 0) + 1;
  S.pirate.bountyEarned = (S.pirate.bountyEarned || 0) + prey.bounty;
  S.res.credits += prey.bounty;
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
  if (Math.random() < 0.05 + lvl * 0.045) {
    const pirate = genPirate(Math.max(1, lvl + rint(-1, 0)));
    pirate.toll = Math.round(300 * pirate.level + Math.min(2500, (S.res.credits + cargoValue()) * 0.04));
    S.encounter = pirate;
    log(`🏴‍☠️ Ambush! A ${pirate.ico} <span class="c">${pirate.name}</span> drops out of the dark off ${dest.name} and demands ${fmt(pirate.toll)} cr — or your cargo.`, "bad");
    toast(`Pirate ambush: ${pirate.name}!`, "bad");
    if (typeof announce === "function") announce("🏴‍☠️ Pirate Ambush", `A ${pirate.name} has you in its sights. Pay, run, or fight.`, false);
    if (typeof setTab === "function") setTab("raid");
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
  const odds = 0.45 + S.upgrades.engine * 0.15 - e.level * 0.05;
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
function encounterFight() {
  const e = S.encounter; if (!e) return;
  const power = raidPower() + Math.random() * 10;
  const def = e.strength + Math.random() * 10;
  if (power > def) {
    const taken = plunder(e);
    const dmg = takeHullDamage(e.strength * 0.5 * (0.4 + Math.random() * 0.5) + 2);
    S.pirate.dread += 3; clampPirate();
    pirateKillRewards(e);
    S.encounter = null;
    log(`⚔️ You turned on the ${e.ico} ${e.name} and blew it apart! Bounty ${fmt(e.bounty)} cr + salvage ${taken.join(" ") || "none"}. (Hull −${dmg}, no Wanted)`, "good");
    toast(`Ambusher destroyed — bounty ${fmt(e.bounty)} cr!`, "good");
  } else {
    const dmg = takeHullDamage(e.strength * 0.8 * (0.6 + Math.random() * 0.6) + 5);
    const loss = Math.min(S.res.credits, Math.round(e.toll * 0.8));
    S.res.credits -= loss;
    const stolen = [];
    CARGO_IDS.forEach(c => { const take = Math.floor((S.res[c] || 0) * 0.2); if (take > 0) { S.res[c] -= take; stolen.push(`${take}${COM[c].ico}`); } });
    S.encounter = null;
    log(`💥 The ${e.name} beat you down — Hull −${dmg}, ${fmt(loss)} cr and ${stolen.join(" ") || "no cargo"} taken before they let you limp off.`, "bad");
    toast("Boarded and robbed!", "bad");
  }
  afterAction();
}

function processPirates() {
  if (!S.pirates) S.pirates = {};
  if (S.turn % 5 !== 0) return;                                  // pirates regroup slowly
  PLANETS.forEach(p => {
    const base = basePirateLevel(p), cur = pirateLevel(p.id);
    if (cur < base || (base > 0 && cur < 5 && Math.random() < 0.35))
      S.pirates[p.id] = Math.min(5, cur + 1);                    // lawless space breeds raiders
  });
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
  let strength = Math.round(A.base * (0.7 + law * 0.85) * (0.85 + Math.random() * 0.5)); // lawful escorts tough but beatable
  if (S.crises && S.crises[p.id]) strength = Math.round(strength * 0.85);                 // escorts thinned by the crisis
  return {
    type: key, name: A.name, ico: A.ico,
    faction: A.faction || p.faction,
    cargo, credits: rint(A.credits[0], A.credits[1]),
    strength,
    wantedGain: Math.round(A.wanted * (1 + law * 0.6)),
  };
}
function prowl() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (S.interdiction) return toast("There's a navy cutter on your tail — deal with it first.", "bad");
  if (S.encounter) return toast("A pirate has you in its sights — deal with it first.", "bad");
  if (S.prey) return toast("You're already shadowing a target.", "bad");
  if (S.res.fuel < PROWL_FUEL) return toast(`Need ${PROWL_FUEL} fuel to prowl the lanes.`, "bad");
  S.res.fuel -= PROWL_FUEL; useAction();
  const p = currentPlanet();
  // hunting in lawful space while notorious can flush out a patrol instead of prey
  if (S.pirate.wanted >= 30 && Math.random() < (S.pirate.wanted / 100) * p.enforce * 0.7) {
    startInterdiction(p, "patrol");
    return afterAction();
  }
  if (Math.random() < 0.15) {
    log("🔭 You prowled the lanes but found no prey worth the powder.", "");
    toast("No prey found.", "");
    return afterAction();
  }
  S.prey = genPrey();
  log(`🔭 Prey sighted: a ${S.prey.ico} <span class="c">${S.prey.name}</span> (${FACTIONS[S.prey.faction].name}).`, "event");
  toast(`Target sighted: ${S.prey.name}`, "event");
  afterAction();
}
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
  log(`💥 Your hull buckled! You limp away — lost ${jettisoned.join(" ") || "no cargo"} and paid ${fmt(tow)} cr for a tow.`, "bad");
  toast("Ship crippled!", "bad");
  jot(`Ship crippled near ${currentPlanet().name} — hull gave out, cargo jettisoned.`, "outlaw");
  if (typeof announce === "function") announce("💥 Ship Crippled", "Your hull gave out under fire. Cargo jettisoned and a tow paid — patch up before you raid again.", true);
}
function plunder(prey) {
  const taken = [];
  Object.keys(prey.cargo).forEach(c => {
    const room = cargoFree();
    const q = Math.min(prey.cargo[c], room);
    if (q > 0) { S.res[c] = (S.res[c] || 0) + q; taken.push(`${q} ${COM[c].ico}`); }
  });
  S.res.credits += prey.credits;
  let value = prey.credits;
  Object.keys(prey.cargo).forEach(c => value += (prey.cargo[c]) * COM[c].base);
  S.pirate.plundered += Math.round(value);
  return taken;
}
function resolveRaid(noQuarter) {
  const prey = S.prey; if (!prey) return;
  useAction();
  const power = raidPower() + Math.random() * 10;
  const def = prey.strength + Math.random() * 10;
  const margin = power - def;
  S.pirate.raids++;
  if (prey.isPirate) {
    if (margin > 0) {
      const taken = plunder(prey);
      const dmg = takeHullDamage(prey.strength * 0.5 * (0.4 + Math.random() * 0.5) + 3);
      S.pirate.dread += 3; clampPirate();                       // even pirates fear the hunter
      pirateKillRewards(prey);
      log(`🎯 You brought down the ${prey.ico} ${prey.name}! Bounty ${fmt(prey.bounty)} cr + salvage ${taken.join(" ") || "none"} + ${fmt(prey.credits)} cr. (Hull −${dmg}, no Wanted — a lawful kill)`, "good");
      toast(`Bounty collected: ${fmt(prey.bounty)} cr!`, "good");
    } else {
      const dmg = takeHullDamage(prey.strength * 0.8 * (0.6 + Math.random() * 0.6) + 6);
      log(`☠️ The ${prey.ico} ${prey.name} outfought you — Hull −${dmg} and it slipped back into the dark.`, "bad");
      toast("Pirate escaped!", "bad");
    }
    S.prey = null;
    return afterAction();
  }
  const betray = S.commission && prey.faction === S.commission.patron;
  if (margin > 0) {
    const taken = plunder(prey);
    const dmg = takeHullDamage(prey.strength * 0.5 * (0.4 + Math.random() * 0.5) + 3); // every fight scars the hull
    let dread = noQuarter ? 9 : 5;
    const sanctioned = applyCommissionRaid(prey);     // legal kill under marque
    let wanted = sanctioned ? (noQuarter ? 8 : 0) : prey.wantedGain + (noQuarter ? 8 : 0);
    S.pirate.dread += dread; S.pirate.wanted += wanted;
    addRep(prey.faction, noQuarter ? -14 : -8);
    if (!sanctioned) addRep("core", -(prey.faction === "core" ? 8 : 5));
    addRep("frontier", 3);
    clampPirate();
    log(`🏴‍☠️ You raided the ${prey.ico} ${prey.name}${noQuarter ? " and gave no quarter" : ""}! Plundered ${taken.join(" ") || "no cargo"} + ${fmt(prey.credits)} cr.${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""} (Hull −${dmg}, Dread +${dread}, Wanted +${wanted})`, "good");
    toast(`Plundered ${prey.name}!`, "good");
  } else {
    const dmg = takeHullDamage(prey.strength * 0.8 * (0.6 + Math.random() * 0.6) + 6);
    S.pirate.wanted += Math.round(prey.wantedGain * 0.5);
    clampPirate();
    log(`🛡️ The ${prey.ico} ${prey.name} fought you off — you took Hull −${dmg} and it slipped away. (Wanted +${Math.round(prey.wantedGain * 0.5)})`, "bad");
    toast("Driven off!", "bad");
  }
  if (betray) revokeCommission(true);   // raiding your own patron tears up the marque
  S.prey = null;
  afterAction();
}
function raidAttack() { if (!S.prey) return; if (actionsLeft() <= 0) return toast("No actions left.", "bad"); resolveRaid(false); }
function raidNoQuarter() { if (!S.prey) return; if (actionsLeft() <= 0) return toast("No actions left.", "bad"); resolveRaid(true); }
function raidExtort() {
  const prey = S.prey; if (!prey) return;
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  useAction();
  const intimidation = S.pirate.dread + raidPower() * 0.3 + Math.random() * 20;
  if (intimidation >= prey.strength * 1.4) {
    // they surrender tribute without a fight — partial haul, low heat
    const tributeCargo = {};
    Object.keys(prey.cargo).forEach(c => { const q = Math.floor(prey.cargo[c] * 0.6); if (q > 0) tributeCargo[c] = q; });
    const credits = Math.round(prey.credits * 0.6);
    const taken = plunder({ cargo: tributeCargo, credits });
    const sanctioned = applyCommissionRaid(prey);
    S.pirate.dread += 3; if (!sanctioned) S.pirate.wanted += Math.round(prey.wantedGain * 0.4);
    addRep(prey.faction, -5); clampPirate();
    log(`💀 Your reputation alone broke the ${prey.ico} ${prey.name} — it paid tribute: ${taken.join(" ") || "credits"} + ${fmt(credits)} cr.${sanctioned ? ` ⚖️ Sanctioned bounty +${fmt(COMM_BOUNTY)} cr.` : ""} No shots fired.`, "good");
    toast(`Tribute extorted from ${prey.name}!`, "good");
  } else {
    S.pirate.wanted += Math.round(prey.wantedGain * 0.3); clampPirate();
    log(`💀 The ${prey.ico} ${prey.name} called your bluff and ran. You aren't feared enough… yet.`, "bad");
    toast("They called your bluff.", "bad");
  }
  if (S.commission && prey.faction === S.commission.patron) revokeCommission(true);
  S.prey = null;
  afterAction();
}
function raidDisengage() {
  if (!S.prey) return;
  S.prey = null;
  log("You let the target slip past, unmolested.", "");
  afterAction();
}
function repairShip() {
  if (S.pirate.hull >= HULL_MAX) return toast("Hull is already pristine.", "bad");
  const rate = atHaven() ? 18 : 30;          // your own dry-dock patches up cheap
  const cost = Math.round((HULL_MAX - S.pirate.hull) * rate);
  if (S.res.credits < cost) return toast(`Repairs cost ${fmt(cost)} credits.`, "bad");
  S.res.credits -= cost; S.pirate.hull = HULL_MAX;
  log(`🔧 Hull fully repaired at ${currentPlanet().name}${atHaven() ? " (haven dry-dock)" : ""} for ${fmt(cost)} credits.`, "good");
  toast("Hull repaired.", "good");
  afterAction();
}
function processWanted() {
  if (!S.pirate) return;
  const P = S.pirate;
  // wanted cools when you lie low; faster out on the lawless rim
  const cool = (currentPlanet().enforce < 0.2) ? 4 : 2;
  P.wanted = Math.max(0, P.wanted - cool);
  P.dread = Math.max(0, P.dread - 1);     // a fearsome name fades if you stop raiding
  // bounty hunters come for the notorious
  if (P.wanted >= 40 && Math.random() < (P.wanted - 30) / 220) {
    const hunterStr = 18 + Math.round(P.wanted * 0.4);
    const power = raidPower() + Math.random() * 12;
    if (power > hunterStr + Math.random() * 12) {
      P.dread += 4; P.wanted = Math.max(0, P.wanted - 10); clampPirate();
      log(`🎯 A bounty hunter came for your head — you blew them out of the void. (Dread +4, Wanted −10)`, "good");
    } else {
      const dmg = takeHullDamage(hunterStr * 0.7);
      const loss = Math.min(S.res.credits, 400 + rint(0, 600));
      S.res.credits -= loss; clampPirate();
      log(`🎯 A bounty hunter ambushed you — Hull −${dmg}, ${fmt(loss)} cr in damages.`, "bad");
      toast("Bounty hunter attack!", "bad");
    }
  }
  clampPirate();
}

/* ------------------------------------------------------------
   THE LAW STRIKES BACK — navy interdiction, arrest, counterplay
   ------------------------------------------------------------ */
// strength of the cutter that comes for you: stiffer in lawful space, stiffer the more wanted you are.
// tuned so a combat-built captain (high cannons + Dread) can fight clear, while a light build can't.
function navyStrength(p) {
  return Math.round((12 + p.enforce * 24) * (0.8 + S.pirate.wanted / 130) * (0.9 + Math.random() * 0.3));
}
// what a payoff costs — scales with notoriety and how civilised the world is
function navyBribeCost(p) {
  return Math.round((600 + S.pirate.wanted * 45) * (0.6 + p.enforce));
}
function startInterdiction(p, kind) {
  S.interdiction = { kind, planet: p.id, strength: navyStrength(p), bribe: navyBribeCost(p) };
  const verb = kind === "dock" ? `${p.name} port authority flags your transponder` : "your prowl runs into a navy patrol sweep";
  log(`🚨 ${verb} — a navy cutter moves to interdict! (Bribe, fight, or surrender.)`, "bad");
  toast("Navy interdiction!", "bad");
  if (typeof announce === "function")
    announce("🚨 Navy Interdiction", `${p.name} authorities have you in their sights. Bribe, fight your way clear, or surrender — but you're locked down until it's settled.`, false);
  if (typeof setTab === "function") setTab("raid");
}
// called on arrival at a port: notorious captains can't just stroll into lawful space
function maybeInterdict(dest) {
  if (!S.pirate || S.interdiction || S.jail > 0) return;
  if (S.commission && dest.faction === S.commission.patron) return; // your patron's ports wave you through
  if (S.pirate.wanted < 25) return;                       // below "Wanted" the ports don't bother
  const distracted = (S.crises && S.crises[dest.id]) ? 0.5 : 1;   // a world in crisis has bigger problems
  if (Math.random() < (S.pirate.wanted / 100) * dest.enforce * 1.15 * distracted) startInterdiction(dest, "dock");
}
function navyBribe() {
  const it = S.interdiction; if (!it) return;
  const p = PLANETS.find(x => x.id === it.planet) || currentPlanet();
  if (p.enforce > 0.75) return toast("These officers don't take bribes — fight or surrender.", "bad");
  if (S.res.credits < it.bribe) return toast(`A payoff costs ${fmt(it.bribe)} cr.`, "bad");
  S.res.credits -= it.bribe;
  const cut = 8 + Math.round(S.pirate.wanted * 0.12);
  S.pirate.wanted = Math.max(0, S.pirate.wanted - cut);
  addRep("core", -3);
  S.interdiction = null; clampPirate();
  log(`💵 You greased the right palms (${fmt(it.bribe)} cr) and the patrol looks the other way. (Wanted −${cut})`, "good");
  toast("Bribe accepted.", "good");
  afterAction();
}
function navyFight() {
  const it = S.interdiction; if (!it) return;
  const power = raidPower() + Math.random() * 12;
  const def = it.strength + Math.random() * 12;
  if (power > def) {
    const dmg = takeHullDamage(it.strength * 0.6 * (0.5 + Math.random() * 0.5));
    S.pirate.dread += 10; S.pirate.wanted = Math.min(100, S.pirate.wanted + 6);
    addRep("core", -8); addRep("frontier", 5);
    S.interdiction = null; clampPirate();
    log(`⚔️ You shot your way clear of the navy! Hull −${dmg}. The legend grows. (Dread +10, Wanted +6)`, "good");
    toast("Escaped the navy!", "good");
    afterAction();
  } else {
    navyArrest("Your hull was shot out and you were boarded", true);
  }
}
function navySurrender() {
  if (!S.interdiction) return;
  navyArrest("You stood down and surrendered", false);
}
function navyArrest(reason, crippled) {
  const seized = [];
  CARGO_IDS.forEach(c => { if (S.res[c] > 0) { seized.push(`${S.res[c]} ${COM[c].ico}`); S.res[c] = 0; } });
  const fine = Math.min(S.res.credits, 1000 + Math.round(S.pirate.wanted * 30));
  S.res.credits -= fine;
  if (crippled) S.pirate.hull = Math.min(S.pirate.hull, 35);
  S.jail = (S.pirate.wanted >= 70) ? 2 : 1;
  S.pirate.wanted = Math.round(S.pirate.wanted * 0.35);
  S.pirate.dread = Math.max(0, S.pirate.dread - 10);
  S.interdiction = null; clampPirate();
  log(`⛓️ ${reason}. The navy seized ${seized.join(" ") || "no cargo"}, fined you ${fmt(fine)} cr, and jailed you for ${S.jail} cycle(s) — but your warrants are largely wiped.`, "bad");
  toast("Arrested!", "bad");
  jot(`Arrested at ${currentPlanet().name}: cargo seized, fined, jailed ${S.jail} cycle(s).`, "outlaw");
  if (typeof announce === "function")
    announce("⛓️ Arrested", `${reason}. Cargo seized and fined, jailed for ${S.jail} cycle(s) — your slate is mostly clean again.`, true);
  afterAction();
}
// active counterplay: buy off your warrants where officials are corruptible
function settleWarrants() {
  if (S.interdiction) return toast("Deal with the patrol on your tail first.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  const p = currentPlanet(), P = S.pirate;
  if (P.wanted <= 0) return toast("Your record is already clean.", "bad");
  if (p.enforce > 0.6) return toast("Officials here are incorruptible — take it to lawless space.", "bad");
  const cut = Math.min(P.wanted, 15 + Math.round(P.wanted * 0.25));
  const cost = Math.round(cut * (60 + p.enforce * 120));
  if (S.res.credits < cost) return toast(`Buying off these warrants costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost; P.wanted = Math.max(0, P.wanted - cut);
  addRep("syndicate", 1); clampPirate(); useAction();
  log(`📝 You laundered your record through ${p.name}'s corruptible officials for ${fmt(cost)} cr. (Wanted −${cut})`, "good");
  toast(`Warrants settled (−${cut} Wanted).`, "good");
  afterAction();
}

/* ------------------------------------------------------------
   PIRATE HAVEN — a hidden hideout: lie low, stash loot, draw tribute
   ------------------------------------------------------------ */
const HAVEN_COST = 6000, HAVEN_METALS = 30, HAVEN_STASH_BASE = 120, HAVEN_MAX_TIER = 3;
function canHaven(p) { return p.enforce <= 0.2 && p.faction !== "core"; } // only the lawless deep rim hides a den
function atHaven() { return S.haven && S.haven.planet === S.location; }
function havenStashCap() { return S.haven ? HAVEN_STASH_BASE * S.haven.tier : 0; }
function havenStashUsed() { return S.haven ? Object.values(S.haven.stash).reduce((s, q) => s + q, 0) : 0; }
function havenTributeRate() { return S.haven ? Math.round(S.pirate.dread * S.haven.tier * 1.2) : 0; }
function establishHaven() {
  if (S.haven) return toast("You already command a haven.", "bad");
  const p = currentPlanet();
  if (!canHaven(p)) return toast("Too exposed — carve a haven out of the lawless deep rim.", "bad");
  if (S.res.credits < HAVEN_COST || (S.res.metals || 0) < HAVEN_METALS)
    return toast(`A haven costs ${fmt(HAVEN_COST)} cr and ${HAVEN_METALS} ⛓️ metals.`, "bad");
  S.res.credits -= HAVEN_COST; S.res.metals -= HAVEN_METALS;
  S.haven = { planet: p.id, tier: 1, stash: {} };
  log(`🏴‍☠️ You carved a hidden haven out of <span class="c">${p.name}</span>. A lair to lie low, stash plunder, and rule the rim.`, "event");
  toast("Haven established!", "good");
  afterAction();
}
function upgradeHaven() {
  if (!S.haven) return;
  if (S.haven.tier >= HAVEN_MAX_TIER) return toast("Your haven is already a fortress.", "bad");
  const cost = HAVEN_COST * S.haven.tier;
  if (S.res.credits < cost) return toast(`Expanding the haven costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost; S.haven.tier++;
  log(`🏗️ Your haven grows to tier ${S.haven.tier} — more stash, fatter tribute.`, "good");
  toast(`Haven → tier ${S.haven.tier}`, "good");
  afterAction();
}
function layLow() {
  if (!atHaven()) return toast("Lie low only at your haven.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  if (S.pirate.wanted <= 0) return toast("Your slate is already clean.", "bad");
  const cut = 22 + S.haven.tier * 4;
  S.pirate.wanted = Math.max(0, S.pirate.wanted - cut);
  S.pirate.dread = Math.max(0, S.pirate.dread - 3); // out of sight, out of mind
  useAction(); clampPirate();
  log(`🤫 You vanish into the haven and let the heat die down. (Wanted −${cut})`, "good");
  toast(`Lying low (−${cut} Wanted).`, "good");
  afterAction();
}
function havenStashAll() {
  if (!atHaven()) return toast("No haven here.", "bad");
  let room = havenStashCap() - havenStashUsed(), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.res[c] || 0, room);
    if (q > 0) { S.res[c] -= q; S.haven.stash[c] = (S.haven.stash[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`🗄️ Stashed ${moved} units of plunder at your haven — safe from any boarding party.`, "good"); afterAction(); }
  else toast("Nothing to stash (or stash full).", "bad");
}
function havenTakeAll() {
  if (!atHaven()) return toast("No haven here.", "bad");
  let room = cargoFree(), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.haven.stash[c] || 0, room);
    if (q > 0) { S.haven.stash[c] -= q; if (S.haven.stash[c] <= 0) delete S.haven.stash[c]; S.res[c] = (S.res[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`📦 Loaded ${moved} units from the haven stash.`, "good"); afterAction(); }
  else toast("Nothing to take (or hold full).", "bad");
}
function processHaven() {
  if (!S.haven || !S.pirate) return;
  const tribute = havenTributeRate();
  if (tribute > 0) {
    S.res.credits += tribute;
    if (S.turn % 4 === 0) log(`👑 Your haven drew ${fmt(tribute)} cr in tribute from rim crews who fear your name.`, "good");
  }
}

/* ------------------------------------------------------------
   PRIVATEER COMMISSIONS — letters of marque: raid a faction's rivals, legally
   ------------------------------------------------------------ */
const FACTION_RIVAL = { core: "frontier", frontier: "core", syndicate: "core", miners: "agri", agri: "miners" };
const COMM_DURATION = 12, COMM_QUOTA = 5, COMM_BOUNTY = 800, COMM_REWARD = 4000, COMM_REP_REQ = 5;
function commissionCovers(faction) { return !!(S.commission && S.commission.target === faction); }
function acceptCommission() {
  if (S.commission) return toast("You already sail under a letter of marque.", "bad");
  const p = currentPlanet(), patron = p.faction, target = FACTION_RIVAL[patron];
  if (!target) return toast("No commission on offer here.", "bad");
  if ((S.rep[patron] || 0) < COMM_REP_REQ) return toast(`${FACTIONS[patron].name} won't commission a stranger — earn their trust first.`, "bad");
  S.commission = { patron, target, expires: S.turn + COMM_DURATION, quota: COMM_QUOTA, done: 0, bounty: COMM_BOUNTY, reward: COMM_REWARD };
  addRep(patron, 5); addRep(target, -8);
  log(`📜 ${FACTIONS[patron].name} grants you a letter of marque against the ${FACTIONS[target].name}. Hunt their shipping — and the law looks the other way.`, "event");
  toast("Letter of marque accepted!", "good");
  afterAction();
}
// applied on a successful raid: pays bounty, counts quota, and waives the Wanted you'd normally earn
function applyCommissionRaid(prey) {
  if (!commissionCovers(prey.faction)) return false;
  const c = S.commission;
  c.done++; S.res.credits += c.bounty; addRep(c.patron, 2);
  return true;
}
function revokeCommission(betrayed) {
  if (!S.commission) return;
  const c = S.commission;
  if (betrayed) {
    addRep(c.patron, -20); S.pirate.wanted = Math.min(100, S.pirate.wanted + 15);
    log(`📜 You turned on your patron — ${FACTIONS[c.patron].name} tears up your letter of marque and brands you an oathbreaker!`, "bad");
    toast("Commission betrayed!", "bad");
  }
  S.commission = null; clampPirate();
}
/* ------------------------------------------------------------
   PIRATE LORD — the outlaw capstone legacy
   ------------------------------------------------------------ */
const LORD_DREAD = 80, LORD_HAVEN_TIER = 2, LORD_PLUNDER = 50000, LORD_RAIDS = 20;
function pirateLordCriteria() {
  const P = S.pirate;
  return [
    { label: `Strike terror — Dread ${LORD_DREAD}+`, ok: P.dread >= LORD_DREAD },
    { label: `Command a stronghold — Haven tier ${LORD_HAVEN_TIER}+`, ok: !!(S.haven && S.haven.tier >= LORD_HAVEN_TIER) },
    { label: `Amass plunder — ${fmt(LORD_PLUNDER)} cr looted`, ok: P.plundered >= LORD_PLUNDER },
    { label: `Earn your reputation — ${LORD_RAIDS} raids`, ok: P.raids >= LORD_RAIDS },
  ];
}
function pirateLordReady() {
  return S.pirate && !S.legacyTitle && pirateLordCriteria().every(c => c.ok);
}
function pirateLegacy() {
  if (S.legacyTitle) return toast("Your legacy is already sealed.", "bad");
  if (!pirateLordReady()) return toast("You are not yet feared enough to claim the throne.", "bad");
  const coreRep = S.rep.core || 0;
  let title, blurb;
  if (coreRep >= 20 || (S.pirate.commissionsDone || 0) >= 2) {
    title = "The Corsair King";
    blurb = "Half-privateer, half-pirate, you turned the great powers' wars to your profit — ruling the lanes with their blessing and their fear alike.";
  } else if (coreRep <= -40) {
    title = "The Dread Lord";
    blurb = "A name whispered in terror from the Core to the rim; captains strike their colors at the mere sight of your sails.";
  } else {
    title = "The Pirate King";
    blurb = "From a hidden haven you command the outlaws of the rim, and the sector's wealth flows through your hands.";
  }
  S.legacyTitle = title;
  log(`🏴‍☠️ PIRATE LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`PIRATE LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your outlaw legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — pirate legacy complete!`, "good");
  afterAction();
}

/* ---- Bounty Hunter capstone — the lawful mirror of the Pirate Lord ---- */
const MARSHAL_KILLS = 20, MARSHAL_EARNED = 40000, MARSHAL_REP = 50;
function marshalCriteria() {
  const P = S.pirate, actives = PLANETS.filter(isActive);
  return [
    { label: `Hunt down ${MARSHAL_KILLS} pirates`, ok: (P.bountyKills || 0) >= MARSHAL_KILLS },
    { label: `Collect ${fmt(MARSHAL_EARNED)} cr in bounties`, ok: (P.bountyEarned || 0) >= MARSHAL_EARNED },
    { label: `Win the law's trust — Core rep ${MARSHAL_REP}+`, ok: (S.rep.core || 0) >= MARSHAL_REP },
    { label: `Pacify the sector — no world above activity 1`, ok: actives.every(p => pirateLevel(p.id) <= 1) },
  ];
}
function marshalReady() {
  return S.pirate && !S.legacyTitle && (S.pirate.bountyKills || 0) > 0 && marshalCriteria().every(c => c.ok);
}
function marshalLegacy() {
  if (S.legacyTitle) return toast("Your legacy is already sealed.", "bad");
  if (!marshalReady()) return toast("The sector isn't yet pacified under your banner.", "bad");
  const P = S.pirate, coreRep = S.rep.core || 0;
  let title, blurb;
  if ((P.raids || 0) >= 10 || (P.dread || 0) >= 30 || (P.wanted || 0) >= 30) {
    title = "The Bounty King";
    blurb = "Hunter and hunted both, you turned the bounty trade into an empire — feared by raiders and paid by the law in equal measure.";
  } else if (coreRep >= 70) {
    title = "The Sector Marshal";
    blurb = "You pacified the sector under the law's own banner; from the Core to the rim, your name became a synonym for order.";
  } else {
    title = "The Lawbringer";
    blurb = "You broke every pirate stronghold on the frontier and made the lanes safe again — a legend in white.";
  }
  S.legacyTitle = title;
  log(`⚖️ LAWBRINGER LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`LAWBRINGER LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your bounty-hunter legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — bounty-hunter legacy complete!`, "good");
  afterAction();
}
function processCommission() {
  if (!S.commission || S.turn < S.commission.expires) return;
  const c = S.commission;
  if (c.done >= c.quota) {
    S.res.credits += c.reward; S.res.influence = (S.res.influence || 0) + 10; addRep(c.patron, 10);
    S.pirate.commissionsDone = (S.pirate.commissionsDone || 0) + 1;
    log(`📜 Commission fulfilled! ${FACTIONS[c.patron].name} pays a ${fmt(c.reward)} cr bonus and hails you a privateer. (+influence, +rep)`, "good");
    toast("Commission fulfilled!", "good");
  } else {
    addRep(c.patron, -3);
    log(`📜 Your letter of marque against the ${FACTIONS[c.target].name} lapsed with the quota unmet (${c.done}/${c.quota}).`, "bad");
  }
  S.commission = null;
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
  let cap = Math.floor((3 + effIndustry(p)) * (1 + S.upgrades.factory * 0.30));
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
  const pts = Math.round((2 + effTech(p)) * (1 + S.upgrades.lab * 0.40));
  S.res.tech += pts; useAction();
  log(`Generated <span class="c">${pts}</span> tech points on ${p.name}.`, "good");
  toast(`+${pts} 🔬 tech`, "good");
  afterAction();
}
/* One-click political career entry — replaces the old "Politics" new-game
   button: founds your party and seeds clout, all within the running game. */
const PUBLIC_LIFE_COST = 5000;
function enterPublicLife() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (S.office > 0 || S.orgs.party) return toast("You're already in public life.", "bad");
  if (S.res.credits < PUBLIC_LIFE_COST) return toast(`Entering public life costs ${fmt(PUBLIC_LIFE_COST)} credits.`, "bad");
  S.res.credits -= PUBLIC_LIFE_COST;
  S.orgs.party = { tier: 1 };
  S.res.influence = (S.res.influence || 0) + 15;
  applyPolDelta({ popularity: 10 });
  useAction();
  log(`🏛️ You enter public life — a movement of your own, a war chest and a name people are starting to know. Build popularity and run for office.`, "event");
  toast("Welcome to public life!", "good");
  afterAction();
}

function doPolitics() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  let inf = Math.round((2 + (effTech(p) + effIndustry(p)) / 3) * (1 + S.upgrades.envoy * 0.40));
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

/* ---------- Political organizations & power meters ---------- */
function canPolitick() { return !!S.techs.diplomacy; }   // Galactic Charter gates organizations
function orgDef(id) { return ORGS.find(o => o.id === id); }
function orgUpkeepTotal() {
  return Object.entries(S.orgs || {}).reduce((s, [id, o]) => s + orgDef(id).upkeep * o.tier, 0);
}
function orgUpgradeCost(def, tier) { return Math.round(def.foundCost * Math.pow(def.costMul, tier)); }
function clampPol() {
  const P = S.pol;
  P.popularity = Math.max(0, Math.min(100, P.popularity));
  P.legitimacy = Math.max(-100, Math.min(100, P.legitimacy));
  P.heat = Math.max(0, Math.min(100, P.heat));
  P.slush = Math.max(0, Math.round(P.slush));
}
function applyPolDelta(d) {
  if (!d) return;
  const P = S.pol;
  if (d.popularity) P.popularity += d.popularity;
  if (d.legitimacy) P.legitimacy += d.legitimacy;
  if (d.heat)       P.heat += (d.heat > 0 && policyActive("anticorr")) ? d.heat * 1.6 : d.heat; // oversight bites
  if (d.slush)      P.slush += d.slush;
  if (d.influence)  S.res.influence = (S.res.influence || 0) + d.influence;
  if (d.credits)    S.res.credits += d.credits;
  if (d.unrest)     Object.values(S.colonies || {}).forEach(c => { c.unrest = Math.max(0, (c.unrest || 0) + d.unrest); });
  clampPol();
}
function foundOrg(id) {
  if (!canPolitick()) return toast("Research Galactic Charter first.", "bad");
  const def = orgDef(id);
  if (!def || (S.orgs && S.orgs[id])) return;
  if (S.res.credits < def.foundCost) return toast("Not enough credits to found this.", "bad");
  S.res.credits -= def.foundCost; S.orgs[id] = { tier: 1 };
  log(`Founded ${def.ico} <span class="c">${def.name}</span> (upkeep ${fmt(def.upkeep)}/cycle).`, "event");
  toast(`${def.name} founded!`, "event");
  afterAction();
}
function upgradeOrg(id) {
  const def = orgDef(id), o = S.orgs[id];
  if (!o || o.tier >= def.tiers) return;
  const cost = orgUpgradeCost(def, o.tier);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost; o.tier++;
  log(`Upgraded ${def.ico} ${def.name} to Tier ${o.tier}.`, "good");
  toast(`${def.name} → Tier ${o.tier}`, "good");
  afterAction();
}
function payAbilityCost(cost) {
  cost = cost || {};
  if (cost.credits && S.res.credits < cost.credits)       return `Need ${fmt(cost.credits)} credits.`;
  if (cost.influence && (S.res.influence || 0) < cost.influence) return `Need ${cost.influence} influence.`;
  if (cost.slush && S.pol.slush < cost.slush)             return `Need ${fmt(cost.slush)} slush.`;
  if (cost.credits)   S.res.credits -= cost.credits;
  if (cost.influence) S.res.influence -= cost.influence;
  if (cost.slush)     S.pol.slush -= cost.slush;
  return null;
}
function runOrgAbility(orgId, abId) {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const def = orgDef(orgId), o = S.orgs[orgId];
  if (!o) return;
  const ab = def.abilities.find(a => a.id === abId);
  if (!ab) return;
  const err = payAbilityCost(ab.cost);
  if (err) return toast(err, "bad");
  ab.effect(o);
  useAction();
  log(`${def.ico} ${def.name}: ${ab.name}.`, def.tone === "dark" ? "event" : "good");
  afterAction();
}
function processOrgs() {
  if (!S.pol) return;
  const P = S.pol;
  // passive yields from every organization
  Object.entries(S.orgs || {}).forEach(([id, o]) => applyPolDelta(orgDef(id).passive(o)));
  // upkeep — if you can't make payroll, the priciest org downsizes (a scandal)
  const due = orgUpkeepTotal();
  if (due > 0) {
    if (S.res.credits >= due) S.res.credits -= due;
    else {
      const ids = Object.keys(S.orgs).sort((a, b) =>
        orgDef(b).upkeep * S.orgs[b].tier - orgDef(a).upkeep * S.orgs[a].tier);
      const victim = ids[0];
      if (victim) {
        const d = orgDef(victim);
        S.orgs[victim].tier--;
        const collapsed = S.orgs[victim].tier <= 0;
        if (collapsed) delete S.orgs[victim];
        applyPolDelta({ heat: 5, popularity: -5 });
        log(`⚠️ Couldn't make payroll — ${d.ico} ${d.name} ${collapsed ? "collapsed" : "downsized"}. Whispers spread.`, "bad");
      }
    }
  }
  // natural drift: trust follows legitimacy, attention fades
  P.popularity += Math.round(P.legitimacy / 40);
  P.popularity -= 1;
  clampPol();
  // heat cools over time; sustained heat feeds corruption investigations (processInvestigation)
  if (P.heat >= 65 && !S.invest) log(`🕵️ Investigators are sniffing around your affairs (Heat ${Math.round(P.heat)}).`, "bad");
  P.heat = Math.max(0, P.heat - 3);
  clampPol();
}

/* ---------- The Senate: voting, bills & policies ---------- */
function canLegislate() { return !!(S.perks.senator || S.perks.governor); }
function billDef(id) { return BILLS.find(b => b.id === id); }
function factionSeats(f) { return 2 + activePlanets().filter(p => p.faction === f).length; }
function senateSize() { return Object.keys(FACTIONS).reduce((s, f) => s + factionSeats(f), 0); }
function factionInclination(f, bill) {
  let s = (bill.stance && bill.stance[f]) || 0;
  s += (S.rep[f] || 0) / 35;                 // standing with the bloc
  s += (S.pol.popularity - 50) / 40;         // public pressure
  s += S.pol.legitimacy / 120;               // statesmen are trusted
  if (S.perks.governor) s += 0.5; else if (S.perks.senator) s += 0.25;
  if (S.floor && S.floor.billId === bill.id) s += (S.floor.sway[f] || 0); // your whipping
  return s;
}
function factionVote(f, bill) { const s = factionInclination(f, bill); return s > 0.4 ? "yes" : s < -0.4 ? "no" : "abstain"; }
function tallyFloor() {
  const bill = billDef(S.floor.billId); let yes = 0, no = 0, abstain = 0;
  Object.keys(FACTIONS).forEach(f => {
    const v = factionVote(f, bill), seats = factionSeats(f);
    if (v === "yes") yes += seats; else if (v === "no") no += seats; else abstain += seats;
  });
  return { yes, no, abstain };
}
function proposeBill(id, target) {
  if (!canLegislate()) return toast("Win a Senate seat first (Office & Elections).", "bad");
  if (S.floor) return toast("A bill is already on the floor.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const bill = billDef(id);
  if (!bill) return;
  if (bill.targeted && (!target || !COM[target])) return toast("Choose a commodity to target.", "bad");
  if (bill.reqPerk && !S.perks[bill.reqPerk]) return toast(`Requires ${bill.reqPerk === "governor" ? "Sector Governor" : bill.reqPerk}.`, "bad");
  if (!bill.oneShot && policyActive(bill.id)) return toast("That law is already in force.", "bad");
  const cost = bill.proposeCost || 20;
  if ((S.res.influence || 0) < cost) return toast(`Need ${cost} influence to propose.`, "bad");
  if (bill.proposeCredits && S.res.credits < bill.proposeCredits) return toast(`Need ${fmt(bill.proposeCredits)} credits.`, "bad");
  S.res.influence -= cost;
  if (bill.proposeCredits) S.res.credits -= bill.proposeCredits;
  S.floor = { billId: id, sway: {}, target: bill.targeted ? target : null };
  applyPolDelta({ heat: 2 });
  useAction();
  log(`📜 Proposed <span class="c">${bill.name}${bill.targeted ? `: ${COM[target].name}` : ""}</span> to the Senate.`, "event");
  toast("Bill on the floor.", "event");
  afterAction();
}
function lobbyFaction(f) {
  if (!S.floor) return;
  if ((S.floor.sway[f] || 0) >= 3) return toast("That bloc is fully courted.", "bad");
  const cost = 8;
  if ((S.res.influence || 0) < cost) return toast("Need 8 influence.", "bad");
  S.res.influence -= cost; S.floor.sway[f] = (S.floor.sway[f] || 0) + 0.6;
  applyPolDelta({ heat: 2 });
  log(`Lobbied ${FACTIONS[f].ico} ${FACTIONS[f].name} on the floor.`);
  afterAction();
}
function bribeFaction(f) {
  if (!S.floor) return;
  if ((S.floor.sway[f] || 0) >= 3) return toast("That bloc is already bought.", "bad");
  const cost = 600;
  if (S.pol.slush < cost) return toast("Need 600 slush (raise dirty funds first).", "bad");
  S.pol.slush -= cost; S.floor.sway[f] = (S.floor.sway[f] || 0) + 1.2;
  applyPolDelta({ heat: 6, legitimacy: -2 });
  log(`💼 Bribed ${FACTIONS[f].ico} ${FACTIONS[f].name} with slush.`, "event");
  afterAction();
}
function enactBill(bill, target) {
  Object.keys(FACTIONS).forEach(f => { const st = (bill.stance && bill.stance[f]) || 0; if (st) addRep(f, st * 2); });
  const tone = { bright: { legitimacy: 8, popularity: 5 }, grey: { legitimacy: 0, popularity: 2 }, dark: { legitimacy: -8, popularity: -4 } }[bill.tone];
  applyPolDelta(tone);
  if (bill.oneShot) bill.oneShot();
  else S.policies[bill.id] = { since: S.turn, target: target || null };
  if (bill.id === "ban" && target) PLANETS.forEach(p => priceShock(p.id, target, 1.25)); // sector-wide price shock
}
function callVote() {
  if (!S.floor) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const bill = billDef(S.floor.billId);
  if (!bill) { S.floor = null; return; }
  const t = tallyFloor();
  useAction();
  if (t.yes > t.no) {
    enactBill(bill, S.floor.target);
    log(`🏛️ <span class="c">${bill.name}${S.floor.target ? `: ${COM[S.floor.target].name}` : ""}</span> PASSED ${t.yes}–${t.no}.`, "good");
    toast("Bill passed!", "good");
  } else {
    Object.keys(FACTIONS).forEach(f => { if (((bill.stance && bill.stance[f]) || 0) > 0) addRep(f, -2); });
    applyPolDelta({ popularity: -2 });
    log(`🏛️ <span class="c">${bill.name}</span> FAILED ${t.yes}–${t.no}.`, "bad");
    toast("Bill failed.", "bad");
  }
  S.floor = null;
  afterAction();
}
function repealPolicy(id) {
  if (!S.policies[id]) return;
  const cost = 15;
  if ((S.res.influence || 0) < cost) return toast("Need 15 influence to repeal.", "bad");
  S.res.influence -= cost; delete S.policies[id];
  log(`Repealed ${billDef(id) ? billDef(id).name : id}.`, "event");
  afterAction();
}
function applyPolicyEffects() {
  if (!S.policies) return;
  if (policyActive("ubi")) {
    const cost = 2000;
    if (S.res.credits >= cost) {
      S.res.credits -= cost; applyPolDelta({ popularity: 2 });
      Object.values(S.colonies || {}).forEach(c => c.unrest = Math.max(0, (c.unrest || 0) - 1));
    } else {
      delete S.policies.ubi; applyPolDelta({ popularity: -6 });
      log("⚠️ The treasury couldn't fund Universal Basic Income — it lapsed amid protests.", "bad");
    }
  }
  if (policyActive("monopoly_grant")) { S.res.credits += 1200; applyPolDelta({ heat: 4 }); }
  if (policyActive("martial")) {
    Object.values(S.colonies || {}).forEach(c => c.unrest = Math.max(0, (c.unrest || 0) - 2));
    applyPolDelta({ popularity: -1 });
  }
}

/* ---------- Per-planet trade laws (lobbying) ----------
   Lobby the local authority to OUTLAW a good (chokes supply → its contraband
   price climbs, but selling it risks customs) or LEGALIZE a restricted good
   (opens the market → its price softens). Local, temporary, influence-funded,
   and a little shady. The sector-wide, permanent version is the Senate's Trade
   Restriction Act. */
function lobbyLaw(comId, type) {
  if (!canPolitick()) return toast("Research Galactic Charter first.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (!COM[comId]) return;
  const p = currentPlanet(), pid = p.id;
  if (type === "legal" && !isIllegalAt(comId, pid)) return toast(`${COM[comId].name} is already legal here.`, "bad");
  if (type === "ban" && lawStatus(pid, comId) === "ban") return toast(`${COM[comId].name} is already outlawed here.`, "bad");
  const cost = 14 + Math.round(p.enforce * 20);          // lawful worlds are harder to sway
  if ((S.res.influence || 0) < cost) return toast(`Need ${cost} influence to sway ${p.name}.`, "bad");
  S.res.influence -= cost; useAction();
  S.planetLaws[pid] = S.planetLaws[pid] || {};
  S.planetLaws[pid][comId] = { type, until: S.turn + LAW_DURATION };
  if (type === "ban") { priceShock(pid, comId, 1.25); applyPolDelta({ heat: 6, legitimacy: -2 }); addRep("core", 2); addRep(p.faction, -3); }
  else               { priceShock(pid, comId, 0.85); applyPolDelta({ heat: 4, legitimacy: -1 }); addRep("frontier", 3); addRep("core", -3); }
  log(`🏴 You lobbied ${p.name} to ${type === "ban" ? "OUTLAW" : "LEGALIZE"} ${COM[comId].ico} ${COM[comId].name} for ${LAW_DURATION} cycles.`, "event");
  toast(`${COM[comId].name} ${type === "ban" ? "outlawed" : "legalized"} on ${p.name}.`, "event");
  afterAction();
}
function processPlanetLaws() {
  if (!S.planetLaws) return;
  Object.keys(S.planetLaws).forEach(pid => {
    const m = S.planetLaws[pid];
    Object.keys(m).forEach(c => {
      if (m[c].until <= S.turn) {
        delete m[c];
        const pl = PLANETS.find(p => p.id === pid);
        log(`🏴 Your trade law on ${pl ? pl.name : pid} (${COM[c].name}) has lapsed.`, "");
      }
    });
    if (!Object.keys(m).length) delete S.planetLaws[pid];
  });
}

/* ---------- Corruption investigations & trials ----------
   Sustained Heat opens a formal investigation led by the faction most opposed
   to you. Each cycle a case file builds (faster with high Heat, slower if you're
   a respected statesman). Manage the evidence — clean (lawyer up) or dirty
   (bribe / bury / strong-arm / scapegoat) — or it reaches trial at 100. The
   verdict weighs the evidence against your legitimacy, popularity, defense and
   standing with the prosecutor: from acquittal through fines, censure, removal
   from office and imprisonment, to disgrace and exile. */
function pickLeadFaction() {
  const fs = Object.keys(FACTIONS).filter(f => activePlanets().some(p => p.faction === f));
  fs.sort((a, b) => (S.rep[a] || 0) - (S.rep[b] || 0));   // your biggest adversary prosecutes
  return fs[0] || "core";
}
function openInvestigation(lead) {
  S.invest = { lead, evidence: 25, defense: 0, cycles: 0, opened: S.turn };
  log(`🚨 ${FACTIONS[lead].ico} ${FACTIONS[lead].name} has opened a corruption investigation into your affairs!`, "bad");
  toast("Investigation opened!", "bad");
  if (typeof announce === "function") announce("🚨 Investigation Opened", `${FACTIONS[lead].name} is building a case. Manage the evidence — or face trial.`, true);
}
function processInvestigation() {
  if (!S.pol) return;
  const P = S.pol;
  if (!S.invest) {
    let openChance = 0;
    if (P.heat >= 100) openChance = 1;
    else if (P.heat >= 55) openChance = (P.heat - 50) / 130;
    if (openChance > 0 && Math.random() < openChance) openInvestigation(pickLeadFaction());
    return;
  }
  const inv = S.invest;
  let d = (P.heat - 35) / 8 - P.legitimacy / 45;          // heat builds the case; legitimacy slows it
  if (policyActive("anticorr") && d > 0) d *= 1.5;        // oversight accelerates the case
  inv.evidence = Math.max(0, Math.min(100, inv.evidence + d));
  inv.cycles = (inv.cycles || 0) + 1;
  if (inv.evidence <= 0 && inv.cycles >= 2) {
    log(`⚖️ The investigation against you collapsed for lack of evidence.`, "good");
    applyPolDelta({ legitimacy: 4 });
    S.invest = null;
  } else if (inv.evidence >= 100) {
    log(`⚖️ The evidence is overwhelming — you are indicted and brought to trial.`, "bad");
    holdTrial(false);
  } else {
    log(`⚖️ Investigation continues — evidence ${Math.round(inv.evidence)}/100 (${FACTIONS[inv.lead].name} leading).`, "");
  }
}
function holdTrial(voluntary) {
  const inv = S.invest;
  if (!inv) return;
  const P = S.pol;
  const guilt = inv.evidence + Math.max(0, -P.legitimacy) * 0.6 + P.heat * 0.2;
  const defense = (inv.defense || 0) + Math.max(0, P.legitimacy) * 0.5 + P.popularity * 0.4 + Math.max(0, S.rep[inv.lead] || 0) * 0.3;
  const net = guilt - defense + (Math.random() * 20 - 10);  // jury noise
  const ev = Math.round(inv.evidence);
  S.invest = null;                                          // case is resolved either way
  if (net < 8) {
    applyPolDelta({ legitimacy: 8, popularity: 6 }); S.pol.heat = Math.max(0, S.pol.heat - 40);
    log(`🏛️ Trial verdict: <span class="c">ACQUITTED</span>. You walk free, vindicated — public sympathy swells.`, "good");
    toast("Acquitted!", "good"); if (typeof fireworks === "function") fireworks(1800, false);
  } else if (net < 30) {
    const fine = Math.min(S.res.credits, 3000 + ev * 60);
    S.res.credits -= fine; applyPolDelta({ heat: -20, legitimacy: -2 });
    log(`🏛️ Trial verdict: <span class="c">FINED</span> ${fmt(fine)} credits for minor improprieties.`, "bad");
    toast(`Fined ${fmt(fine)} cr.`, "bad");
  } else if (net < 60) {
    S.res.influence = Math.max(0, (S.res.influence || 0) - 30);
    addRep(inv.lead, -10); applyPolDelta({ popularity: -10, legitimacy: -6, heat: -25 });
    log(`🏛️ Trial verdict: <span class="c">CENSURED</span>. Your influence and standing take a public beating.`, "bad");
    toast("Censured.", "bad");
  } else if (net < 90) {
    const office = stripOffice();
    const fine = Math.min(S.res.credits, 4000);
    S.res.credits -= fine; S.res.influence = Math.max(0, (S.res.influence || 0) - 40);
    applyPolDelta({ popularity: -12, legitimacy: -8, heat: -20 });
    log(`🏛️ Trial verdict: <span class="c">REMOVED FROM OFFICE</span>${office ? ` — you lose your ${office} title` : ""}, and fined ${fmt(fine)} credits.`, "bad");
    toast("Removed from office.", "bad");
  } else if (net < 120) {
    const office = stripOffice();
    S.jail = 2; const fine = Math.min(S.res.credits, 3000); S.res.credits -= fine;
    applyPolDelta({ popularity: -15, legitimacy: -10 }); S.pol.heat = 10;
    log(`🏛️ Trial verdict: <span class="c">IMPRISONED</span> for 2 cycles${office ? `, stripped of your ${office} title` : ""}, and fined ${fmt(fine)} credits.`, "bad");
    toast("Imprisoned!", "bad");
    if (typeof announce === "function") announce("⛓️ Imprisoned", "You are jailed for 2 cycles. Your machine runs on without you.", true);
  } else {
    // disgrace & exile — the political career is wiped (you remain a trader)
    S.office = 0; S.officePath = null; S.term = 0;
    S.perks.senator = false; S.perks.governor = false;
    S.orgs = {}; S.policies = {}; S.floor = null; S.decrees = { monopoly: null, tariff: null };
    S.pol = { popularity: 5, legitimacy: -55, heat: 0, slush: 0 }; S.res.influence = 0; S.jail = 2;
    log(`🏛️ Trial verdict: <span class="c">DISGRACED & EXILED</span>. You are stripped of every office, organization and law — your political career lies in ruins.`, "bad");
    toast("Disgraced and exiled.", "bad");
    if (typeof announce === "function") announce("🏛️ Disgraced", "Stripped of all office and power. You'll have to rebuild — or return to trade.", true);
  }
}
function stripOffice() {
  if ((S.office || 0) < 1) return "";
  const lost = OFFICES[S.office].name;
  S.office--; syncOfficePerks();
  S.term = (S.office >= 1 && OFFICES[S.office]) ? OFFICES[S.office].term : 0;
  return lost;
}
/* ----- countermeasures (each costs 1 action) ----- */
function investAct() { return S.invest && actionsLeft() > 0; }
function investLawyer() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const cost = 1500;
  if (S.res.credits < cost) return toast("Need 1,500 credits.", "bad");
  S.res.credits -= cost; S.invest.defense += 12; S.invest.evidence = Math.max(0, S.invest.evidence - 4);
  applyPolDelta({ legitimacy: 1 }); useAction();
  log("⚖️ Your lawyers build the defense and chip at the case.", "good"); afterAction();
}
function investBribe() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const cost = 800;
  if (S.pol.slush < cost) return toast("Need 800 slush.", "bad");
  S.pol.slush -= cost; useAction();
  if (Math.random() < 0.65) { S.invest.evidence = Math.max(0, S.invest.evidence - 18); log("💼 A quiet payment makes evidence vanish.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 12); applyPolDelta({ heat: 10, legitimacy: -4 }); log("💼 Your bribe was exposed — it backfires badly!", "bad"); }
  afterAction();
}
function investSpin() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.media) return toast("Requires a Media Network.", "bad");
  const cost = 600;
  if (S.res.credits < cost) return toast("Need 600 credits.", "bad");
  S.res.credits -= cost; S.invest.evidence = Math.max(0, S.invest.evidence - 6); applyPolDelta({ heat: -8 });
  useAction(); log("🧼 Your media spins the story — the case softens.", "good"); afterAction();
}
function investBury() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.intel) return toast("Requires an Intelligence Cell.", "bad");
  const cost = 1000;
  if (S.res.credits < cost) return toast("Need 1,000 credits.", "bad");
  S.res.credits -= cost; useAction();
  if (Math.random() < 0.85) { S.invest.evidence = Math.max(0, S.invest.evidence - 14); applyPolDelta({ legitimacy: -2 }); log("🗄️ Evidence quietly disappears.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 8); applyPolDelta({ heat: 8, legitimacy: -3 }); log("🗄️ Your operatives were caught tampering — it backfires!", "bad"); }
  afterAction();
}
function investStrongarm() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.pmc) return toast("Requires Private Security.", "bad");
  const cost = 8;
  if ((S.res.influence || 0) < cost) return toast("Need 8 influence.", "bad");
  S.res.influence -= cost; useAction();
  if (Math.random() < 0.7) { S.invest.evidence = Math.max(0, S.invest.evidence - 12); applyPolDelta({ heat: 6, legitimacy: -3 }); log("😠 Witnesses suddenly forget what they saw.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 8); applyPolDelta({ heat: 12, legitimacy: -4 }); log("😠 The intimidation leaks — outrage strengthens the case!", "bad"); }
  afterAction();
}
function investScapegoat() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const ids = Object.keys(S.orgs || {});
  if (!ids.length) return toast("No organization to scapegoat.", "bad");
  ids.sort((a, b) => orgDef(a).foundCost * S.orgs[a].tier - orgDef(b).foundCost * S.orgs[b].tier);
  const victim = ids[0], d = orgDef(victim);
  delete S.orgs[victim];
  S.invest.evidence = Math.max(0, S.invest.evidence - 30); applyPolDelta({ popularity: -6, legitimacy: -2 });
  useAction();
  log(`🪤 You pin it all on ${d.ico} ${d.name} — the organization is dissolved and the case weakens.`, "event");
  afterAction();
}
function faceTrial() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  useAction(); holdTrial(true); afterAction();
}

/* ---------- Public office: elections, appointments, coups & terms ---------- */
function syncOfficePerks() {
  S.perks.senator = (S.office >= 2);
  S.perks.governor = (S.office >= 3);
  if (S.office < 3) S.decrees = { monopoly: null, tariff: null };
}
function takeOffice(level, path) {
  S.office = level; S.officePath = path;
  S.term = (OFFICES[level] && OFFICES[level].term) || 0;
  syncOfficePerks();
  if (level >= 4) politicalLegacy(path);
}
function repAverage() { return Object.keys(FACTIONS).reduce((s, f) => s + (S.rep[f] || 0), 0) / Object.keys(FACTIONS).length; }
function officeGuard(lvl) {
  if (!canPolitick()) { toast("Research Galactic Charter first.", "bad"); return false; }
  if (!OFFICES[lvl]) { toast("You already hold the highest office.", "bad"); return false; }
  if (actionsLeft() <= 0) { toast("No actions left — end the cycle.", "bad"); return false; }
  return true;
}
function runForElection() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needPop = ELECT_POP[lvl], chest = 2000 * lvl;
  if (S.pol.popularity < needPop) return toast(`Need ${needPop} popularity to run.`, "bad");
  if (S.res.credits < chest) return toast(`Need ${fmt(chest)} credits for the campaign.`, "bad");
  S.res.credits -= chest; useAction();
  const score = S.pol.popularity + S.pol.legitimacy * 0.3 + repAverage() * 0.2 + Math.random() * 20;
  const opponent = 42 + 12 * lvl + Math.random() * 20;
  if (score > opponent) {
    takeOffice(lvl, "elected");
    applyPolDelta({ legitimacy: 6, popularity: -4 });
    Object.keys(FACTIONS).forEach(f => addRep(f, 1));
    log(`🗳️ You WON the election for <span class="c">${off.name}</span>! (${Math.round(score)}–${Math.round(opponent)})`, "good");
    toast(`Elected ${off.name}!`, "good");
    if (typeof fireworks === "function") fireworks(2000, false);
  } else {
    applyPolDelta({ popularity: -5, heat: 2 });
    log(`🗳️ You lost the election for ${off.name} (${Math.round(score)}–${Math.round(opponent)}); your campaign chest is spent.`, "bad");
    toast("Election lost.", "bad");
  }
  afterAction();
}
function seekAppointment() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needInf = APPOINT_INF[lvl], needRep = APPOINT_REP[lvl], cost = 3000 * lvl;
  const patron = Object.keys(FACTIONS).filter(f => (S.rep[f] || 0) >= needRep).sort((a, b) => (S.rep[b] || 0) - (S.rep[a] || 0))[0];
  if ((S.res.influence || 0) < needInf) return toast(`Need ${needInf} influence.`, "bad");
  if (!patron) return toast(`Need a faction ally at ${needRep}+ reputation to back you.`, "bad");
  if (S.res.credits < cost) return toast(`Need ${fmt(cost)} credits.`, "bad");
  S.res.influence -= needInf; S.res.credits -= cost; useAction();
  takeOffice(lvl, "appointed");
  addRep(patron, 4);
  Object.keys(FACTIONS).forEach(f => { if (f !== patron) addRep(f, -3); });
  applyPolDelta({ heat: 4 });
  log(`🤝 ${FACTIONS[patron].ico} ${FACTIONS[patron].name} installed you as <span class="c">${off.name}</span>.`, "event");
  toast(`Appointed ${off.name}.`, "event");
  afterAction();
}
function stageCoup() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needPmc = COUP_PMC[lvl];
  const pmcTier = (S.orgs.pmc && S.orgs.pmc.tier) || 0, costInf = 20 * lvl, costSlush = 1000 * lvl;
  if (pmcTier < needPmc) return toast(`Need Private Security tier ${needPmc} to seize power.`, "bad");
  if ((S.res.influence || 0) < costInf) return toast(`Need ${costInf} influence.`, "bad");
  if (S.pol.slush < costSlush) return toast(`Need ${fmt(costSlush)} slush to fund the plot.`, "bad");
  S.res.influence -= costInf; S.pol.slush -= costSlush; useAction();
  const chance = Math.min(0.9, 0.35 + pmcTier * 0.12 - lvl * 0.05);
  if (Math.random() < chance) {
    takeOffice(lvl, "seized");
    applyPolDelta({ legitimacy: -25, popularity: -15, heat: 30 });
    Object.keys(FACTIONS).forEach(f => addRep(f, -8));
    log(`⚔️ Your forces SEIZE power — you are <span class="c">${off.name}</span> by force! The factions seethe and investigators take note.`, "bad");
    toast(`Seized ${off.name}!`, "event");
  } else {
    applyPolDelta({ legitimacy: -10, heat: 40 });
    Object.keys(FACTIONS).forEach(f => addRep(f, -6));
    if (S.orgs.pmc) { S.orgs.pmc.tier--; if (S.orgs.pmc.tier <= 0) delete S.orgs.pmc; }
    log(`⚔️ The coup FAILED! Your security is shattered, the factions turn on you, and the heat is blistering.`, "bad");
    toast("Coup failed!", "bad");
  }
  afterAction();
}
function processOffice() {
  if (!S.office || S.office >= 4) return;     // no office, or Consul (life tenure)
  if (S.term > 0) { S.term--; if (S.term > 0) return; } else return;
  const lvl = S.office, off = OFFICES[lvl];
  let keep;
  if (S.officePath === "seized") {
    keep = ((S.orgs.pmc && S.orgs.pmc.tier) || 0) >= COUP_PMC[lvl];   // hold only while armed
  } else {
    keep = (S.pol.popularity + S.pol.legitimacy * 0.3 + repAverage() * 0.2) >= (ELECT_POP[lvl] - 8);
  }
  if (keep) {
    S.term = off.term;
    log(`🗳️ Your mandate as ${off.name} is renewed for another term.`, "good");
  } else {
    S.office = lvl - 1; syncOfficePerks();
    S.term = (S.office >= 1 && OFFICES[S.office]) ? OFFICES[S.office].term : 0;
    applyPolDelta({ popularity: -4 });
    log(`🗳️ Your term as ${off.name} ended and you were not retained — you fall back to ${officeName(S.office)}.`, "bad");
    toast(`Lost office: ${off.name}.`, "bad");
  }
}
function politicalLegacy(path) {
  if (S.legacyTitle) return;
  const P = S.pol;
  let title, blurb;
  if (path === "seized") { title = "The Consul"; blurb = "You seized supreme power by force and rule the sector by decree."; }
  else if (path === "elected" && P.popularity >= 70) { title = "The Demagogue"; blurb = "A landslide of public adoration carried you to absolute power."; }
  else if (P.legitimacy >= 40) { title = "The Statesman"; blurb = "You reached the summit with clean hands and a sterling name."; }
  else if (P.slush > 0 || P.legitimacy < 0) { title = "The Kingpin"; blurb = "You bought and blackmailed your way to the top; the sector is yours in all but name."; }
  else { title = "First Consul"; blurb = "You have ascended to supreme authority over the sector."; }
  S.legacyTitle = title;
  log(`🏛️ POLITICAL LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`POLITICAL LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your political legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — political legacy complete!`, "good");
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
   BLACK MARKET / FENCES — offload plunder off the books
   Syndicate worlds and the lawless rim run fences: no customs, no Wanted,
   a premium on hot (illicit) goods but a haircut on mundane cargo. With
   the navy interdicting you at lawful ports once notorious, this becomes
   the outlaw's main outlet. A fearsome name (Dread) drives a better bargain.
   ============================================================ */
function hasBlackMarket(p) {
  return p.faction === "syndicate" || p.enforce <= 0.3 || !!p.bounty;
}
function isIllicit(c) { return !!COM[c].illegalAt; }   // goods the law bans somewhere = the underworld's trade
function fenceMul(c) {
  const dreadBonus = 1 + (S.pirate ? S.pirate.dread : 0) / 100 * 0.15; // feared captains bargain harder
  return (isIllicit(c) ? 1.35 : 0.80) * dreadBonus;
}
function fencePrice(pid, c) {
  return Math.max(1, Math.round(sellPrice(pid, c) * fenceMul(c)));
}
function fence(c, qty) {
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  const p = currentPlanet();
  if (!hasBlackMarket(p)) return toast("No fence operates here — try a syndicate world or the lawless rim.", "bad");
  if ((S.res[c] || 0) < qty) return toast("You don't have that many.", "bad");
  const slip = tradeSlippage(p, c, qty);
  const revenue = Math.round(fencePrice(S.location, c) * (1 - slip / 2) * qty);
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue;
  applyMarketMove(S.location, c, slip, true);
  addRep("syndicate", 1);
  log(`🕴️ Fenced ${qty} ${COM[c].ico} ${COM[c].name} for <span class="c">${fmt(revenue)}</span> cr — no questions asked.`, "good");
  toast(`Fenced ${qty} ${COM[c].name} (+${fmt(revenue)} cr)`, "good");
  afterAction();
}
function fenceAll(c) {
  if ((S.res[c] || 0) <= 0) return toast(`No ${COM[c].name} to fence.`, "bad");
  fence(c, S.res[c]);
}
function fenceQty(c) { fence(c, +document.getElementById("fq-" + c).value); }
function fenceAllPlunder() {
  const p = currentPlanet();
  if (!hasBlackMarket(p)) return toast("No fence operates here.", "bad");
  const ids = CARGO_IDS.filter(c => (S.res[c] || 0) > 0);
  if (!ids.length) return toast("Your hold is empty.", "bad");
  let total = 0; const parts = [];
  ids.forEach(c => {
    const qty = S.res[c], slip = tradeSlippage(p, c, qty);
    const rev = Math.round(fencePrice(S.location, c) * (1 - slip / 2) * qty);
    S.res[c] = 0; S.res.credits += rev; total += rev; parts.push(`${qty}${COM[c].ico}`);
    applyMarketMove(S.location, c, slip, true);
  });
  S.stats.trades++; S.stats.profit += total; addRep("syndicate", 2);
  log(`🕴️ Dumped your whole hold to the fence — ${parts.join(" ")} for <span class="c">${fmt(total)}</span> cr.`, "good");
  toast(`Fenced everything (+${fmt(total)} cr)`, "good");
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
  if ((S.rep[planet.faction] || 0) >= 60) r *= 0.4;            // allies look the other way
  if (S.perks.senator) r *= 0.85;
  if (S.perks.governor) r *= 0.7;
  if (policyActive("dereg")) r *= 0.55;                          // gutted inspectors
  if (policyActive("martial")) r *= 1.5;                         // troops on the docks
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
  if (S.jail > 0) return toast("You're imprisoned — you can't travel.", "bad");
  if (S.interdiction) return toast("The navy has your ship locked down — settle the confrontation first.", "bad");
  if (S.encounter) return toast("A pirate has you in its sights — pay, run, or fight first.", "bad");
  const dest = PLANETS.find(p => p.id === destId);
  if (!dest || !isVisible(dest)) return toast("That world isn't on your charts.", "bad");
  const cost = fuelCost(destId);
  if (S.res.fuel < cost) return toast(`Not enough fuel (need ${cost}).`, "bad");
  S.res.fuel -= cost; S.location = destId; S.visited[destId] = true; S.stats.jumps++;
  log(`Jumped to <span class="c">${dest.name}</span> (−${cost} ⛽).`, "event");
  toast(`Arrived at ${dest.name}`, "event");
  scanOnArrival(dest);
  maybeAmbush(dest);
  if (!S.encounter) maybeInterdict(dest);
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
   PLAYER BASES
   ============================================================ */
function baseStorageCap(pid) {
  const b = S.bases[pid];
  if (!b) return 0;
  return BASE_BASE_STORAGE + (b.modules.warehouse || 0) * 250;
}
function baseStorageUsed(b) { return Object.values(b.storage).reduce((s, q) => s + q, 0); }

function matsString(mats) {
  return Object.entries(mats).map(([c, q]) =>
    `<span style="color:${(S.res[c] || 0) >= q ? "inherit" : "var(--bad)"}">${q}${COM[c].ico}</span>`).join(" ");
}
function buildBase() {
  const pid = S.location;
  if (S.bases[pid]) return;
  const mats = BASE_FOUNDATION_MATS;
  if (S.res.credits < BASE_FOUNDATION_COST) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need build materials in your hold (metals).", "bad");
  S.res.credits -= BASE_FOUNDATION_COST; pay(mats);
  S.bases[pid] = { modules: {}, storage: {} };
  log(`🏗️ Established a base on <span class="c">${currentPlanet().name}</span>.`, "event");
  toast("Base established!", "event");
  afterAction();
}
function buildModule(moduleId) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  const planet = currentPlanet();
  const def = baseModuleList(planet).find(m => m.id === moduleId);
  if (!def) return;
  const tier = b.modules[moduleId] || 0;
  if (tier >= def.tiers) return;
  const cost = Math.round(def.baseCost * Math.pow(def.costMul, tier));
  const mats = moduleMats(def, tier + 1);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => COM[c].name).join(", ") + ".", "bad");
  S.res.credits -= cost; pay(mats);
  b.modules[moduleId] = tier + 1;
  log(`Built ${def.ico} ${def.name} (Tier ${tier + 1}) on ${planet.name}.`, "good");
  toast(`${def.name} → Tier ${tier + 1}`, "good");
  afterAction();
}

/* logistics — move cargo between ship and the base on the current planet */
function transferToBase(c, qty) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  qty = Math.min(Math.max(0, Math.floor(qty)), S.res[c] || 0);
  if (qty <= 0) return;
  qty = Math.min(qty, baseStorageCap(pid) - baseStorageUsed(b));
  if (qty <= 0) return toast("Base storage is full.", "bad");
  S.res[c] -= qty; b.storage[c] = (b.storage[c] || 0) + qty;
  log(`Stored ${qty} ${COM[c].ico} ${COM[c].name} at ${currentPlanet().name} base.`);
  afterAction();
}
function transferFromBase(c, qty) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  qty = Math.min(Math.max(0, Math.floor(qty)), b.storage[c] || 0);
  if (qty <= 0) return;
  qty = Math.min(qty, cargoFree());
  if (qty <= 0) return toast("Cargo hold is full.", "bad");
  b.storage[c] -= qty; S.res[c] += qty;
  log(`Withdrew ${qty} ${COM[c].ico} ${COM[c].name} from ${currentPlanet().name} base.`);
  afterAction();
}
function storeAllCargo() {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  let room = baseStorageCap(pid) - baseStorageUsed(b), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.res[c] || 0, room);
    if (q > 0) { S.res[c] -= q; b.storage[c] = (b.storage[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`Stored ${moved} units of cargo at ${currentPlanet().name} base.`); afterAction(); }
  else toast("Nothing to store (or base full).", "bad");
}
function depositQty(c) { transferToBase(c, +document.getElementById("xfer-" + c).value); }
function withdrawQty(c) { transferFromBase(c, +document.getElementById("xfer-" + c).value); }

/* runs every cycle (including while you travel) */
function processBases() {
  const summary = {};
  Object.entries(S.bases).forEach(([pid, b]) => {
    const planet = PLANETS.find(p => p.id === pid);
    const cap = baseStorageCap(pid);
    baseModuleList(planet).forEach(mod => {
      const out = moduleOutput(planet, mod, b.modules[mod.id] || 0);
      if (out <= 0) return;
      const add = Math.min(out, cap - baseStorageUsed(b));
      if (add > 0) {
        b.storage[mod.produces] = (b.storage[mod.produces] || 0) + add;
        summary[mod.produces] = (summary[mod.produces] || 0) + add;
      }
    });
  });
  const keys = Object.keys(summary);
  if (keys.length) log(`🏗️ Your bases produced ${keys.map(c => summary[c] + COM[c].ico).join(" ")}.`, "good");
}

/* ============================================================
   RANDOM CONTRACTS  (time-bounded, faction-posted)
   ============================================================ */
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/* what each faction asks you to supply */
const FACTION_WANTS = {
  core:      ["goods", "machinery", "medicine", "electronics"],
  miners:    ["ore", "metals", "alloys", "energy"],
  agri:      ["biomass", "spice", "chemicals", "medicine"],
  syndicate: ["crystals", "electronics", "luxury", "machinery"],
  frontier:  ["fuel", "metals", "weapons", "relics"],
};
const STANDINGS = [
  { min: 60,  label: "Allied",   cls: "good" },
  { min: 25,  label: "Friendly", cls: "good" },
  { min: -24, label: "Neutral",  cls: "" },
  { min: -59, label: "Disliked", cls: "bad" },
  { min: -100,label: "Hostile",  cls: "bad" },
];
function standing(f) { const r = S.rep[f] || 0; return STANDINGS.find(s => r >= s.min); }

function genContract() {
  const reachable = PLANETS.filter(isVisible);              // only worlds in play this game
  const f = pick([...new Set(reachable.map(p => p.faction))]);
  const homeworlds = reachable.filter(p => p.faction === f);
  const planet = pick(homeworlds);
  let commodity, kind = "supply";
  if (f === "frontier" && Math.random() < 0.5) { commodity = pick(["relics", "weapons"]); kind = "smuggle"; }
  else commodity = pick(FACTION_WANTS[f]);
  const qty = 10 + Math.floor(Math.random() * 26);                 // 10–35
  const premium = (kind === "smuggle" ? 1.7 : 1.35) + Math.random() * 0.35;
  const reward = { credits: Math.round(qty * COM[commodity].base * premium) + 200,
                   rep: { [f]: 6 + Math.floor(Math.random() * 12) },
                   influence: 2 + Math.floor(Math.random() * 5) };
  if (kind === "smuggle") { reward.rep.core = -(5 + Math.floor(Math.random() * 8)); reward.influence += 3; }
  const duration = 6 + Math.floor(Math.random() * 9);             // expires in 6–14 cycles
  return { id: "c" + (++S.contractSeq), kind, faction: f, planetId: planet.id,
           commodity, qty, reward, deadline: S.turn + duration, posted: S.turn };
}
function maybeGenContract() {
  if (S.contracts.length < 6 && Math.random() < 0.55) {
    const c = genContract();
    S.contracts.push(c);
    log(`📋 New ${c.kind === "smuggle" ? "smuggling job" : "contract"} posted by ${FACTIONS[c.faction].ico} ${FACTIONS[c.faction].name}: ${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name} to ${PLANETS.find(p => p.id === c.planetId).name} (${c.deadline - S.turn} cycles).`, "event");
  }
}
function expireContracts() {
  S.contracts = S.contracts.filter(c => {
    if (S.turn > c.deadline) {
      addRep(c.faction, -5);
      log(`📋 Contract expired — ${FACTIONS[c.faction].name} wanted ${c.qty} ${COM[c.commodity].name} (−5 rep).`, "bad");
      return false;
    }
    return true;
  });
}
function fulfilContract(id) {
  const i = S.contracts.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = S.contracts[i];
  const dest = PLANETS.find(p => p.id === c.planetId);
  if (S.location !== c.planetId) return toast(`Deliver at ${dest.name}.`, "bad");
  if ((S.res[c.commodity] || 0) < c.qty) return toast(`Need ${c.qty} ${COM[c.commodity].name}.`, "bad");
  S.res[c.commodity] -= c.qty;
  gain(c.reward);
  S.contracts.splice(i, 1);
  log(`📋 Contract fulfilled — delivered ${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name} to ${FACTIONS[c.faction].name}.`, "event");
  toast("Contract complete!", "event");
  afterAction();
}

/* ============================================================
   COLONIES  (full development: population, happiness, tax, buildings)
   ============================================================ */
function colonyHousing(col, planet) {
  let h = 14;
  colonyBuildingList(planet).forEach(b => { if (b.housing) h += b.housing(col.buildings[b.id] || 0); });
  return h;
}
function colonyStorageUsed(col) { return Object.values(col.storage).reduce((s, q) => s + q, 0); }
function colonyStorageCap(col, planet) {
  let cap = 300;
  cap += (col.buildings.spaceport || 0) * 200;
  cap += (col.buildings.habitat || 0) * 60;
  return cap;
}
function colonyTaxIncome(col) {
  return Math.round(col.pop * (col.tax / 100) * 5 * (col.happiness / 100));
}
function colonyDefense(col) { return col.buildings.garrison || 0; }

/* one risk/boom roll per colony per cycle — returns true if the colony seceded */
function colonyEventRoll(pid, col, planet) {
  const name = planet.name, def = colonyDefense(col);
  const roll = Math.random();

  // ---- Pirate raid (frontier worlds are exposed; hunting pirates buys calm) ----
  if (roll < 0.07) {
    if (pirateCalm()) {
      log(`🛡️ Pirates kept clear of <span class="c">${name}</span> — your bounty hunting has them lying low.`, "good");
      return false;
    }
    if (def > 0 && Math.random() < def * 0.30) {
      col.happiness = Math.min(100, col.happiness + 4);
      log(`🛡️ ${name}'s garrison repelled a pirate raid.`, "good");
      return false;
    }
    let lootLog = [];
    Object.keys(col.storage).forEach(c => {
      const take = Math.floor((col.storage[c] || 0) * 0.25);
      if (take > 0) { col.storage[c] -= take; lootLog.push(`${take} ${COM[c].ico}`); }
    });
    const credLoss = Math.min(S.res.credits, col.pop * 8);
    S.res.credits -= credLoss;
    col.happiness = Math.max(0, col.happiness - 12);
    log(`🏴‍☠️ Pirates raided <span class="c">${name}</span>! Lost ${lootLog.join(" ") || "no goods"} and ${fmt(credLoss)} credits.`, "bad");
    toast(`${name} raided!`, "bad");
    announce(`🏴‍☠️ ${name} Raided`, `Pirates struck your colony. Build a 🛡️ Garrison to defend it.`, true);
    return false;
  }

  // ---- Natural disaster (type depends on the world) ----
  if (roll < 0.12) {
    const volcanic = /Volcanic|Shattered/.test(planet.tag);
    const verdant = (planet.deposits.biomass || 0) >= 1.3;
    if (volcanic) {
      const built = Object.keys(col.buildings).filter(b => col.buildings[b] > 0);
      const hit = built[Math.floor(Math.random() * built.length)];
      if (hit) col.buildings[hit]--;
      col.pop = Math.max(1, col.pop - 2);
      log(`🌋 A violent eruption shook <span class="c">${name}</span>${hit ? ` — its ${colonyBuildingList(planet).find(b => b.id === hit).name} was damaged` : ""}.`, "bad");
    } else if (verdant) {
      const lost = Math.max(1, Math.round(col.pop * 0.15));
      col.pop = Math.max(1, col.pop - lost);
      col.happiness = Math.max(0, col.happiness - 8);
      log(`🦠 A plague swept <span class="c">${name}</span> — ${lost}k lost.`, "bad");
    } else {
      col.storage.biomass = 0;
      col.happiness = Math.max(0, col.happiness - 6);
      log(`🥀 Crop blight ruined ${name}'s food stores.`, "bad");
    }
    toast(`Disaster on ${name}`, "bad");
    return false;
  }

  // ---- Boom (good fortune) ----
  if (roll < 0.16) {
    if (Math.random() < 0.5) {
      const inflow = Math.max(1, Math.round(col.pop * 0.12));
      col.pop += inflow;
      log(`✨ A wave of migrants settled on <span class="c">${name}</span> (+${inflow}k).`, "good");
    } else {
      const windfall = col.pop * 20 + 200;
      S.res.credits += windfall;
      col.happiness = Math.min(100, col.happiness + 5);
      log(`✨ A trade boom enriched <span class="c">${name}</span> (+${fmt(windfall)} credits).`, "good");
    }
    return false;
  }
  return false;
}

function canColonize() { return !!S.techs.colonial; }
function colonize() {
  const pid = S.location, planet = currentPlanet();
  if (!canColonize()) return toast("Research Colonial Charter first.", "bad");
  if (!planet.colonizable) return toast("This world cannot be colonized.", "bad");
  if (S.colonies[pid]) return;
  if (S.res.credits < COLONY_FOUNDATION_COST) return toast("Not enough credits.", "bad");
  if (!canAfford(COLONY_FOUNDATION_MATS)) return toast("Need materials in your hold: metals & goods.", "bad");
  S.res.credits -= COLONY_FOUNDATION_COST; pay(COLONY_FOUNDATION_MATS);
  S.colonies[pid] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0 };
  log(`🌍 Founded a colony on <span class="c">${planet.name}</span>! It will grow as you develop it.`, "event");
  toast("Colony founded!", "event");
  afterAction();
}
function buildColonyBuilding(buildingId) {
  const pid = S.location, col = S.colonies[pid];
  if (!col) return;
  const planet = currentPlanet();
  const def = colonyBuildingList(planet).find(b => b.id === buildingId);
  if (!def) return;
  if (def.req && !S.techs[def.req]) return toast(`Requires the ${(TECHS.find(t => t.id === def.req) || {}).name || def.req} technology.`, "bad");
  const tier = col.buildings[buildingId] || 0;
  if (tier >= def.tiers) return;
  const cost = Math.round(def.baseCost * Math.pow(def.costMul, tier));
  const mats = colonyBuildingMats(def, tier + 1);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => COM[c].name).join(", ") + ".", "bad");
  S.res.credits -= cost; pay(mats);
  col.buildings[buildingId] = tier + 1;
  log(`Built ${def.ico} ${def.name} (Tier ${tier + 1}) on ${planet.name}.`, "good");
  toast(`${def.name} → Tier ${tier + 1}`, "good");
  afterAction();
}
function setTax(delta) {
  const col = S.colonies[S.location];
  if (!col) return;
  col.tax = Math.max(0, Math.min(50, col.tax + delta));
  afterAction();
}
function colonyDeposit(c) {
  const col = S.colonies[S.location];
  if (!col) return;
  let qty = Math.min(+document.getElementById("col-" + c).value || 0, S.res[c] || 0);
  qty = Math.floor(Math.max(0, qty));
  qty = Math.min(qty, colonyStorageCap(col, currentPlanet()) - colonyStorageUsed(col));
  if (qty <= 0) return toast("Nothing to store (or colony full).", "bad");
  S.res[c] -= qty; col.storage[c] = (col.storage[c] || 0) + qty;
  log(`Delivered ${qty} ${COM[c].ico} ${COM[c].name} to ${currentPlanet().name} colony.`);
  afterAction();
}
function colonyWithdraw(c) {
  const col = S.colonies[S.location];
  if (!col) return;
  let qty = Math.min(+document.getElementById("col-" + c).value || 0, col.storage[c] || 0);
  qty = Math.floor(Math.max(0, Math.min(qty, cargoFree())));
  if (qty <= 0) return toast("Nothing to withdraw (or hold full).", "bad");
  col.storage[c] -= qty; S.res[c] += qty;
  log(`Withdrew ${qty} ${COM[c].ico} ${COM[c].name} from ${currentPlanet().name} colony.`);
  afterAction();
}

/* runs every cycle — colonies live and grow on their own */
function processColonies() {
  const seceded = [];
  Object.entries(S.colonies).forEach(([pid, col]) => {
    const planet = PLANETS.find(p => p.id === pid);
    const cap = colonyStorageCap(col, planet);
    const store = (c, q) => { const add = Math.min(q, cap - colonyStorageUsed(col)); if (add > 0) col.storage[c] = (col.storage[c] || 0) + add; };
    let foodMade = 0;   // net food (biomass) produced this cycle — sets the colony's carrying capacity

    // 1a) raw producers (farm, extractors) + passive research run first
    colonyBuildingList(planet).forEach(b => {
      const t = col.buildings[b.id] || 0; if (t <= 0) return;
      if (b.id === "lab") { S.res.tech += t * 3; return; }                 // passive research
      if (b.id === "scrubber") { if (S.pollution && S.pollution[pid]) S.pollution[pid] = Math.max(0, S.pollution[pid] - t * 1.2); return; }
      if (b.recipe) return;                                               // industry chain handled in 1b
      if (b.produces) {
        let out;
        if (b.id === "farm") out = Math.round(t * 8 * pollutionFarmMult(pid));   // smog & climate wither crops
        else {
          out = Math.round(t * 5 * (planet.deposits[b.produces] || 1) * depletionMult(pid, b.produces) * pollutionYieldMult(pid));
          drawReserve(pid, b.produces, out);
          if (out > 0 && b.pollute) addPollution(pid, b.pollute * t);
        }
        if (b.produces === COLONY_FOOD) foodMade += out;
        const ceiling = b.produces === COLONY_FOOD
          ? Math.max(Math.floor(cap * 0.4), col.pop * 3)                   // always room to stockpile food for the population
          : Math.floor(cap * 0.15);                                       // other sources self-limit so by-products can't clog the chain
        store(b.produces, Math.min(out, Math.max(0, ceiling - (col.storage[b.produces] || 0))));
      }
    });
    // 1b) industry chain in dependency order (power → refining → components → assembly),
    //     so a full ore→metals→alloys→goods line can cascade within a single cycle
    colonyBuildingList(planet).filter(b => b.recipe).sort((a, b) => a.recipe.stage - b.recipe.stage).forEach(b => {
      const t = col.buildings[b.id] || 0; if (t <= 0) return;
      const r = b.recipe;
      let batches = t * r.rate;                                            // throughput scales with tier
      Object.entries(r.in).forEach(([c, q]) => { batches = Math.min(batches, Math.floor((col.storage[c] || 0) / q)); });
      const net = r.outQty - Object.values(r.in).reduce((s, q) => s + q, 0); // only net growth needs free space
      if (net > 0) batches = Math.min(batches, Math.floor((cap - colonyStorageUsed(col)) / net));
      if (batches <= 0) return;
      Object.entries(r.in).forEach(([c, q]) => { col.storage[c] -= batches * q; });
      if (r.in[COLONY_FOOD]) foodMade -= batches * r.in[COLONY_FOOD];      // food burned by industry can't feed people
      store(r.out, batches * r.outQty);
      if (b.pollute) addPollution(pid, b.pollute * t);                     // industry fouls the world it runs on
      // fission flavor: a hard-run reactor can suffer a containment scare
      if (b.id === "reactor" && Math.random() < 0.012 * t) {
        col.storage.energy = Math.floor((col.storage.energy || 0) * 0.4);
        col.happiness = Math.max(0, col.happiness - 10);
        log(`☢️ A containment scare at <span class="c">${planet.name}</span>'s reactor vented power and rattled the colony.`, "bad");
      }
    });
    // surplus Energy is vented to the grid, never hoarded — keeps storage clear for materials
    const ENERGY_BUFFER = 120;
    if ((col.storage.energy || 0) > ENERGY_BUFFER) col.storage.energy = ENERGY_BUFFER;

    // 2) population eats food (biomass)
    const need = col.pop;
    const have = col.storage[COLONY_FOOD] || 0;
    const eaten = Math.min(need, have);
    col.storage[COLONY_FOOD] = have - eaten;
    const fed = eaten >= need;

    // 3) happiness drifts toward a target
    let target = 55;
    target += fed ? 18 : -35;
    if ((col.storage.goods || 0) >= col.pop) target += 12;     // consumer goods keep folk happy
    if ((col.storage.luxury || 0) > 0) target += 6;
    if ((col.storage.medicine || 0) > 0) target += 6;          // healthcare keeps colonists well
    target -= col.tax * 0.8;
    target -= pollutionOf(pid) * 0.12;                         // nobody loves living in smog
    target = Math.max(0, Math.min(100, target));
    col.happiness = Math.round(col.happiness + (target - col.happiness) * 0.34);

    // 4) population tracks its food supply gracefully — grow only into genuine local
    //    food surplus (never overshoot), and emigrate rather than collapse when food falls short
    const housing = colonyHousing(col, planet);
    const carrying = Math.min(housing, foodMade);              // people the local harvest can sustain
    if (fed && col.happiness >= 60 && col.pop < carrying) {
      col.pop += Math.max(1, Math.round(col.pop * 0.05));      // room to grow: spare food AND housing
    } else if (!fed) {
      col.pop = Math.max(1, col.pop - Math.max(1, Math.round((need - eaten) * 0.3))); // shortfall → gentle emigration
    } else if (col.happiness < 32) {
      col.pop = Math.max(1, col.pop - 1);                      // misery slowly drives folk away
    }
    col.pop = Math.min(col.pop, housing);

    // 5) tax income
    const income = colonyTaxIncome(col);
    if (income > 0) S.res.credits += income;

    // 5b) the spaceport exports surplus manufactured goods for credits (keeping happiness reserves)
    const sp = spaceportTier(col);
    if (sp > 0) {
      const reserve = { goods: col.pop, luxury: Math.ceil(col.pop / 3), medicine: Math.ceil(col.pop / 3) };
      const exportable = CARGO_IDS                                  // only finished products — intermediates stay for the chain
        .filter(c => ["Finished", "Luxury", "Strategic"].includes(COM[c].tier) || c === "medicine")
        .sort((a, b) => COM[b].base - COM[a].base);                 // ship the dearest goods first
      let throughput = sp * 6, revenue = 0;
      for (const c of exportable) {
        if (throughput <= 0) break;
        const avail = (col.storage[c] || 0) - (reserve[c] || 0);
        const q = Math.min(Math.max(0, avail), throughput);
        if (q > 0) { col.storage[c] -= q; revenue += Math.round(sellPrice(pid, c) * 0.85 * q); throughput -= q; }
      }
      if (revenue > 0) {
        S.res.credits += revenue; col._exp = (col._exp || 0) + revenue;
        if (S.turn % 4 === 0) { log(`🛰️ <span class="c">${planet.name}</span>'s spaceport exported manufactured goods (+${fmt(col._exp)} cr).`, "good"); col._exp = 0; }
      }
    }

    // 6) random events (raids, disasters, booms)
    colonyEventRoll(pid, col, planet);

    // 6b) heavy pollution breeds industrial incidents
    const poll = pollutionOf(pid);
    if (poll >= 50 && Math.random() < (poll - 40) / 250) {
      col.happiness = Math.max(0, col.happiness - 8);
      const spoiled = Math.floor((col.storage[COLONY_FOOD] || 0) * 0.3);
      if (spoiled > 0) col.storage[COLONY_FOOD] -= spoiled;
      log(`🏭 Industrial smog incident on <span class="c">${planet.name}</span> — crops spoiled and tempers frayed.`, "bad");
    }

    // 7) unrest & secession — a garrison helps keep order
    col.unrest = col.unrest || 0;
    if (col.happiness < 25) col.unrest += 1;
    else if (col.happiness > 45) col.unrest = Math.max(0, col.unrest - 1);
    const revoltAt = 4 + colonyDefense(col);            // garrison delays secession
    if (col.unrest >= revoltAt) {
      seceded.push(pid);
    } else if (col.unrest >= 2) {
      log(`⚠️ Unrest is rising on <span class="c">${planet.name}</span> — its people may secede if conditions don't improve.`, "bad");
    }
    col.pop = Math.max(1, Math.round(col.pop));
  });
  seceded.forEach(pid => {
    const planet = PLANETS.find(p => p.id === pid);
    delete S.colonies[pid];
    log(`💔 The colony on <span class="c">${planet.name}</span> has revolted and declared independence. It is lost.`, "bad");
    toast(`${planet.name} seceded!`, "bad");
    announce(`💔 ${planet.name} Lost`, `Your colony revolted and broke away. Keep your people fed and happy to hold your worlds.`, true);
  });
}

/* ============================================================
   LOGISTICS NETWORK  (automated colony supply via Spaceports)
   ============================================================ */
const COLONY_SUPPLY = ["biomass", "energy", "alloys", "medicine", "goods", "luxury"];
function spaceportTier(col) { return col.buildings.spaceport || 0; }
function colonyNetworked(col) { return spaceportTier(col) > 0; }
function logisticsFee(col) { return Math.max(0.10, 0.30 - spaceportTier(col) * 0.05); }
function logisticsCap(col) { return spaceportTier(col) * 40; }  // throughput per commodity per cycle

function setOrder(c) {
  const col = S.colonies[S.location];
  if (!col) return;
  if (!colonyNetworked(col)) return toast("Build a Spaceport to enable logistics.", "bad");
  col.orders = col.orders || {};
  col.orders[c] = Math.max(0, Math.floor(+document.getElementById("auto-" + c).value || 0));
  toast(`Auto-supply ${COM[c].name}: keep ${fmt(col.orders[c])}`, "good");
  afterAction();
}

/* runs each cycle before colonies consume — keeps ordered stock topped up */
function processLogistics() {
  // pirate convoy ambush: an active logistics network draws raiders unless the lanes are calm
  if (!pirateCalm()) {
    const nets0 = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c) && c.orders && Object.keys(c.orders).length);
    if (nets0.length) {
      const threat = PLANETS.reduce((s2, p) => s2 + pirateLevel(p.id), 0) / PLANETS.length;
      if (Math.random() < 0.04 + threat * 0.03) {
        const [vid, vcol] = nets0[Math.floor(Math.random() * nets0.length)];
        const vp = PLANETS.find(p => p.id === vid);
        const loss = Math.min(S.res.credits, 200 + Math.round(threat * 400));
        S.res.credits -= loss;
        Object.keys(vcol.storage).slice(0, 2).forEach(c => { vcol.storage[c] = Math.floor((vcol.storage[c] || 0) * 0.85); });
        log(`🏴‍☠️ Pirates ambushed a supply convoy near <span class="c">${vp.name}</span> — ${fmt(loss)} cr and cargo lost. Hunt them down to calm the lanes.`, "bad");
      }
    }
  }
  const nets = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c) && c.orders && Object.keys(c.orders).length);
  if (!nets.length) return;
  const used = {};
  nets.forEach(([id]) => { used[id] = {}; COLONY_SUPPLY.forEach(c => used[id][c] = 0); });
  let spent = 0, moved = false;

  COLONY_SUPPLY.forEach(c => {
    const parties = nets.map(([id, col]) => ({ id, col, planet: PLANETS.find(p => p.id === id) }));
    const receivers = parties.filter(p => (p.col.orders[c] || 0) > (p.col.storage[c] || 0));
    if (!receivers.length) return;
    const donors = parties.filter(p => (p.col.storage[c] || 0) > (p.col.orders[c] || 0));

    // 1) free redistribution from surplus colonies
    receivers.forEach(r => {
      let need = (r.col.orders[c] || 0) - (r.col.storage[c] || 0);
      need = Math.min(need, logisticsCap(r.col) - used[r.id][c], colonyStorageCap(r.col, r.planet) - colonyStorageUsed(r.col));
      for (const d of donors) {
        if (need <= 0) break;
        if (d.id === r.id) continue;
        let avail = (d.col.storage[c] || 0) - (d.col.orders[c] || 0);
        avail = Math.min(avail, logisticsCap(d.col) - used[d.id][c]);
        const move = Math.max(0, Math.min(need, avail));
        if (move > 0) {
          d.col.storage[c] -= move; r.col.storage[c] = (r.col.storage[c] || 0) + move;
          used[d.id][c] += move; used[r.id][c] += move; need -= move; moved = true;
        }
      }
    });

    // 2) buy any remaining deficit from market (+ logistics fee)
    receivers.forEach(r => {
      let need = (r.col.orders[c] || 0) - (r.col.storage[c] || 0);
      need = Math.min(need, logisticsCap(r.col) - used[r.id][c], colonyStorageCap(r.col, r.planet) - colonyStorageUsed(r.col));
      if (need <= 0) return;
      const unit = Math.round(buyPrice(r.id, c) * (1 + logisticsFee(r.col)));
      const qty = Math.max(0, Math.min(need, Math.floor(S.res.credits / unit)));
      if (qty > 0) {
        S.res.credits -= qty * unit; r.col.storage[c] = (r.col.storage[c] || 0) + qty;
        used[r.id][c] += qty; spent += qty * unit; moved = true;
      }
    });
  });

  if (spent > 0) log(`🚚 Logistics network imported supplies for <span class="c">${fmt(spent)}</span> credits.`, "");
  else if (moved) log(`🚚 Logistics network redistributed supplies between your colonies.`, "");
}

/* ============================================================
   EXPLORATION  (discover hidden worlds)
   ============================================================ */
function isVisible(p) { return isActive(p) && (!p.hidden || S.discovered[p.id]); }
function undiscoveredHidden() {
  return PLANETS.filter(p => p.hidden && !S.discovered[p.id]).sort((a, b) => a.x - b.x);
}
function explore() {
  if (!canColonize()) return toast("Research Colonial Charter to run deep-space surveys.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const pool = undiscoveredHidden();
  if (!pool.length) return toast("No uncharted worlds remain.", "bad");
  useAction();
  const sensors = 0.45 + S.upgrades.lab * 0.06;   // research lab doubles as long-range sensors
  if (Math.random() < sensors) {
    const w = pool[0];
    S.discovered[w.id] = true;
    log(`🛰️ Deep-space survey discovered a new world: <span class="c">${w.name}</span> (${w.tag})!`, "event");
    toast(`Discovered ${w.name}!`, "event");
    announce(`🛰️ ${w.name} Discovered`, `${w.tag} — a new world to chart and colonize.`, false);
    fireworks(2200, false);
  } else {
    log("🛰️ Survey swept the dark and found nothing… this time.", "");
    toast("Survey found nothing.", "");
  }
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
  if (S.jail > 0) { S.jail--; log(`⛓️ You serve a cycle in detention (${S.jail} remaining).`, "bad"); }
  processCrises(); processPirates(); rollPrices(); processReserves(); processPollution(); applyDecreeIncome(); applyPolicyEffects(); processPlanetLaws(); processOrgs(); processInvestigation(); processOffice(); processWanted(); processHaven(); processCommission(); processBases(); processLogistics(); processColonies(); expireContracts(); maybeGenContract(); maybeEvent();
  if (!fromTravel) log(`— Cycle ${S.turn} begins —`);
  checkWin(); saveGame(); renderAll();
}

/* ============================================================
   WIN CONDITION
   ============================================================ */
function netWorth() {
  let w = S.res.credits + S.res.fuel * COM.fuel.base;
  CARGO_IDS.forEach(c => w += S.res[c] * COM[c].base);
  Object.values(S.bases).forEach(b =>
    Object.entries(b.storage).forEach(([c, q]) => { w += q * COM[c].base; }));
  Object.values(S.colonies).forEach(col => {
    Object.entries(col.storage).forEach(([c, q]) => { w += q * COM[c].base; });
    w += col.pop * 400;   // a populated colony is itself a major asset
  });
  return Math.round(w);
}
const OBJECTIVE_META = {
  worth:     { emoji: "💰", title: "Tycoon",           sub: "Net worth has passed 75,000 credits!" },
  terraform: { emoji: "🌍", title: "Master Scientist", sub: "Terraforming researched — you can reshape worlds!" },
  governor:  { emoji: "👑", title: "Sector Governor",  sub: "You now rule the entire sector!" },
  explored:  { emoji: "🧭", title: "Master Explorer",  sub: "Every core world in the sector has been charted!" },
  colony:    { emoji: "🏙️", title: "Colonial Founder", sub: "A frontier colony has grown into a thriving capital!" },
};
function winProgress() {
  return {
    worth:     { have: netWorth() >= 75000,                  label: "Amass 75,000 credits net worth" },
    terraform: { have: !!S.techs.terraform,                  label: "Research Terraforming" },
    governor:  { have: !!S.perks.governor,                   label: "Become Sector Governor" },
    explored:  { have: CORE_PLANETS.filter(isActive).every(p => S.visited[p.id]), label: `Visit all ${activeCoreTotal()} core worlds` },
    colony:    { have: Object.values(S.colonies).some(c => c.pop >= 25), label: "Grow a colony to 25k population" },
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
  jot(`Objective reached: ${m.title} — ${m.sub}`, "milestone");
    }
  });
  if (!S.won && Object.values(wp).every(x => x.have)) {
    S.won = true;
    log("🏆 LEGACY COMPLETE — You have shaped the destiny of the sector!", "good");
  jot("LEGACY COMPLETE — you have shaped the destiny of the sector.", "legacy");
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
     ${(S.pirate && S.pirate.hull < HULL_MAX) ? `<div class="ship-stat" style="margin-top:6px"><span class="k">Hull</span><span class="v" style="color:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}">${S.pirate.hull}/${HULL_MAX}</span></div>
     <div class="bar"><span style="width:${S.pirate.hull}%;background:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}"></span></div>` : ""}
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
  const st = standing(f);
  return `<div class="ship-stat"><span class="k">${FACTIONS[f].ico} ${FACTIONS[f].name}</span>
      <span class="v"><span class="pill ${st.cls}">${st.label}</span> <span style="color:${col}">${r>0?"+":""}${r}</span></span></div>
    <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}

/* ----- Galaxy ----- */
function renderGalaxy() {
  const el = document.getElementById("panel-galaxy");
  const cards = PLANETS.filter(isVisible).map(p => {
    const here = p.id === S.location;
    const fc = here ? 0 : fuelCost(p.id);
    const canGo = !here && S.res.fuel >= fc;
    const deps = Object.keys(p.deposits || {}).map(c => COM[c].ico).join(" ")
      + (p.salvage ? " 🧲" : "") + (p.bounty ? " 🎯" : "");
    const enf = p.enforce > 0.7 ? '<span class="pill bad">strict law</span>'
      : p.enforce < 0.25 ? '<span class="pill good">lawless</span>' : '<span class="pill">patrolled</span>';
    const pol = pollutionOf(p.id);
    const polPill = pol >= 60 ? '<span class="pill bad" title="Heavy industrial pollution">☁️ fouled</span>'
      : pol >= 25 ? '<span class="pill" title="Rising industrial pollution">☁️ smoggy</span>' : '';
    const _cr = S.crises && S.crises[p.id];
    const crisisPill = _cr ? `<span class="pill bad" title="${CRISES[_cr.type].name} — prices spiking, ${_cr.cyclesLeft} cyc left">${CRISES[_cr.type].ico} ${CRISES[_cr.type].name}</span>` : '';
    const tag = p.colonizable
      ? `<span class="pill good">${S.colonies[p.id] ? "your colony 🌍" : "colonizable"}</span>`
      : `${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}`;
    return `<div class="planet-card ${here ? "current" : ""}">
      <div class="planet-orb" style="background:radial-gradient(circle at 35% 30%, ${p.color}, #000 130%)"></div>
      <div class="planet-name">${p.name} ${S.visited[p.id] ? "" : '<span class="badge">unknown</span>'}</div>
      <div class="planet-tag">${p.tag} · ${tag}</div>
      <div class="planet-desc">${p.desc}</div>
      <div class="planet-levels">
        <span class="lvl-chip">🏭 Ind ${effIndustry(p)}</span>
        <span class="lvl-chip">🔬 Tech ${effTech(p)}</span>
        ${enf}${polPill}${crisisPill}
      </div>
      <div class="hint" style="margin-bottom:8px">Extract: ${deps || "—"}</div>
      ${here ? `<div class="pill good">◉ You are here</div>`
        : `<div class="row"><button class="btn btn-primary" ${canGo ? "" : "disabled"} onclick="travel('${p.id}')">Travel ▸</button>
            <span class="distance">⛽ ${fc} · ${currentPlanet().distances[p.id]} ly</span></div>`}
    </div>`;
  }).join("");
  const unknownCount = undiscoveredHidden().length;
  const survey = canColonize() ? `<div class="card">
    <h4>🛰️ Deep-Space Survey</h4>
    <div class="desc">Scan the dark for uncharted worlds to chart and colonize. ${unknownCount ? unknownCount + " world(s) still hidden." : "All worlds discovered."} A Research Lab improves your sensors.</div>
    <button class="btn btn-primary" ${unknownCount && actionsLeft() > 0 ? "" : "disabled"} onclick="explore()">Survey (1 action)</button>
  </div>` : `<div class="card">
    <h4>🛰️ Deep-Space Survey <span class="pill bad">locked</span></h4>
    <div class="desc">Uncharted worlds lie beyond the dark. Research <b>Colonial Charter</b> (in the Research tab) to build the sensors and authority to chart and settle them.</div>
  </div>`;
  const nCrises = S.crises ? Object.keys(S.crises).length : 0;
  const crisisBadge = nCrises ? `<span class="pill bad" title="Worlds in crisis — relief needed, prices spiking">🆘 ${nCrises} in crisis</span>` : "";
  const cl = Math.round(S.climate || 0);
  const climateBadge = cl >= 40 ? `<span class="pill bad" title="Sector-wide climate stress from industrial pollution">🌡️ climate stress ${cl}</span>`
    : cl >= 12 ? `<span class="pill" title="Sector-wide climate stress from industrial pollution">🌡️ climate ${cl}</span>` : "";
  el.innerHTML = `<h2>Galactic Map ${crisisBadge}${climateBadge}</h2>
    <div class="subtitle">A random ${activeCoreTotal()} of 15 core worlds feature this game, so every run charts a different sector. Each world has its own resources, industry, laws and faction; extraction is bound to where the resource exists — and every deposit is finite: strip a world and yields fall, prices climb, and the region feels it. Industry breeds <b>pollution</b>; the sector's aggregate drives <b>climate stress</b> that withers farms everywhere. Frontier worlds marked <span class="pill good">colonizable</span> are fresh: full reserves, clean skies. Travelling costs fuel and advances a cycle.</div>
    <div class="planet-grid">${cards}</div>
    <div class="section-title">🔭 Exploration</div>
    <div class="cards">${survey}</div>
    <div class="hint" style="margin-top:14px">🏆 Your long-term legacy goals and all contracts now live in the <b>🎯 Missions</b> tab.</div>`;
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
  // ---- Black market: fence held cargo off the books (no customs, no Wanted) ----
  let blackMarket = "";
  if (hasBlackMarket(p)) {
    const held = CARGO_IDS.filter(c => (S.res[c] || 0) > 0);
    let frows = held.map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name}${isIllicit(c) ? ' <span class="pill bad" title="Hot goods — fences pay a premium">hot</span>' : ''}</td>
        <td class="num">${fmt(fencePrice(p.id, c))}</td>
        <td class="num">${fmt(S.res[c])}</td>
        <td><div class="trade-controls">
          <input class="qty" id="fq-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-bad" onclick="fenceQty('${c}')">Fence</button>
          <button class="btn btn-sm btn-bad" title="Fence your entire stock" onclick="fenceAll('${c}')">All</button>
        </div></td></tr>`).join("");
    if (!held.length) frows = `<tr><td colspan="4" class="hint">Your hold is empty — bring plunder to fence.</td></tr>`;
    blackMarket = `<div class="card" style="border-color:var(--accent-2);margin-top:18px">
      <h4>🕴️ Black Market <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">no questions asked</span></h4>
      <div class="hint">Fences here buy off the books — no customs, no Wanted. <b>Hot</b> goods fetch a premium; mundane cargo takes a haircut. Your Dread sweetens every deal.</div>
      <table style="margin-top:8px"><thead><tr><th>Commodity</th><th class="num">Fence</th><th class="num">Hold</th><th></th></tr></thead><tbody>${frows}</tbody></table>
      ${held.length ? `<button class="btn btn-bad" style="margin-top:10px" onclick="fenceAllPlunder()">🕴️ Fence entire hold</button>` : ""}
    </div>`;
  }
  const _mcr = S.crises && S.crises[p.id];
  let crisisBanner = "";
  if (_mcr) {
    const cdef = CRISES[_mcr.type];
    const needRows = Object.keys(cdef.spike).map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name} <span class="pill bad">×${cdef.spike[c].toFixed(1)} demand</span></td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td><div class="trade-controls">
          <input class="qty" id="relief-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-good" title="Give it away — earn gratitude: rep, influence, popularity. Big shipments speed recovery." onclick="donateReliefQty('${c}')">🩹 Donate</button>
          <button class="btn btn-sm btn-bad" title="Sell at a vulture's premium (+35% on crisis prices) — costs rep, legitimacy, heat" onclick="gougeSellQty('${c}')">🦅 Gouge</button>
        </div></td></tr>`).join("");
    crisisBanner = `<div class="card" style="border-color:var(--bad)">
      <h4>${cdef.ico} ${cdef.name} — ${p.name} in crisis <span class="pill bad">${_mcr.cyclesLeft} cyc left</span></h4>
      <div class="hint">The world is desperate for the goods below. <b>Donate</b> to be the hero (reputation, influence, popularity — and the crisis shortens), <b>Gouge</b> to profiteer at a premium (and be remembered for it), or <b>Loot</b> the chaos outright.</div>
      <table style="margin-top:8px"><thead><tr><th>Needed</th><th class="num">Hold</th><th></th></tr></thead><tbody>${needRows}</tbody></table>
      <button class="btn btn-bad btn-sm" style="margin-top:8px" ${actionsLeft() > 0 ? "" : "disabled"} title="Scavenge valuables from the disorder — credits and goods, at the cost of standing and heat" onclick="lootCrisis()">🦅 Loot the chaos (1 action)</button>
    </div>`;
  }
  el.innerHTML = `<h2>${p.name} Market ${_mcr ? `<span class="pill bad">${CRISES[_mcr.type].ico} crisis</span>` : ""}</h2>
    <div class="subtitle">${p.tag}. ${showTrend ? "Galactic Exchange reveals trends &amp; deepens liquidity." : "Research the Galactic Exchange to reveal price trends."} Large trades move the price — dumping a lot crashes it, bulk buying spikes it; markets recover over cycles. Items marked <span class="pill bad">illegal</span> risk a customs bust here.${hasBlackMarket(p) ? ' A <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">black market</span> operates here.' : ''}</div>
    ${crisisBanner}
    <table><thead><tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Hold</th><th>Trend</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${blackMarket}
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
    const frac = reserveFrac(p.id, c);
    const est = Math.round(14 * p.deposits[c] * mod * tech * depletionMult(p.id, c) * pollutionYieldMult(p.id));
    const verb = { mine: "Mine", forage: "Forage", capture: "Capture", exploit: "Recover" }[COM[c].extract];
    const illegal = COM[c].illegalAt ? ' <span class="pill bad">hot cargo</span>' : '';
    const resCol = frac >= 0.6 ? "var(--good)" : frac >= 0.3 ? "var(--warn)" : "var(--bad)";
    const renew = RENEWABLE_RES[c] ? ' <span class="hint">(renews)</span>' : '';
    extractCards += `<div class="card ${ok ? "" : "locked"}">
      <h4>${COM[c].ico} ${verb} ${COM[c].name}${illegal}</h4>
      <div class="desc">${({mine:"Mining",forage:"Foraging",capture:"Gas capture",exploit:"Ruin salvage"})[COM[c].extract]} — yield scales with this world's deposit, your gear, and remaining reserves.</div>
      <div class="meta"><span class="hint">Reserves${renew}</span><span class="cost" style="color:${resCol}">${Math.round(frac * 100)}%</span></div>
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
  const _pl = pirateLevel(p.id);
  if (_pl > 0) {
    const threat = _pl >= 4 ? "infested" : _pl >= 2 ? "high" : "low";
    extractCards += `<div class="card" style="border-color:var(--warn)">
      <h4>⚠️ Pirate Activity <span class="pill ${_pl >= 2 ? "bad" : ""}">${threat} (level ${_pl})</span></h4>
      <div class="desc">Raiders prowl this system — they prey on convoys, colonies and travellers. Hunt them down from the <b>⚔️ Raider</b> tab: bounties scale with the pirate's rank, and every kill calms the lanes.</div>
      <button class="btn btn-primary" onclick="setTab('raid')">Go hunting ⚔️</button>
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
function polMeter(label, ico, val, max, col, note) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  return `<div class="ship-stat"><span class="k">${ico} ${label}</span><span class="v">${note != null ? note : Math.round(val)}</span></div>
    <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}
function abilityCostStr(c) {
  c = c || {}; const parts = [];
  if (c.credits)   parts.push(`${fmt(c.credits)} 💰`);
  if (c.influence) parts.push(`${c.influence} 🏛️`);
  if (c.slush)     parts.push(`${fmt(c.slush)} 💼`);
  return parts.length ? parts.join(" + ") : "free";
}
function renderPower() {
  if (!canPolitick()) {
    return `<div class="section-title">🏛️ Power & Organizations</div>
      <div class="cards"><div class="card"><h4>🏛️ Organizations locked</h4>
        <div class="desc">Research <b>📜 Galactic Charter</b> (Research tab) to found political organizations and wield public power — parties, media, foundations, security and more.</div></div></div>`;
  }
  const P = S.pol;
  const legLabel = P.legitimacy >= 40 ? "Statesman" : P.legitimacy <= -40 ? "Notorious"
                 : P.legitimacy > 0 ? "Respected" : P.legitimacy < 0 ? "Shady" : "Neutral";
  const heatCol = P.heat >= 65 ? "var(--bad)" : P.heat >= 35 ? "var(--warn)" : "var(--good)";
  const meters = `<div class="card"><h4>📊 Standing</h4>
    ${polMeter("Popularity", "📣", P.popularity, 100, "var(--accent)")}
    ${polMeter("Legitimacy", "⚖️", P.legitimacy + 100, 200, P.legitimacy >= 0 ? "var(--good)" : "var(--bad)", `${legLabel} (${P.legitimacy > 0 ? "+" : ""}${Math.round(P.legitimacy)})`)}
    ${polMeter("Heat", "🔥", P.heat, 100, heatCol)}
    <div class="ship-stat"><span class="k">🏛️ Influence</span><span class="v">${fmt(S.res.influence)}</span></div>
    <div class="ship-stat"><span class="k">💼 Slush fund</span><span class="v">${fmt(P.slush)}</span></div>
    <div class="ship-stat"><span class="k">🧾 Org upkeep</span><span class="v">${fmt(orgUpkeepTotal())}/cyc</span></div>
  </div>`;
  const al = actionsLeft();
  const cards = ORGS.map(def => {
    const o = S.orgs[def.id];
    const tonePill = `<span class="pill ${POL_TONE_CLS[def.tone]}">${def.tone}</span>`;
    if (!o) {
      const can = S.res.credits >= def.foundCost;
      return `<div class="card"><h4>${def.ico} ${def.name} ${tonePill}</h4>
        <div class="desc">${def.blurb}</div>
        <div class="meta"><span class="hint">Found</span><span class="cost">${fmt(def.foundCost)} 💰 · upkeep ${fmt(def.upkeep)}/cyc</span></div>
        <button class="btn btn-primary" ${can ? "" : "disabled"} onclick="foundOrg('${def.id}')">Found</button></div>`;
    }
    const dots = Array.from({ length: def.tiers }, (_, i) => `<span class="dot ${i < o.tier ? "on" : ""}"></span>`).join("");
    const maxed = o.tier >= def.tiers, up = orgUpgradeCost(def, o.tier);
    const abil = def.abilities.map(a =>
      `<button class="btn btn-sm" ${al > 0 ? "" : "disabled"} title="${a.desc}" onclick="runOrgAbility('${def.id}','${a.id}')">${a.ico} ${a.name} · ${abilityCostStr(a.cost)}</button>`
    ).join(" ");
    return `<div class="card owned"><h4>${def.ico} ${def.name} <span class="tier-dots">${dots}</span> ${tonePill}</h4>
      <div class="hint">${def.blurb}</div>
      <div class="hint">Upkeep ${fmt(def.upkeep * o.tier)}/cyc · abilities cost 1 action</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">${abil}</div>
      ${maxed ? `<div class="pill good">◉ Max tier</div>`
        : `<button class="btn btn-good" ${S.res.credits >= up ? "" : "disabled"} onclick="upgradeOrg('${def.id}')">Upgrade → T${o.tier + 1} (${fmt(up)} 💰)</button>`}
    </div>`;
  }).join("");
  return `<div class="section-title">🏛️ Power & Organizations</div>
    <div class="cards">${meters}${cards}</div>`;
}
function renderInvestigation() {
  if (S.jail > 0) {
    return `<div class="card" style="border-color:var(--bad)"><h4>⛓️ Imprisoned</h4>
      <div class="desc">You're serving time — <b>${S.jail} cycle(s)</b> remain. You cannot act or travel; your organizations and laws run on without you. End the cycle to serve your sentence.</div></div>`;
  }
  if (!S.invest) return "";
  const inv = S.invest, pct = Math.round(inv.evidence), al = actionsLeft();
  const col = pct >= 70 ? "var(--bad)" : pct >= 40 ? "var(--warn)" : "var(--good)";
  const btn = (fn, label, hint) => `<button class="btn btn-sm" ${al > 0 ? "" : "disabled"} title="${hint}" onclick="${fn}">${label}</button>`;
  const cms = [
    btn("investLawyer()", "⚖️ Lawyer Up", "1,500 cr: build your defense, shave evidence (clean)"),
    btn("investBribe()", "💼 Bribe", "800 slush: cut evidence — risk of backfire"),
  ];
  if (S.orgs.media) cms.push(btn("investSpin()", "🧼 Spin", "600 cr (Media): evidence & heat down"));
  if (S.orgs.intel) cms.push(btn("investBury()", "🗄️ Bury", "1,000 cr (Intel): big evidence cut — risky"));
  if (S.orgs.pmc)   cms.push(btn("investStrongarm()", "😠 Strong-arm", "8 inf (PMC): lean on witnesses — risky"));
  if (Object.keys(S.orgs || {}).length) cms.push(btn("investScapegoat()", "🪤 Scapegoat", "sacrifice an org to drop evidence"));
  cms.push(btn("faceTrial()", "🏛️ Face Trial", "gamble on the current evidence now"));
  return `<div class="card" style="border-color:var(--bad)">
    <h4>🚨 Under Investigation <span class="pill bad">${FACTIONS[inv.lead].ico} ${FACTIONS[inv.lead].name}</span></h4>
    <div class="hint">A corruption case is building. Drive the evidence down — or it reaches trial at 100.</div>
    ${polMeter("Evidence", "📁", inv.evidence, 100, col)}
    <div class="hint">Defense built: ${Math.round(inv.defense || 0)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${cms.join("")}</div>
  </div>`;
}
function renderOffice() {
  if (!canPolitick()) return "";
  const lvl = S.office || 0, cur = OFFICES[lvl], next = OFFICES[lvl + 1];
  const curName = cur ? `${cur.ico} ${cur.name}` : "🧑 Private Citizen";
  const termTxt = lvl <= 0 ? "" : lvl >= 4 ? "life tenure" : `${S.term} cyc term`;
  if (!next) {
    const leg = S.legacyTitle ? `<div class="pill good">Legacy: ${S.legacyTitle}</div>` : "";
    return `<div class="section-title">🏛️ Office</div><div class="cards"><div class="card owned">
      <h4>${curName}</h4><div class="desc">You hold supreme power over the sector.</div>${leg}</div></div>`;
  }
  const al = actionsLeft(), tgt = lvl + 1;
  const head = `<div class="card"><h4>${curName} ${termTxt ? `<span class="pill">${termTxt}</span>` : ""}${S.officePath && lvl > 0 ? ` <span class="hint">${S.officePath}</span>` : ""}</h4>
    <div class="hint">Rise by ballot, by backroom, or by force. Terms expire — keep your support up or be removed.</div></div>`;
  const ePop = ELECT_POP[tgt], eChest = 2000 * tgt;
  const eOk = S.pol.popularity >= ePop && S.res.credits >= eChest && al > 0;
  const eCard = `<div class="card"><h4>🗳️ Run for ${next.name}</h4>
    <div class="desc">Win at the ballot box — your popularity and money against the field. Clean: builds legitimacy.</div>
    <div class="hint">Need ${ePop}+ 📣 popularity · ${fmt(eChest)} 💰 chest</div>
    <button class="btn btn-primary" ${eOk ? "" : "disabled"} onclick="runForElection()">Campaign (1 action)</button></div>`;
  const aInf = APPOINT_INF[tgt], aRep = APPOINT_REP[tgt], aCost = 3000 * tgt;
  const patron = Object.keys(FACTIONS).filter(f => (S.rep[f] || 0) >= aRep).sort((a, b) => (S.rep[b] || 0) - (S.rep[a] || 0))[0];
  const aOk = (S.res.influence || 0) >= aInf && patron && S.res.credits >= aCost && al > 0;
  const aCard = `<div class="card"><h4>🤝 Seek Appointment</h4>
    <div class="desc">Let an allied faction install you. Backroom power, no public mandate.</div>
    <div class="hint">Need ${aInf} 🏛️ · a faction ally at ${aRep}+ rep ${patron ? `(✅ ${FACTIONS[patron].name})` : "(none yet)"} · ${fmt(aCost)} 💰</div>
    <button class="btn btn-primary" ${aOk ? "" : "disabled"} onclick="seekAppointment()">Lobby for Post (1 action)</button></div>`;
  const cPmc = COUP_PMC[tgt], pmcTier = (S.orgs.pmc && S.orgs.pmc.tier) || 0, cInf = 20 * tgt, cSlush = 1000 * tgt;
  const cOk = pmcTier >= cPmc && (S.res.influence || 0) >= cInf && S.pol.slush >= cSlush && al > 0;
  const cCard = `<div class="card"><h4>⚔️ Stage a Coup</h4>
    <div class="desc">Take power by force. Tanks legitimacy, enrages the factions, spikes Heat — and it can fail.</div>
    <div class="hint">Need 🛡️ Security tier ${cPmc} (have ${pmcTier}) · ${cInf} 🏛️ · ${fmt(cSlush)} 💼 slush</div>
    <button class="btn btn-bad" ${cOk ? "" : "disabled"} onclick="stageCoup()">Seize Power (1 action)</button></div>`;
  return `<div class="section-title">🏛️ Office — next: ${next.ico} ${next.name}</div><div class="cards">${head}${eCard}${aCard}${cCard}</div>`;
}
function renderLocalLaws() {
  if (!canPolitick()) return "";
  const p = currentPlanet(), pid = p.id, al = actionsLeft();
  const cost = 14 + Math.round(p.enforce * 20);
  const pm = S.planetLaws[pid] || {};
  const laws = Object.keys(pm).map(c =>
    `<span class="pill ${pm[c].type === "ban" ? "bad" : "good"}">${COM[c].ico} ${COM[c].name}: ${pm[c].type === "ban" ? "outlawed" : "legalized"} (${pm[c].until - S.turn} cyc)</span>`).join(" ");
  const opts = COM_IDS.map(c => `<option value="${c}">${COM[c].ico} ${COM[c].name}</option>`).join("");
  return `<div class="section-title">🏴 Local Trade Laws — ${p.name}</div>
    <div class="cards"><div class="card">
      <h4>Lobby the ${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name} authority</h4>
      <div class="desc"><b>Outlaw</b> a good to choke supply and drive up its (now contraband) price, or <b>legalize</b> a restricted good to open the market and soften it. Local, lasts ${LAW_DURATION} cycles, costs ${cost} 🏛️ influence — and it's a little shady.</div>
      <div class="hint">In force here: ${laws || "none"}</div>
      <div class="row" style="margin-top:6px">
        <select id="lawSel" class="lawsel">${opts}</select>
        <button class="btn btn-bad" ${al > 0 ? "" : "disabled"} onclick="lobbyLaw(document.getElementById('lawSel').value,'ban')">Outlaw</button>
        <button class="btn btn-good" ${al > 0 ? "" : "disabled"} onclick="lobbyLaw(document.getElementById('lawSel').value,'legal')">Legalize</button>
      </div>
    </div></div>`;
}
const VOTE_PILL = { yes: `<span class="pill good">YES</span>`, no: `<span class="pill bad">NO</span>`, abstain: `<span class="pill">abstain</span>` };
function renderSenate() {
  if (!canLegislate()) {
    return `<div class="section-title">⚖️ The Senate</div>
      <div class="cards"><div class="card"><h4>⚖️ No seat in the Senate</h4>
        <div class="desc">Win a <b>Senate Seat</b> (the Office & Elections card above) to propose legislation. Senators reshape the sector economy by passing <b>bills</b> the faction blocs vote on — including outlawing or legalizing a good sector-wide.</div></div></div>`;
  }
  // enacted policies
  let policyCards = "";
  const active = Object.keys(S.policies || {});
  if (active.length) {
    policyCards = `<div class="section-title">📐 Standing Laws</div>` +
      `<div class="cards">` + active.map(id => {
        const b = billDef(id), tgt = S.policies[id] && S.policies[id].target;
        const name = (b ? b.name : id) + (tgt ? `: ${COM[tgt].ico} ${COM[tgt].name}` : "");
        return `<div class="card owned"><h4>${name} <span class="pill ${POL_TONE_CLS[b ? b.tone : "grey"]}">${b ? b.tone : ""}</span></h4>
          <div class="hint">${b ? b.desc : ""}</div>
          <button class="btn btn-sm btn-bad" onclick="repealPolicy('${id}')">Repeal (15 🏛️)</button></div>`;
      }).join("") + `</div>`;
  }
  // the floor
  let floorHtml;
  const al = actionsLeft();
  if (S.floor) {
    const bill = billDef(S.floor.billId);
    const t = tallyFloor();
    const passing = t.yes > t.no;
    const rows = Object.keys(FACTIONS).map(f => {
      const v = factionVote(f, bill), seats = factionSeats(f), bought = (S.floor.sway[f] || 0) >= 3;
      return `<div class="ship-stat" style="align-items:center">
        <span class="k">${FACTIONS[f].ico} ${FACTIONS[f].name} <span class="hint">(${seats} seats)</span></span>
        <span class="v">${VOTE_PILL[v]}
          <button class="btn btn-sm" ${bought ? "disabled" : ""} title="Lobby: 8 influence" onclick="lobbyFaction('${f}')">Lobby</button>
          <button class="btn btn-sm" ${bought ? "disabled" : ""} title="Bribe: 600 slush" onclick="bribeFaction('${f}')">Bribe</button>
        </span></div>`;
    }).join("");
    floorHtml = `<div class="card" style="border-color:${passing ? "var(--good)" : "var(--warn)"}">
      <h4>📜 On the floor: ${bill.name}${S.floor.target ? `: ${COM[S.floor.target].ico} ${COM[S.floor.target].name}` : ""} <span class="pill ${POL_TONE_CLS[bill.tone]}">${bill.tone}</span></h4>
      <div class="hint">${bill.desc}</div>
      <div style="margin:8px 0">${rows}</div>
      <div class="meta"><span class="hint">Tally</span><span class="cost" style="color:${passing ? "var(--good)" : "var(--bad)"}">YES ${t.yes} – ${t.no} NO · ${t.abstain} abstain → <b>${passing ? "PASSING" : "FAILING"}</b></span></div>
      <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="callVote()">Call the Vote</button>
    </div>`;
  } else {
    const proposable = BILLS.filter(b => b.oneShot || !policyActive(b.id)).map(b => {
      const locked = b.reqPerk && !S.perks[b.reqPerk];
      const cstr = `${b.proposeCost || 20} 🏛️${b.proposeCredits ? " + " + fmt(b.proposeCredits) + " 💰" : ""}`;
      const sel = b.targeted ? `<select id="billtgt-${b.id}" class="lawsel">${COM_IDS.map(c => `<option value="${c}">${COM[c].ico} ${COM[c].name}</option>`).join("")}</select> ` : "";
      const onclick = b.targeted ? `proposeBill('${b.id}', document.getElementById('billtgt-${b.id}').value)` : `proposeBill('${b.id}')`;
      return `<div class="card"><h4>${b.name} <span class="pill ${POL_TONE_CLS[b.tone]}">${b.tone}</span></h4>
        <div class="desc">${b.desc}</div>
        <div class="meta"><span class="hint">Propose</span><span class="cost">${cstr}</span></div>
        ${locked ? `<div class="hint" style="color:var(--bad)">Requires Sector Governor</div>`
          : `<div class="row">${sel}<button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="${onclick}">Propose (1 action)</button></div>`}</div>`;
    }).join("");
    floorHtml = `<div class="hint">The floor is open — propose a bill (one at a time). The blocs vote on its merits, your standing, the public mood, and any lobbying you do.</div>
      <div class="cards">${proposable}</div>`;
  }
  return `${policyCards}<div class="section-title">⚖️ The Senate <span class="hint">(${senateSize()} seats)</span></div>${S.floor ? `<div class="cards">${floorHtml}</div>` : floorHtml}`;
}
function renderPolitics() {
  const el = document.getElementById("panel-politics");
  const p = currentPlanet();
  const al = actionsLeft();
  const status = (S.office && currentOffice()) ? `${currentOffice().ico} ${currentOffice().name}` : "Free Trader";
  const reps = Object.keys(FACTIONS).map(repBar).join("");

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
    <div class="subtitle">Status: <b>${status}</b>. Build a political machine: found organizations, sway the public, write law, and raise funds (clean and dirty). Contracts &amp; missions now live in the 🎯 Missions tab. You have <b>${fmt(S.res.influence)} 🏛️</b> influence.</div>
    <div class="cards">
      <div class="card"><h4>🏛️ Lobby & Network</h4>
        <div class="desc">Earn influence and reputation with <b>${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}</b> (controls ${p.name}).</div>
        <div class="meta"><span class="hint">Est.</span><span class="cost">+${Math.round((2 + (p.tech + p.industry) / 3) * (1 + S.upgrades.envoy * 0.40) * (S.perks.governor ? 1.6 : S.perks.senator ? 1.3 : 1))} 🏛️</span></div>
        <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="doPolitics()">Lobby (1 action)</button>
      </div>
      <div class="card"><h4>🤝 Faction Standing</h4>${reps}</div>
      ${(!S.office && !S.orgs.party) ? `<div class="card" style="border-color:var(--accent-2)">
        <h4>🚀 Enter Public Life</h4>
        <div class="desc">Launch a political career without leaving the cockpit: found your own <b>📣 People's Movement</b>, seed a war chest of clout (+15 🏛️, +10 popularity), and start the climb — rally, then run for Councillor.</div>
        <div class="meta"><span class="hint">One-time</span><span class="cost">${fmt(PUBLIC_LIFE_COST)} 💰 + 1 action</span></div>
        <button class="btn btn-primary" ${al > 0 && S.res.credits >= PUBLIC_LIFE_COST ? "" : "disabled"} onclick="enterPublicLife()">Enter Public Life</button>
      </div>` : ""}
    </div>
    ${(() => { const ic = renderInvestigation(); return ic ? `<div class="cards">${ic}</div>` : ""; })()}
    ${renderOffice()}
    ${renderPower()}
    ${renderLocalLaws()}
    ${renderSenate()}
    ${decrees}`;
}

/* ----- Missions (long-term goals + time-bound contracts) ----- */
function renderMissions() {
  const el = document.getElementById("panel-missions");
  if (!el) return;

  // Long-term: the legacy goals that win the game
  const wp = winProgress();
  const goals = Object.values(wp).map(g => `<div class="ship-stat"><span class="k">${g.have ? "✅" : "⬜"} ${g.label}</span></div>`).join("");

  // Long-term: career missions (requirement-gated, no clock)
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

  // Time-bound: faction contracts with a deadline
  const contractCards = S.contracts.length ? S.contracts
    .slice().sort((a, b) => a.deadline - b.deadline).map(c => {
      const dest = PLANETS.find(p2 => p2.id === c.planetId);
      const left = c.deadline - S.turn;
      const here = S.location === c.planetId;
      const have = (S.res[c.commodity] || 0) >= c.qty;
      const urgent = left <= 2;
      return `<div class="card" ${urgent ? 'style="border-color:var(--warn)"' : ""}>
        <h4>${FACTIONS[c.faction].ico} ${c.kind === "relief" ? "🆘 Relief Appeal" : c.kind === "smuggle" ? "Smuggling Job" : "Supply Contract"}
          <span class="pill ${urgent ? "bad" : ""}">${left} cyc left</span></h4>
        <div class="desc">Deliver <b>${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name}</b> to <b>${dest.name}</b> for the ${FACTIONS[c.faction].name}.</div>
        <div class="hint">Reward: ${costString(c.reward)}</div>
        <div class="hint">${here ? (have ? "Ready to deliver." : `You hold ${fmt(S.res[c.commodity] || 0)}/${c.qty}.`) : `Travel to ${dest.name}.`}</div>
        <button class="btn btn-primary" ${here && have ? "" : "disabled"} onclick="fulfilContract('${c.id}')">Fulfil</button>
      </div>`;
    }).join("") : '<div class="hint">No active contracts. New ones are posted by the factions as cycles pass.</div>';

  el.innerHTML = `<h2>🎯 Missions</h2>
    <div class="subtitle">Everything with an objective in one place: <b>time-bound contracts</b> race the clock, <b>career missions</b> unlock as you grow, and your <b>legacy goals</b> are the long game that wins it all.</div>
    <div class="section-title">📋 Contracts (time-bound)</div>
    <div class="cards">${contractCards}</div>
    <div class="section-title">🧭 Career Missions (long-term)</div>
    <div class="cards">${missionCards}</div>
    <div class="section-title">🏆 Your Legacy (win conditions)</div>
    <div class="cards"><div class="card">${goals}<div class="hint">Net worth: ${fmt(netWorth())} cr</div></div></div>`;
}

/* ----- Ship ----- */
function renderRaid() {
  const el = document.getElementById("panel-raid");
  if (!el) return;
  const P = S.pirate, p = currentPlanet(), al = actionsLeft();
  const wantedCol = P.wanted >= 60 ? "var(--bad)" : P.wanted >= 30 ? "var(--warn)" : "var(--good)";
  const hullCol = P.hull >= 60 ? "var(--good)" : P.hull >= 30 ? "var(--warn)" : "var(--bad)";
  const noto = notoriety();
  const corruptible = p.enforce <= 0.6;
  const settleCost = P.wanted > 0 ? Math.round(Math.min(P.wanted, 15 + Math.round(P.wanted * 0.25)) * (60 + p.enforce * 120)) : 0;
  const status = `<div class="card"><h4>🏴‍☠️ Outlaw Status <span class="pill" style="border-color:${noto.col};color:${noto.col}">${noto.label}</span></h4>
    ${polMeter("Wanted", "🎯", P.wanted, 100, wantedCol)}
    ${polMeter("Dread", "💀", P.dread, 100, "var(--accent-2)")}
    ${polMeter("Hull", "🛡️", P.hull, 100, hullCol)}
    <div class="ship-stat" style="margin-top:6px"><span class="k">Raids pulled</span><span class="v">${fmt(P.raids)}</span></div>
    ${(P.bountyKills || 0) > 0 ? `<div class="ship-stat"><span class="k">Pirates hunted</span><span class="v">${fmt(P.bountyKills)} · ${fmt(P.bountyEarned)} cr</span></div>` : ""}
    <div class="ship-stat"><span class="k">Total plundered</span><span class="v">${fmt(P.plundered)} cr</span></div>
    <div class="ship-stat"><span class="k">Raid power</span><span class="v">${Math.round(raidPower())}</span></div>
    ${P.hull < HULL_MAX ? `<button class="btn btn-good" style="margin-top:8px" onclick="repairShip()">🔧 Repair hull (${fmt(Math.round((HULL_MAX - P.hull) * (atHaven() ? 18 : 30)))} 💰${atHaven() ? ", haven rate" : ""})</button>` : `<div class="pill good" style="margin-top:8px">◉ Hull pristine</div>`}
    ${P.wanted > 0 && !S.interdiction ? (corruptible
      ? `<button class="btn btn-sm" style="margin-top:6px" ${al > 0 && S.res.credits >= settleCost ? "" : "disabled"} title="Bribe corruptible officials to wipe warrants" onclick="settleWarrants()">📝 Settle warrants (${fmt(settleCost)} 💰)</button>`
      : `<div class="hint" style="margin-top:6px">Officials here are incorruptible — settle warrants in lawless space.</div>`) : ""}
  </div>`;
  let action;
  if (S.encounter) {
    const e = S.encounter;
    const rp = raidPower();
    const odds = rp >= e.strength * 1.2 ? "favorable" : rp >= e.strength * 0.8 ? "even" : "grim";
    const oddsCol = odds === "favorable" ? "var(--good)" : odds === "even" ? "var(--warn)" : "var(--bad)";
    const fleeOdds = Math.round(Math.max(5, Math.min(95, (0.45 + S.upgrades.engine * 0.15 - e.level * 0.05) * 100)));
    action = `<div class="card" style="border-color:var(--bad)">
      <h4>🏴‍☠️ Ambush: ${e.ico} ${e.name} <span class="pill bad">level ${e.level}</span></h4>
      <div class="hint">It demands <b>${fmt(e.toll)} 💰</b> to let you pass. Strength ~${e.strength} · bounty on its head ${fmt(e.bounty)} cr.</div>
      <div class="meta"><span class="hint">Fight odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${e.strength}</span></div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-sm" ${S.res.credits >= e.toll ? "" : "disabled"} title="Pay the toll — bloodless, but galling" onclick="encounterPay()">💰 Pay ${fmt(e.toll)}</button>
        <button class="btn btn-sm" title="Burn for it — failing costs hull" onclick="encounterFlee()">🏃 Flee (~${fleeOdds}%)</button>
        <button class="btn btn-bad" title="Turn and fight — win the bounty, or be boarded and robbed" onclick="encounterFight()">⚔️ Fight</button>
      </div>
    </div>`;
  } else if (S.interdiction) {
    const it = S.interdiction, ip = PLANETS.find(x => x.id === it.planet) || p;
    const rp = raidPower();
    const odds = rp >= it.strength * 1.2 ? "favorable" : rp >= it.strength * 0.8 ? "even" : "grim";
    const oddsCol = odds === "favorable" ? "var(--good)" : odds === "even" ? "var(--warn)" : "var(--bad)";
    const canBribe = ip.enforce <= 0.75;
    action = `<div class="card" style="border-color:var(--bad)">
      <h4>🚨 Navy Interdiction <span class="pill bad">${ip.name}</span></h4>
      <div class="hint">${it.kind === "dock" ? "A cutter locked onto your transponder as you docked." : "A patrol sweep caught you red-handed on the lanes."} Cutter strength ~${it.strength}.</div>
      <div class="meta"><span class="hint">Fight odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${it.strength}</span></div>
      <div class="row" style="margin-top:6px">
        ${canBribe
          ? `<button class="btn btn-primary" ${S.res.credits >= it.bribe ? "" : "disabled"} title="Pay them off — costs credits, trims Wanted" onclick="navyBribe()">💵 Bribe (${fmt(it.bribe)} 💰)</button>`
          : `<button class="btn" disabled title="These officers can't be bought">💵 Incorruptible</button>`}
        <button class="btn btn-bad" title="Shoot your way clear — lose and you're boarded & arrested" onclick="navyFight()">⚔️ Fight</button>
        <button class="btn btn-sm" title="Stand down: cargo seized, fined and jailed, but warrants mostly cleared" onclick="navySurrender()">🏳️ Surrender</button>
      </div>
    </div>`;
  } else if (S.prey && S.prey.isPirate) {
    const prey = S.prey;
    const rp2 = raidPower();
    const odds2 = rp2 >= prey.strength * 1.2 ? "favorable" : rp2 >= prey.strength * 0.8 ? "even" : "risky";
    const oddsCol2 = odds2 === "favorable" ? "var(--good)" : odds2 === "even" ? "var(--warn)" : "var(--bad)";
    action = `<div class="card" style="border-color:var(--good)">
      <h4>${prey.ico} ${prey.name} <span class="pill good">🎯 bounty ${fmt(prey.bounty)} 💰</span></h4>
      <div class="hint">A wanted raider — bringing it down is a <b>lawful kill</b>: bounty, salvage, faction goodwill, no Wanted.</div>
      <div class="meta"><span class="hint">Your odds</span><span class="cost" style="color:${oddsCol2}">${odds2} — power ${Math.round(rp2)} vs ~${prey.strength}</span></div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="raidAttack()">⚔️ Engage</button>
        <button class="btn btn-sm" onclick="raidDisengage()">Let it go</button>
      </div>
    </div>`;
  } else if (S.prey) {
    const prey = S.prey;
    const cargoStr = Object.keys(prey.cargo).map(c => `${prey.cargo[c]} ${COM[c].ico} ${COM[c].name}`).join(", ") || "scant cargo";
    const rp = raidPower();
    const odds = rp >= prey.strength * 1.2 ? "favorable" : rp >= prey.strength * 0.8 ? "even" : "risky";
    const oddsCol = odds === "favorable" ? "var(--good)" : odds === "even" ? "var(--warn)" : "var(--bad)";
    action = `<div class="card" style="border-color:var(--warn)">
      <h4>${prey.ico} ${prey.name} <span class="pill">${FACTIONS[prey.faction].ico} ${FACTIONS[prey.faction].name}</span></h4>
      <div class="hint">Hold: ${cargoStr} · ${fmt(prey.credits)} 💰 · escort strength ~${prey.strength}</div>
      <div class="meta"><span class="hint">Your odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${prey.strength}</span></div>
      <div class="row" style="margin-top:6px">
        <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="raidAttack()">⚔️ Attack</button>
        <button class="btn btn-bad" ${al > 0 ? "" : "disabled"} title="Slaughter the crew: more Dread, more Wanted" onclick="raidNoQuarter()">☠️ No Quarter</button>
        <button class="btn btn-sm" ${al > 0 ? "" : "disabled"} title="Use your Dread to extort tribute — no fight" onclick="raidExtort()">💀 Extort</button>
        <button class="btn btn-sm" onclick="raidDisengage()">Disengage</button>
      </div>
    </div>`;
  } else {
    const armed = S.upgrades.cannons >= 1;
    const richness = p.enforce >= 0.5 ? "fat, well-escorted lawful traffic" : p.enforce >= 0.25 ? "mixed traffic" : "lean rim runners & smugglers";
    action = `<div class="card">
      <h4>🔭 Prowl the lanes near ${p.name}</h4>
      <div class="desc">Hunt for prey on the shipping lanes (${richness}). Lawful space carries richer cargo but heavier escorts and stiffer bounties; the lawless rim is leaner but safer. Costs ${PROWL_FUEL} ⛽ and one action.</div>
      ${armed ? "" : `<div class="hint" style="color:var(--warn)">Install 🔫 Weapon Systems (Ship tab) to raid with any real teeth.</div>`}
      <button class="btn btn-primary" ${al > 0 && S.res.fuel >= PROWL_FUEL ? "" : "disabled"} onclick="prowl()">Prowl (1 action)</button>
    </div>`;
    const lvl = pirateLevel(p.id);
    action += `<div class="card" ${lvl > 0 ? 'style="border-color:var(--good)"' : ""}>
      <h4>🎯 Hunt Pirates ${lvl > 0 ? `<span class="pill ${lvl >= 2 ? "bad" : ""}">activity level ${lvl}</span>` : '<span class="pill good">lanes clear</span>'}</h4>
      <div class="desc">${lvl > 0
        ? `Raiders of about <b>${PIRATE_RANKS[Math.min(5, Math.max(1, lvl))].name}</b> rank work this system. Bounties scale with rank — and every kill suppresses pirate raids on your colonies and convoys for a while. A <b>lawful</b> trade: no Wanted.${pirateCalm() ? " <i>(Lanes currently calm.)</i>" : ""}`
        : "No pirate activity here right now — check ⚠️ flagged systems on the lawless rim."} Costs ${PROWL_FUEL} ⛽ and one action.</div>
      <button class="btn btn-primary" ${al > 0 && lvl > 0 && S.res.fuel >= PROWL_FUEL ? "" : "disabled"} onclick="huntPirates()">Hunt (1 action)</button>
    </div>`;
  }
  // ---- Pirate haven ----
  let havenCard = "";
  if (S.haven) {
    const hp = PLANETS.find(x => x.id === S.haven.planet);
    const here = atHaven();
    const stash = Object.entries(S.haven.stash).filter(([, q]) => q > 0).map(([c, q]) => `${q}${COM[c].ico}`).join(" ") || "empty";
    havenCard = `<div class="card" style="border-color:var(--accent-2)">
      <h4>🏴‍☠️ Haven: ${hp.name} <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">tier ${S.haven.tier}</span></h4>
      <div class="ship-stat"><span class="k">Stash</span><span class="v">${havenStashUsed()}/${havenStashCap()}</span></div>
      <div style="font-size:12px;line-height:1.7">${stash}</div>
      <div class="ship-stat"><span class="k">Tribute/cycle</span><span class="v">${fmt(havenTributeRate())} 💰</span></div>
      ${here ? `<div class="row" style="margin-top:8px">
        <button class="btn btn-primary" ${al > 0 && P.wanted > 0 ? "" : "disabled"} title="Disappear and let the heat die down" onclick="layLow()">🤫 Lie Low (−${22 + S.haven.tier * 4} Wanted)</button>
        <button class="btn btn-sm" onclick="havenStashAll()">🗄️ Stash hold</button>
        <button class="btn btn-sm" onclick="havenTakeAll()">📦 Take all</button>
        ${S.haven.tier < HAVEN_MAX_TIER ? `<button class="btn btn-sm" ${S.res.credits >= HAVEN_COST * S.haven.tier ? "" : "disabled"} onclick="upgradeHaven()">🏗️ Expand (${fmt(HAVEN_COST * S.haven.tier)} 💰)</button>` : ""}
      </div>` : `<div class="hint" style="margin-top:6px">Return to ${hp.name} to lie low, stash plunder, and dry-dock cheap.</div>`}
    </div>`;
  } else if (canHaven(p)) {
    havenCard = `<div class="card">
      <h4>🏴‍☠️ Establish a Haven</h4>
      <div class="desc">${p.name} is lawless enough to hide a den. A haven lets you <b>lie low</b> to shed Wanted, <b>stash plunder</b> safe from boarding, dry-dock at half cost, and collect <b>tribute</b> scaling with your Dread.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(HAVEN_COST)} 💰 + ${HAVEN_METALS} ⛓️</span></div>
      <button class="btn btn-primary" ${S.res.credits >= HAVEN_COST && (S.res.metals || 0) >= HAVEN_METALS ? "" : "disabled"} onclick="establishHaven()">Establish Haven</button>
    </div>`;
  }
  // ---- Privateer commission ----
  let commCard = "";
  if (S.commission) {
    const c = S.commission, left = Math.max(0, c.expires - S.turn);
    commCard = `<div class="card" style="border-color:var(--good)">
      <h4>📜 Letter of Marque <span class="pill good">${FACTIONS[c.patron].ico} ${FACTIONS[c.patron].name}</span></h4>
      <div class="hint">Sanctioned to raid <b>${FACTIONS[c.target].ico} ${FACTIONS[c.target].name}</b> shipping — their kills draw no Wanted and pay a ${fmt(c.bounty)} cr bounty. Don't turn on your patron.</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Progress</span><span class="v">${c.done}/${c.quota} raids</span></div>
      <div class="ship-stat"><span class="k">Cycles left</span><span class="v">${left}</span></div>
      <div class="ship-stat"><span class="k">Completion bonus</span><span class="v">${fmt(c.reward)} 💰</span></div>
    </div>`;
  } else {
    const patron = p.faction, target = FACTION_RIVAL[patron];
    if (target && (S.rep[patron] || 0) >= COMM_REP_REQ) {
      commCard = `<div class="card">
        <h4>📜 Privateer Commission</h4>
        <div class="desc">${FACTIONS[patron].name} will issue a letter of marque against the <b>${FACTIONS[target].name}</b>: hunt their shipping legally — no Wanted, a ${fmt(COMM_BOUNTY)} cr bounty per raid, and a ${fmt(COMM_REWARD)} cr bonus for ${COMM_QUOTA} raids in ${COMM_DURATION} cycles. Their ports will stop interdicting you; the target's will hate you.</div>
        <button class="btn btn-primary" onclick="acceptCommission()">Accept Letter of Marque</button>
      </div>`;
    }
  }
  // ---- Pirate Lord capstone ----
  let lordCard = "";
  if (S.legacyTitle) {
    lordCard = `<div class="card maxed"><h4>👑 Outlaw Legacy</h4>
      <div class="pill good">${S.legacyTitle}</div>
      <div class="hint" style="margin-top:6px">Your name is written into the sector's legend.</div></div>`;
  } else if (P.raids > 0 || S.haven || S.commission) {
    const crit = pirateLordCriteria(), ready = crit.every(c => c.ok);
    lordCard = `<div class="card" style="border-color:${ready ? "var(--good)" : "var(--accent-2)"}">
      <h4>👑 Path to Pirate Lord</h4>
      <div class="hint">Dominate the rim to claim an outlaw legacy — a path to victory all your own.</div>
      <div style="font-size:13px;line-height:2;margin-top:4px">${crit.map(c => `${c.ok ? "✅" : "⬜"} ${c.label}`).join("<br>")}</div>
      ${ready ? `<button class="btn btn-primary" style="margin-top:8px" onclick="pirateLegacy()">👑 Claim your throne</button>` : ""}
    </div>`;
  }
  let marshalCard = "";
  if (!S.legacyTitle && (P.bountyKills || 0) > 0) {
    const crit = marshalCriteria(), ready = crit.every(c => c.ok);
    marshalCard = `<div class="card" style="border-color:${ready ? "var(--good)" : "var(--accent-2)"}">
      <h4>⚖️ Path to Sector Marshal</h4>
      <div class="hint">Clear the lanes of every raider to claim a lawful legacy — victory by the badge, not the black flag.</div>
      <div style="font-size:13px;line-height:2;margin-top:4px">${crit.map(c => `${c.ok ? "✅" : "⬜"} ${c.label}`).join("<br>")}</div>
      ${ready ? `<button class="btn btn-primary" style="margin-top:8px" onclick="marshalLegacy()">⚖️ Claim your badge</button>` : ""}
    </div>`;
  }
  el.innerHTML = `<h2>⚔️ Raider</h2>
    <div class="subtitle">Two trades, one gun: <b>prey on shipping</b> (build Dread, mind your Wanted — the navy interdicts the notorious; havens and letters of marque are an outlaw&#39;s tools) or <b>hunt pirates</b> for lawful bounties that scale with their rank — every kill calms the lanes, shielding your colonies and convoys. Travel through infested systems and the pirates may find <i>you</i>.</div>
    <div class="cards">${status}${action}${commCard}${havenCard}${lordCard}${marshalCard}</div>`;
}
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

/* ----- Bases ----- */
function renderBases() {
  const el = document.getElementById("panel-bases");
  const pid = S.location, planet = currentPlanet(), b = S.bases[pid];

  // Overview of every base you own (they run while you're away)
  const baseIds = Object.keys(S.bases);
  let overview;
  if (baseIds.length) {
    overview = baseIds.map(id => {
      const bb = S.bases[id], pl = PLANETS.find(p => p.id === id);
      const prod = baseModuleList(pl)
        .map(m => { const o = moduleOutput(pl, m, bb.modules[m.id] || 0); return o > 0 ? o + COM[m.produces].ico : ""; })
        .filter(Boolean).join(" ") || "—";
      const stored = Object.entries(bb.storage).filter(([, q]) => q > 0)
        .map(([c, q]) => q + COM[c].ico).join(" ") || "empty";
      return `<div class="card ${id === pid ? "owned" : ""}">
        <h4>${pl.name} ${id === pid ? '<span class="pill good">here</span>' : ""}</h4>
        <div class="hint">Storage ${baseStorageUsed(bb)}/${baseStorageCap(id)}</div>
        <div class="ship-stat"><span class="k">Produces/cycle</span><span class="v">${prod}</span></div>
        <div class="ship-stat"><span class="k">Stored</span></div><div style="font-size:12px;line-height:1.7">${stored}</div>
      </div>`;
    }).join("");
  } else {
    overview = '<div class="hint">You have no bases yet. Bases produce and store resources every cycle — even while you are light-years away.</div>';
  }

  // Current-planet management
  let here;
  if (!b) {
    const fMats = BASE_FOUNDATION_MATS;
    const fOk = S.res.credits >= BASE_FOUNDATION_COST && canAfford(fMats);
    here = `<div class="section-title">📍 ${planet.name}</div><div class="cards"><div class="card">
      <h4>🏗️ Establish a Base on ${planet.name}</h4>
      <div class="desc">Found a permanent outpost. Build farms, mines and depots that work automatically every cycle, and stockpile goods for later. Construction consumes materials from your hold.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(BASE_FOUNDATION_COST)} 💰 + ${matsString(fMats)}</span></div>
      <button class="btn btn-primary" ${fOk ? "" : "disabled"} onclick="buildBase()">Establish Base</button>
    </div></div>`;
  } else {
    const modCards = baseModuleList(planet).map(m => {
      const tier = b.modules[m.id] || 0, maxed = tier >= m.tiers;
      const cost = Math.round(m.baseCost * Math.pow(m.costMul, tier));
      const mats = moduleMats(m, tier + 1);
      const ok = S.res.credits >= cost && canAfford(mats);
      const dots = Array.from({ length: m.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
      const cur = m.storage ? (tier > 0 ? `+${tier * 250} storage` : "not built")
        : (tier > 0 ? `+${moduleOutput(planet, m, tier)} ${COM[m.produces].ico}/cycle` : "not built");
      const nxt = m.storage ? "+250 storage"
        : `+${moduleOutput(planet, m, tier + 1) - moduleOutput(planet, m, tier)} ${COM[m.produces].ico}/cycle`;
      return `<div class="card ${tier > 0 ? (maxed ? "maxed" : "owned") : ""}">
        <h4>${m.ico} ${m.name} <span class="tier-dots">${dots}</span></h4>
        <div class="desc">${m.desc}</div>
        <div class="hint">Current: ${cur}</div>
        ${maxed ? '<div class="pill good">◉ Fully built</div>'
          : `<div class="meta"><span class="hint">Next: ${nxt}</span><span class="cost">${fmt(cost)} 💰 + ${matsString(mats)}</span></div>
             <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="buildModule('${m.id}')">${tier > 0 ? "Upgrade" : "Build"} (Tier ${tier + 1})</button>`}
      </div>`;
    }).join("");
    const ids = CARGO_IDS.filter(c => (S.res[c] || 0) > 0 || (b.storage[c] || 0) > 0);
    const rows = ids.length ? ids.map(c => `<tr>
      <td>${COM[c].ico} ${COM[c].name}</td>
      <td class="num">${fmt(S.res[c] || 0)}</td>
      <td class="num">${fmt(b.storage[c] || 0)}</td>
      <td><div class="trade-controls">
        <input class="qty" id="xfer-${c}" type="number" min="1" value="10" />
        <button class="btn btn-sm" onclick="depositQty('${c}')">Store ▸</button>
        <button class="btn btn-sm" onclick="withdrawQty('${c}')">◂ Take</button>
      </div></td></tr>`).join("")
      : '<tr><td colspan="4" class="hint">Nothing in your hold or this base yet.</td></tr>';
    here = `<div class="section-title">🛠️ Modules — ${planet.name}</div>
      <div class="cards">${modCards}</div>
      <div class="section-title">📦 Storage (${baseStorageUsed(b)}/${baseStorageCap(pid)})</div>
      <div class="row" style="margin-bottom:8px"><button class="btn btn-sm" onclick="storeAllCargo()">Store all cargo ▸</button></div>
      <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In base</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  el.innerHTML = `<h2>Bases</h2>
    <div class="subtitle">Build outposts across the galaxy. Their farms, mines and depots produce and store resources automatically every cycle — even while you travel.</div>
    <div class="section-title">🌐 Your Outposts</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

/* ----- Colonies ----- */
function colonyHealthPill(col) {
  const h = col.happiness;
  return h >= 70 ? '<span class="pill good">thriving</span>'
    : h >= 45 ? '<span class="pill">stable</span>'
    : '<span class="pill bad">unrest</span>';
}
function renderColonies() {
  const el = document.getElementById("panel-colonies");
  const pid = S.location, planet = currentPlanet(), col = S.colonies[pid];

  const ids = Object.keys(S.colonies);
  let overview;
  if (ids.length) {
    overview = ids.map(id => {
      const c = S.colonies[id], pl = PLANETS.find(p => p.id === id);
      return `<div class="card ${id === pid ? "owned" : ""}">
        <h4>${pl.name} ${id === pid ? '<span class="pill good">here</span>' : ""} ${colonyHealthPill(c)}</h4>
        <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(c.pop)}k</span></div>
        <div class="ship-stat"><span class="k">😊 Happiness</span><span class="v">${c.happiness}%</span></div>
        <div class="ship-stat"><span class="k">🏭/🔬 Dev</span><span class="v">Ind ${effIndustry(pl)} · Tech ${effTech(pl)}</span></div>
        <div class="ship-stat"><span class="k">💰 Tax income</span><span class="v">+${fmt(colonyTaxIncome(c))}/cyc</span></div>
      </div>`;
    }).join("");
  } else {
    overview = '<div class="hint">You govern no colonies yet. Find a <span class="pill good">colonizable</span> world (e.g. Aurora, Cinder, or one you discover by survey), travel there and found one.</div>';
  }

  let here;
  if (!canColonize()) {
    const reqs = TECHS.find(t => t.id === "colonial").req.map(r => `${S.techs[r] ? "✅" : "⬜"} ${TECHS.find(x => x.id === r).name}`).join(" · ");
    here = `<div class="section-title">🔒 Colonization Locked</div><div class="cards"><div class="card">
      <h4>🏙️ Research Colonial Charter to begin</h4>
      <div class="desc">Colonies are the next chapter of your story. Once you've mastered trade and politics, the Colonial Charter grants the authority — and the deep-space sensors — to settle the frontier. Frontier worlds marked <span class="pill good">colonizable</span> are already visible on the Galaxy map; survey to find more once unlocked.</div>
      <div class="meta"><span class="hint">Prerequisites</span><span class="cost">${reqs}</span></div>
      <div class="hint">Find it in the 🔬 Research tab (cost: 120 tech).</div>
    </div></div>`;
  } else if (!planet.colonizable) {
    here = `<div class="section-title">📍 ${planet.name}</div><div class="hint">${planet.name} is an established world and cannot be colonized — but you can still build an outpost <b>Base</b> here. Colonize the frontier worlds instead.</div>`;
  } else if (!col) {
    const ok = S.res.credits >= COLONY_FOUNDATION_COST && canAfford(COLONY_FOUNDATION_MATS);
    here = `<div class="section-title">📍 ${planet.name}</div><div class="cards"><div class="card">
      <h4>🌍 Found a Colony on ${planet.name}</h4>
      <div class="desc">Settle this world. Build housing, farms, factories and labs; feed and supply your people to grow the population and raise the planet's industry & tech. Tax your citizens for steady income.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(COLONY_FOUNDATION_COST)} 💰 + ${matsString(COLONY_FOUNDATION_MATS)}</span></div>
      <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="colonize()">Found Colony</button>
    </div></div>`;
  } else {
    const housing = colonyHousing(col, planet);
    const fedNeed = col.pop, fedHave = col.storage[COLONY_FOOD] || 0;
    const govCard = `<div class="card">
      <h4>🏛️ ${planet.name} Colony ${colonyHealthPill(col)}</h4>
      <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(col.pop)}k / ${fmt(housing)}k</span></div>
      <div class="bar"><span style="width:${Math.min(100, col.pop / housing * 100)}%"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">😊 Happiness</span><span class="v">${col.happiness}%</span></div>
      <div class="bar"><span style="width:${col.happiness}%;background:${col.happiness>=60?'var(--good)':col.happiness>=35?'var(--warn)':'var(--bad)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🌾 Food / cycle</span><span class="v" style="color:${fedHave>=fedNeed?'var(--good)':'var(--bad)'}">${fmt(fedHave)} stored · need ${fmt(fedNeed)}</span></div>
      <div class="ship-stat"><span class="k">☁️ Pollution</span><span class="v" style="color:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}">${Math.round(pollutionOf(planet.id))}</span></div>
      <div class="bar"><span style="width:${pollutionOf(planet.id)}%;background:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🏭 Industry</span><span class="v">${effIndustry(planet)}</span></div>
      <div class="ship-stat"><span class="k">🔬 Tech</span><span class="v">${effTech(planet)}</span></div>
      <div class="ship-stat"><span class="k">🛡️ Defense</span><span class="v">${colonyDefense(col) ? "Level " + colonyDefense(col) : '<span style="color:var(--bad)">undefended</span>'}</span></div>
      ${(col.unrest || 0) >= 2 ? `<div class="ship-stat"><span class="k">⚠️ Unrest</span><span class="v" style="color:var(--bad)">secession risk — improve happiness!</span></div>` : ""}
      <div class="ship-stat" style="margin-top:8px"><span class="k">💰 Tax rate</span><span class="v">${col.tax}% → +${fmt(colonyTaxIncome(col))}/cyc</span></div>
      <div class="row"><button class="btn btn-sm" onclick="setTax(-5)">− Tax</button><button class="btn btn-sm" onclick="setTax(5)">+ Tax</button>
        <span class="hint">High tax lowers happiness.</span></div>
    </div>`;
    const buildCards = colonyBuildingList(planet).map(b => {
      const tier = col.buildings[b.id] || 0, maxed = tier >= b.tiers;
      const cost = Math.round(b.baseCost * Math.pow(b.costMul, tier));
      const mats = colonyBuildingMats(b, tier + 1);
      const locked = b.req && !S.techs[b.req];
      const ok = !locked && S.res.credits >= cost && canAfford(mats);
      const dots = Array.from({ length: b.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
      return `<div class="card ${tier > 0 ? (maxed ? "maxed" : "owned") : ""}">
        <h4>${b.ico} ${b.name} <span class="tier-dots">${dots}</span></h4>
        <div class="desc">${b.desc}</div>
        ${b.recipe ? `<div class="hint">⚙️ ${colonyRecipeStr(b.recipe)}</div>` : ""}
        ${maxed ? '<div class="pill good">◉ Fully built</div>'
          : locked ? `<div class="pill bad">🔒 needs ${(TECHS.find(t => t.id === b.req) || {}).name || b.req}</div>`
          : `<div class="meta"><span class="hint">Tier ${tier + 1}</span><span class="cost">${fmt(cost)} 💰 + ${matsString(mats)}</span></div>
             <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="buildColonyBuilding('${b.id}')">${tier > 0 ? "Upgrade" : "Build"}</button>`}
      </div>`;
    }).join("");
    const sids = CARGO_IDS.filter(c => (S.res[c] || 0) > 0 || (col.storage[c] || 0) > 0);
    const rows = sids.length ? sids.map(c => `<tr>
      <td>${COM[c].ico} ${COM[c].name}</td>
      <td class="num">${fmt(S.res[c] || 0)}</td><td class="num">${fmt(col.storage[c] || 0)}</td>
      <td><div class="trade-controls">
        <input class="qty" id="col-${c}" type="number" min="1" value="10" />
        <button class="btn btn-sm" onclick="colonyDeposit('${c}')">Supply ▸</button>
        <button class="btn btn-sm" onclick="colonyWithdraw('${c}')">◂ Take</button>
      </div></td></tr>`).join("")
      : '<tr><td colspan="4" class="hint">Nothing in your hold or this colony yet.</td></tr>';
    const sp = spaceportTier(col);
    let logi;
    if (!sp) {
      logi = `<div class="section-title">🚚 Logistics <span class="pill bad">no spaceport</span></div>
        <div class="hint">Build a 🛰️ Spaceport to automate supply: set target stock levels and each cycle the network redistributes surplus from your other colonies (free), then imports the rest from market. No more ferrying food by hand.</div>`;
    } else {
      const fee = Math.round(logisticsFee(col) * 100);
      const orderRows = COLONY_SUPPLY.map(c => {
        const tgt = (col.orders && col.orders[c]) || 0;
        return `<tr><td>${COM[c].ico} ${COM[c].name}</td><td class="num">${fmt(col.storage[c] || 0)}</td>
          <td><div class="trade-controls"><input class="qty" id="auto-${c}" type="number" min="0" value="${tgt}" />
          <button class="btn btn-sm" onclick="setOrder('${c}')">Set auto</button></div></td></tr>`;
      }).join("");
      logi = `<div class="section-title">🚚 Logistics — Spaceport ${sp} · fee ${fee}% · ${logisticsCap(col)}/cycle</div>
        <div class="hint" style="margin-bottom:8px">Each cycle the network keeps these topped to target: first from surplus on your other colonies (free), then bought from market at +${fee}%. Set a target to 0 to stop importing it.</div>
        <table><thead><tr><th>Commodity</th><th class="num">In colony</th><th>Keep stocked to</th></tr></thead><tbody>${orderRows}</tbody></table>`;
    }
    here = `<div class="section-title">🏛️ Govern — ${planet.name}</div>
      <div class="cards">${govCard}</div>
      <div class="section-title">🏗️ Buildings</div>
      <div class="cards">${buildCards}</div>
      <div class="section-title">📦 Supplies (${colonyStorageUsed(col)}/${colonyStorageCap(col, planet)}) — feed & develop your colony</div>
      <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In colony</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${logi}`;
  }

  el.innerHTML = `<h2>Colonies</h2>
    <div class="subtitle">Found colonies on frontier worlds and grow them: build housing, farms, factories and labs, feed your people, set taxes, and watch the planet's industry & tech climb. Colonies live and grow every cycle — even while you're away.</div>
    <div class="section-title">🌍 Your Colonies</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

function renderAll() {
  if (typeof document === "undefined") return;
  renderResources(); renderShip(); renderGalaxy(); renderMarket();
  renderIndustry(); renderResearch(); renderMissions(); renderPolitics(); renderBases(); renderColonies(); renderRaid(); renderShipPanel(); renderLog();
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
/* ============================================================
   VERSION CHECK — poll the server for a newer build and tell the player
   whether refreshing will keep their saved game (credits, colonies, …).
   On each release, bump APP_VERSION here AND version.json to match. Bump
   SAVE_VERSION (and the SAVE_KEY suffix) ONLY when a release breaks old saves.
   ============================================================ */
const APP_VERSION = "1.0.0";
const SAVE_VERSION = "v2";                       // matches the suffix of SAVE_KEY below
// pure + testable: compare the running build to the server manifest
function versionStatus(local, server) {
  if (!server || !server.version) return { update: false };
  return {
    update: server.version !== local.version,
    version: server.version,
    notes: server.notes || "",
    keepsProgress: !server.saveVersion || server.saveVersion === local.saveVersion,
  };
}
function checkVersion() {
  if (typeof fetch !== "function") return;
  fetch("version.json?ts=" + Date.now(), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const st = versionStatus({ version: APP_VERSION, saveVersion: SAVE_VERSION }, data);
      if (st.update) showUpdateBanner(st);
    })
    .catch(() => {});
}
function showUpdateBanner(st) {
  if (typeof document === "undefined" || !document.body) return;
  let el = document.getElementById("update-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "update-banner";
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 14px;"
      + "background:#1e293b;color:#e2e8f0;border-top:2px solid var(--accent,#38bdf8);"
      + "font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 -4px 20px rgba(0,0,0,.4)";
    document.body.appendChild(el);
  }
  const keep = st.keepsProgress
    ? "✅ Your saved game — credits, colonies, reputation and all — will carry over."
    : "⚠️ This update changes the save format, so your current run may not carry over. Download your 📖 Log first to keep the story.";
  el.innerHTML = `<span>🔄 <b>A new version (${st.version}) is available.</b> ${st.notes ? st.notes + " " : ""}${keep}</span>`
    + `<span style="margin-left:auto;display:flex;gap:6px">`
    + `<button class="btn btn-sm btn-primary" onclick="location.reload()">Refresh now</button>`
    + `<button class="btn btn-sm" onclick="document.getElementById('update-banner').remove()">Later</button>`
    + `</span>`;
}
const REPO_URL = "https://github.com/alma92350/SpaceExploration";
function helpHTML() {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">❓ How to Play — Stellar Frontier</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleHelp()">✕ Close</button>
    </div>
    <p style="opacity:.85">Carve your legacy across a contested star sector — as a <b>Trader</b>, <b>Explorer</b>, <b>Colonial Founder</b>, <b>Politician</b> or <b>Pirate</b>. Your career is whatever you make of it; you can switch and mix freely.</p>

    <h4>The basics</h4>
    <ul style="line-height:1.6;margin:0 0 6px 18px;padding:0">
      <li>Each cycle you have a handful of <b>actions</b>; most things (travel, mine, lobby, raid) cost one. Hit <b>End Cycle</b> to advance time — prices drift, colonies grow, crises tick.</li>
      <li><b>Travel</b> between worlds costs fuel and advances a cycle. Buy low, sell high; large trades move the market.</li>
      <li>Resources are <b>finite</b>: over-mining a world depletes it and raises prices. Industry breeds <b>pollution</b> and <b>climate stress</b> — so spreading to fresh worlds pays off.</li>
      <li>Win by completing your <b>Legacy goals</b> (see the 🎯 Missions tab) or by rising to a career capstone (Consul, Pirate Lord, Sector Marshal…).</li>
    </ul>

    <h4>The tabs</h4>
    <ul style="line-height:1.55;margin:0 0 6px 18px;padding:0">
      <li>🪐 <b>Galaxy</b> — travel, explore, watch worlds, factions & crises.</li>
      <li>💱 <b>Market</b> — trade goods; black market for contraband; aid or profiteer during crises.</li>
      <li>🏭 <b>Industry</b> — refine raw materials into finished goods.</li>
      <li>🔬 <b>Research</b> — unlock technologies.</li>
      <li>🎯 <b>Missions</b> — time-bound contracts, long-term career missions, and your legacy goals.</li>
      <li>🏛️ <b>Politics</b> — factions, influence, elections, the Senate and trade law.</li>
      <li>🏗️ <b>Bases</b> — automated off-world production.</li>
      <li>🌍 <b>Colonies</b> — found and grow worlds: population, power and full industry chains.</li>
      <li>⚔️ <b>Raider</b> — prey on shipping (Wanted/Dread, havens, marques) or hunt pirates for lawful bounties; resolve ambushes & interdictions.</li>
      <li>🚀 <b>Ship</b> — outfit your ship with upgrade modules.</li>
    </ul>

    <h4>Header buttons</h4>
    <p style="margin:0 0 6px 0">⟲ <b>New</b> / 🌍 <b>Colonize</b> start fresh runs · 📖 <b>Log</b> downloads your captain's log (a dossier you can hand to an AI to write your biography or a novel).</p>

    <h4>Links</h4>
    <p style="margin:0">
      <a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📦 GitHub repository</a> ·
      <a href="${REPO_URL}/issues" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">🐞 Report a bug / request a feature</a> ·
      <a href="${REPO_URL}#readme" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📖 README</a>
    </p>
    <p style="opacity:.6;font-size:12px;margin-top:10px">Stellar Frontier v${typeof APP_VERSION!=="undefined"?APP_VERSION:""} · made with Claude. Tip: press <b>Esc</b> to close.</p>
  `;
}
function toggleHelp() {
  if (typeof document === "undefined" || !document.body) return;
  const existing = document.getElementById("help-overlay");
  if (existing) { existing.remove(); return; }
  const el = document.createElement("div");
  el.id = "help-overlay";
  el.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.80);display:flex;"
    + "align-items:center;justify-content:center;padding:20px";
  el.innerHTML = `<div style="max-width:680px;max-height:85vh;overflow:auto;background:#0f172a;`
    + `border:1px solid var(--accent,#38bdf8);border-radius:12px;padding:22px 24px;color:#e2e8f0;`
    + `box-shadow:0 20px 60px rgba(0,0,0,.6)" onclick="event.stopPropagation()">${helpHTML()}</div>`;
  el.addEventListener("click", () => el.remove());            // click backdrop to dismiss
  document.body.appendChild(el);
}
function startVersionWatch() {
  if (typeof window === "undefined") return;
  checkVersion();                                          // once on load
  setInterval(checkVersion, 5 * 60 * 1000);                // every 5 minutes
  window.addEventListener("focus", checkVersion);          // and whenever the player returns
  window.addEventListener("keydown", e => { if (e.key === "Escape") { const h = document.getElementById("help-overlay"); if (h) h.remove(); } });
}
const SAVE_KEY = "stellar-frontier-save-v2";
/* ---- Captain's Log: export a narrative dossier for an LLM ---- */
function playerArchetype() {
  const P = S.pirate || {}, nCol = Object.keys(S.colonies || {}).length;
  if (S.legacyTitle) return S.legacyTitle;
  if (S.office >= 2 || (S.orgs && S.orgs.party)) return "Politician";
  if ((P.raids || 0) >= 8 || (P.plundered || 0) >= 20000) return "Pirate";
  if (nCol >= 1) return "Colonial Founder";
  const visited = Object.keys(S.visited || {}).length;
  if (visited >= 8) return "Explorer";
  return "Free Trader";
}
function buildJournalText() {
  const L = [];
  const arche = playerArchetype();
  L.push(`# Captain's Log — ${arche}`);
  L.push(`*S.S. Wanderer · Cycle ${S.turn}*`);
  L.push("");
  L.push("> A chronicle of one captain's passage through the sector. Hand this");
  L.push("> dossier to an AI (e.g. Anthropic's Claude) with the prompt at the end");
  L.push("> to spin it into a biography or a novel.");
  L.push("");

  // A self-contained primer so an AI with no knowledge of this game can write faithfully
  L.push("## The Universe (a primer for the storyteller)");
  L.push("*This is an invented science-fiction setting; everything you need is below.*");
  L.push("");
  L.push("**The setting.** A single contested star sector on the frontier of known space, generations after the great expansion. A scatter of worlds — garden capitals, ice moons, mining hells, gas giants, ancient ruins and untamed frontiers — strung along fuel-hungry jump lanes, with no single power fully in control. The protagonist commands a lone starship, the *S.S. Wanderer*, and rises by any mix of trade, exploration, colonization, politics and outright piracy.");
  L.push("");
  L.push("**The five powers.** The Core Authority (lawful inner-world government), the Mining Guild (ore and heavy industry), the Agri-Combine (food and fair trade), the Tech Syndicate (electronics, research and discreet dealings) and the Frontier Coalition (the free, smuggler-friendly rim). The captain's standing with each is listed under *The Powers*.");
  L.push("");
  L.push("**Time & money.** Time is measured in *cycles*; every dated entry below is a cycle. Money is *credits* (cr).");
  L.push("");
  L.push("**The economy.** Worlds trade commodities along a production chain: raw materials (ore, ice, biomass, gas, crystals, radioactives, spice, relics) are refined (metals, energy, fuel, chemicals, medicine) and built into components (alloys, electronics) and finished goods (consumer goods, machinery, weapons, luxuries, antimatter). Prices float with local supply, demand, industry and law, and big deals move the market.");
  L.push("");
  L.push("**Resources & ecology.** Deposits are finite: mining drains a world's reserves and its yields fall, so over-exploitation makes goods scarce and dear; left alone, worlds slowly recover. Industry breeds *pollution*, and the sector's aggregate pollution drives a *climate stress* that withers farms everywhere — a constant pressure to settle fresh worlds rather than bleed the old ones dry.");
  L.push("");
  L.push("**Crises.** Disasters strike worlds — earthquakes, volcanic eruptions, plagues, industrial accidents, civil unrest, famines, mine collapses — disrupting them and spiking the prices of what they suddenly need. A captain may bring relief and earn a people's gratitude, or profiteer from their desperation.");
  L.push("");
  L.push("**Terms used in the chronicle.**");
  L.push("- *Reputation*: standing with a faction (allied → friendly → neutral → resentful → hostile).");
  L.push("- *Influence* (political capital); *Popularity* & *Legitimacy* (a politician's public support and lawful mandate); *Heat* (official scrutiny that invites investigation); *Office* (rank won by election, appointment or force, from Councillor up to Consul).");
  L.push("- *Wanted* (how hard the law hunts you); *Dread* (how feared you are as a pirate); *Haven* (a hidden pirate base); *Letter of marque* (a licence to raid a faction's rivals legally).");
  L.push("- *Colony* (a world you settle and grow — population, happiness, industry); *Reserves* (a deposit's remaining stock); *Pollution / Climate* (the ecological harm left behind).");
  L.push("");

  // The setting
  L.push("## The Sector");
  PLANETS.filter(isActive).forEach(p => {
    const deps = Object.keys(p.deposits || {}).map(c => `${COM[c].name} ${Math.round(reserveFrac(p.id, c) * 100)}%`).join(", ") || "none";
    const law = p.enforce > 0.7 ? "strict law" : p.enforce < 0.25 ? "lawless" : "patrolled";
    const tags = [];
    if (S.colonies && S.colonies[p.id]) tags.push(`YOUR COLONY (pop ${Math.round(S.colonies[p.id].pop)}k)`);
    if (S.crises && S.crises[p.id]) tags.push(`in crisis: ${CRISES[S.crises[p.id].type].name}`);
    const poll = pollutionOf(p.id);
    if (poll >= 25) tags.push(`${poll >= 60 ? "heavily polluted" : "polluted"}`);
    L.push(`- **${p.name}** (${p.tag}; ${FACTIONS[p.faction].name}; ${law}) — deposits: ${deps}.${tags.length ? " " + tags.join("; ") + "." : ""}`);
  });
  L.push("");

  // The powers
  L.push("## The Powers (factions & your standing)");
  Object.keys(FACTIONS).forEach(f => {
    const r = Math.round(S.rep[f] || 0);
    const word = r >= 50 ? "allied" : r >= 20 ? "friendly" : r <= -50 ? "hostile" : r <= -20 ? "resentful" : "neutral";
    L.push(`- ${FACTIONS[f].name}: ${word} (${r}). ${FACTIONS[f].desc}`);
  });
  L.push("");

  // Where the captain stands
  L.push("## The Captain, at Cycle " + S.turn);
  L.push(`- Path: **${arche}**${S.legacyTitle ? ` — legend earned: *${S.legacyTitle}*` : ""}`);
  L.push(`- Wealth: ${fmt(S.res.credits)} cr on hand · net worth ${fmt(netWorth())} cr`);
  if (S.office && typeof currentOffice === "function" && currentOffice()) L.push(`- Office: ${currentOffice().name} (popularity ${Math.round(S.pol.popularity)}, legitimacy ${Math.round(S.pol.legitimacy)})`);
  const P = S.pirate || {};
  if ((P.raids || 0) > 0 || (P.dread || 0) > 0) L.push(`- Outlaw record: ${P.raids} raids, ${fmt(P.plundered)} cr plundered, Wanted ${P.wanted}, Dread ${P.dread}${S.haven ? `, haven at ${PLANETS.find(p => p.id === S.haven.planet).name}` : ""}`);
  const cols = Object.keys(S.colonies || {});
  if (cols.length) L.push(`- Colonies founded: ${cols.map(id => PLANETS.find(p => p.id === id).name).join(", ")}`);
  const techn = Object.keys(S.techs || {}).filter(t => S.techs[t]).length;
  L.push(`- Voyages: ${S.stats.jumps} jumps · ${S.stats.trades} trades · ${techn} technologies · sector climate stress ${Math.round(S.climate || 0)}`);
  L.push("");

  // The chronicle
  L.push("## The Chronicle");
  const j = S.journal || [];
  if (!j.length) L.push("*(No entries yet — the voyage has only just begun.)*");
  else j.forEach(e => L.push(`- **Cycle ${e.turn}.** ${e.text}`));
  L.push("");

  // The ask
  L.push("---");
  L.push("## Prompt for your AI storyteller");
  L.push("```");
  L.push(`You are a science-fiction novelist. Using the captain's log above —`);
  L.push(`the sector, the factions, the captain's standing, and the chronicle of`);
  L.push(`events — write the biography of this ${arche.toLowerCase()} of the stars.`);
  L.push(`Stay faithful to the recorded events, names and worlds; invent the`);
  L.push(`inner life, dialogue and texture around them. Give it a title.`);
  L.push("```");
  return L.join("\n");
}
function downloadJournal() {
  const text = buildJournalText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Journal export unavailable here.", "bad");
    return text;
  }
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `captains-log-cycle-${S.turn}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Captain's log downloaded.", "good");
  return text;
}
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} }
function loadGame() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { S = JSON.parse(raw); return true; } } catch (e) {}
  return false;
}
function newGame(mode) {
  const colony = mode === "colony", politics = mode === "politics";
  const msg = colony
    ? "Start in Colonization mode? You'll skip the trading phase and begin on a frontier world with the Colonial Charter, the capital and the materials to found your first colony right away. Current progress will be lost."
    : politics
    ? "Start in Politics mode? You'll skip the trading grind and begin as a fledgling politician — with the Galactic Charter, a campaign chest, some influence and your own party. Current progress will be lost."
    : "Start a new game? Current progress will be lost.";
  if (typeof confirm === "function" && !confirm(msg)) return;
  S = freshState({ colonyStart: colony, politicsStart: politics }); rollPrices();
  if (colony) {
    log(`🌍 Colonization charter granted. You arrive at <span class="c">${currentPlanet().name}</span> with capital and supplies — found your first colony.`, "event");
  } else if (politics) {
    log(`🏛️ You enter public life at <span class="c">${currentPlanet().name}</span> — a charter, a war chest and a party of your own. Build your machine.`, "event");
  } else {
    log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`);
  }
  jotOpening(colony ? "colony" : politics ? "politics" : "trade");
  saveGame(); renderAll(); setTab(colony ? "colonies" : politics ? "politics" : "galaxy");
}
function jotOpening(mode) {
  const p = currentPlanet();
  const worlds = PLANETS.filter(isActive).map(x => x.name).join(", ");
  const intro = mode === "colony" ? "granted a Colonization charter to tame a frontier world"
    : mode === "politics" ? "entering public life with a party and a war chest"
    : "a free trader with a ship and a dream";
  jot(`The voyage begins at ${p.name} — ${intro}. The charted sector: ${worlds}.`, "origin");
}
function init() {
  if (!loadGame()) { S = freshState(); rollPrices(); log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`); jotOpening("trade"); }
  if (!S.prices || !S.prices[S.location]) rollPrices();
  if (!S.bases) S.bases = {};   // backfill for older saves
  if (!S.colonies) S.colonies = {};
  Object.values(S.colonies).forEach(c => { if (!c.orders) c.orders = {}; if (c.unrest == null) c.unrest = 0; });
  if (!S.discovered) S.discovered = {};
  if (!S.contracts) { S.contracts = []; S.contractSeq = S.contractSeq || 0; }
  if (!S.pol) S.pol = { popularity: 0, legitimacy: 0, heat: 0, slush: 0 };  // backfill politics meters
  if (!S.orgs) S.orgs = {};
  if (!S.policies) S.policies = {};
  if (S.floor === undefined) S.floor = null;
  if (!S.planetLaws) S.planetLaws = {};
  if (S.invest === undefined) S.invest = null;
  if (S.jail == null) S.jail = 0;
  if (S.office == null) S.office = S.perks.governor ? 3 : S.perks.senator ? 2 : 0;  // migrate from old perks
  if (S.term == null) S.term = 0;
  if (S.officePath === undefined) S.officePath = null;
  if (S.legacyTitle === undefined) S.legacyTitle = null;
  if (!S.reserves) S.reserves = {};
  if (!S.crises) S.crises = {};
  if (!S.journal) S.journal = [];
  if (!S.pirates) S.pirates = {};
  if (S.pirateCalm == null) S.pirateCalm = 0;
  if (S.encounter === undefined) S.encounter = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  if (!S.pollution) S.pollution = {};
  if (S.climate == null) S.climate = 0;
  if (!S.pirate) S.pirate = { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0 };
  if (S.pirate.commissionsDone == null) S.pirate.commissionsDone = 0;
  if (S.prey === undefined) S.prey = null;
  if (S.interdiction === undefined) S.interdiction = null;
  if (S.haven === undefined) S.haven = null;
  if (S.commission === undefined) S.commission = null;
  UPGRADES.forEach(u => { if (S.upgrades[u.id] == null) S.upgrades[u.id] = 0; });  // backfill new upgrades (cannons)
  syncObjectives();
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());
  const brand = document.querySelector(".brand");
  const ng = document.createElement("button");
  ng.className = "btn btn-sm"; ng.style.marginLeft = "8px"; ng.textContent = "⟲ New"; ng.title = "New game (trading start)";
  ng.addEventListener("click", () => newGame()); brand.appendChild(ng);
  const nc = document.createElement("button");
  nc.className = "btn btn-sm"; nc.style.marginLeft = "6px"; nc.textContent = "🌍 Colonize"; nc.title = "New game — skip trading, start ready to colonize";
  nc.addEventListener("click", () => newGame("colony")); brand.appendChild(nc);
  const nj = document.createElement("button");
  nj.className = "btn btn-sm"; nj.style.marginLeft = "6px"; nj.textContent = "📖 Log"; nj.title = "Download your captain's log — a narrative dossier you can hand to an AI to write your biography or a novel";
  nj.addEventListener("click", () => downloadJournal()); brand.appendChild(nj);
  const nh = document.createElement("button");
  nh.className = "btn btn-sm"; nh.style.marginLeft = "6px"; nh.textContent = "❓ Help"; nh.title = "How to play, and links to the project";
  nh.addEventListener("click", () => toggleHelp()); brand.appendChild(nh);
  // (No header button for a politics start — careers switch freely in-game; the
  //  Politics tab offers an "Enter Public Life" kickstart instead.)
  renderAll(); setTab("galaxy");
  startVersionWatch();
}
window.addEventListener("DOMContentLoaded", init);

Object.assign(window, {
  travel, buyQty, sellQty, buyMax, sellAll, extract, salvage, produce,
  research, researchTech, doPolitics, doMission, buyUpgrade, setDecree,
  buildBase, buildModule, depositQty, withdrawQty, storeAllCargo, fulfilContract,
  colonize, buildColonyBuilding, setTax, colonyDeposit, colonyWithdraw, setOrder, explore, newGame,
  foundOrg, upgradeOrg, runOrgAbility,
  proposeBill, lobbyFaction, bribeFaction, callVote, repealPolicy,
  investLawyer, investBribe, investSpin, investBury, investStrongarm, investScapegoat, faceTrial,
  runForElection, seekAppointment, stageCoup, lobbyLaw, enterPublicLife,
  donateRelief, donateReliefQty, gougeSell, gougeSellQty, lootCrisis, downloadJournal,
  prowl, raidAttack, raidNoQuarter, raidExtort, raidDisengage, repairShip,
  navyBribe, navyFight, navySurrender, settleWarrants,
  fence, fenceAll, fenceQty, fenceAllPlunder,
  establishHaven, upgradeHaven, layLow, havenStashAll, havenTakeAll,
  acceptCommission, pirateLegacy, marshalLegacy, checkVersion, toggleHelp,
  huntPirates, encounterPay, encounterFlee, encounterFight,
});

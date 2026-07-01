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
  drones:      { name: "Combat Drones",  ico: "🛸", tier: "Component", base: 140 },
  ai:          { name: "AI Cores",       ico: "🧠", tier: "Strategic", base: 380,
                 illegalAt: ["terra", "verdani"] },
  antimatter:  { name: "Antimatter",     ico: "🌀", tier: "Strategic", base: 420,
                 illegalAt: ["terra", "verdani", "kybernet", "forge", "glacius"], hazard: true },
};
const COM_IDS = Object.keys(COM);
const CARGO_IDS = COM_IDS.filter(id => !COM[id].isFuel); // everything except fuel uses the ship's cargo hold
const STORE_IDS = CARGO_IDS.concat(["fuel"]);            // base/colony storage & the trade network also hold/move fuel
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
  { id: "dronefab",out: "drones",      qty: 1, in: { alloys: 1, electronics: 1, energy: 1 }, req: "dronetech",  kind: "make" },
  { id: "aifab",   out: "ai",          qty: 1, in: { electronics: 2, crystals: 1, energy: 3 }, req: "aicores",   kind: "make" },
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
  { id: "armor",   name: "Armor Plating",      ico: "🦾", tiers: 3, baseCost: 1700, costMul: 2.4,
    desc: "Ablative plate — blunts KINETIC fire from cannons and mass drivers.", effect: t => `-${t*12}% kinetic damage` },
  { id: "pointdef", name: "Point-Defense Grid", ico: "📡", tiers: 3, baseCost: 1900, costMul: 2.4,
    desc: "Flak screens & interceptors — swats GUIDED torpedoes and enemy drones.", effect: t => `-${t*12}% guided damage` },
  { id: "dronebay", name: "Drone Bay",          ico: "🛸", tiers: 3, baseCost: 2200, costMul: 2.4,
    desc: "Launch racks for Combat Drones — deploys up to 2 per tier each battle (needs Swarm Robotics).", effect: t => `deploys ${t*2} drones` },
  { id: "aimain",  name: "AI Mainframe",        ico: "🧠", tiers: 3, baseCost: 2600, costMul: 2.5,
    desc: "Shipboard machine mind — free Deep Scans, smarter drones, sharper escapes (needs Machine Minds).", effect: t => `scan free · drones +${t*30}% · flee +${t*8}%` },
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
  { id: "energyweapons", name: "Coherent Beam Arrays", cost: 80, ico: "⚡", req: ["weapontech"],
    desc: "Unlock Energy Lances — beam weapons that burn through armor (ammo: energy)." },
  { id: "torpedoes", name: "Fusion Torpedoes", cost: 110, ico: "☢️", req: ["weapontech", "reactors"],
    desc: "Unlock torpedo salvos — devastating, but point-defense can swat them (ammo: radioactives + metals)." },
  { id: "dronetech", name: "Swarm Robotics", cost: 120, ico: "🛸", req: ["electronics"],
    desc: "Unlock Combat Drones: fabrication, the Drone Bay, and drone swarms in battle." },
  { id: "aicores", name: "Machine Minds", cost: 150, ico: "🧠", req: ["dronetech"],
    desc: "Unlock AI Cores, colony Datacenters and the shipboard AI Mainframe." },
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
    { id: "fuelrefinery", name: "Fuel Refinery", ico: "⛽", tiers: 5, baseCost: 2800, costMul: 1.8, produces: "fuel", consumes: "ice", refiner: true,
      desc: "Cracks stored 🧊 Ice into ⛽ Fuel every cycle — buildable anywhere (keep ice in the depot)." },
  ];
  Object.keys(planet.deposits || {}).forEach(c => {
    const meta = BASE_EXTRACTORS[c] || { name: "Extractor: " + COM[c].name, ico: COM[c].ico };
    list.push({ id: "ext_" + c, name: meta.name, ico: meta.ico, tiers: 5, baseCost: 3000, costMul: 1.8,
      produces: c, extractor: true,
      desc: `Auto-harvests ${COM[c].name} every cycle (deposit ${planet.deposits[c]}×).` });
  });
  return list;
}
const REFINERY_RATE = 5;          // fuel/cycle per tier (capped by stored ice)
const REFINERY_ICE_PER_FUEL = 1.5; // ice cracked per unit of fuel (mirrors the crackice recipe, 3:2)
function moduleOutput(planet, mod, tier) {
  if (tier <= 0 || !mod.produces) return 0;
  if (mod.refiner) return tier * REFINERY_RATE;   // nominal cap (actual run limited by ice on hand)
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
    { id: "fuelrefinery", name: "Fuel Refinery", ico: "⛽", tiers: 6, baseCost: 2600, costMul: 1.6, pollute: 0.1,
      recipe: { in: { ice: 2, energy: 1 }, out: "fuel", outQty: 2, rate: 3, stage: 2 },
      desc: "Cracks Ice into Fuel (consumes Energy) — order in Ice and export the Fuel." },
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
    { id: "drone_works", name: "Drone Works", ico: "🛸", tiers: 5, baseCost: 3600, costMul: 1.7, req: "dronetech", pollute: 0.2,
      recipe: { in: { alloys: 1, electronics: 1, energy: 1 }, out: "drones", outQty: 1, rate: 2, stage: 4 },
      desc: "Assembles Combat Drones from Alloys + Electronics — ammunition for your Drone Bay, and a hot export." },
    { id: "datacenter", name: "Datacenter", ico: "🧠", tiers: 5, baseCost: 4400, costMul: 1.75, req: "aicores", pollute: 0.1,
      tech: 1, recipe: { in: { electronics: 1, energy: 3 }, out: "ai", outQty: 1, rate: 1, stage: 4 },
      desc: "+1 tech per tier. Trains AI Cores from Electronics + Energy — the sector&#39;s machine-mind economy runs on these." },
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
    { id: "shipyard",  name: "Shipyard",        ico: "🏗️", tiers: 4, baseCost: 5000, costMul: 1.8, req: "metallurgy",
      desc: "Builds your own ships — freighters &amp; warships — in the ✦ Fleet tab. Higher tiers lay down bigger hulls (T1 corvette/light freighter → T4 battleship/bulk hauler) and add slipways for parallel builds." },
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
  if (["factory", "lab", "spaceport", "garrison", "shipyard", "reactor", "foundry", "fabricator",
       "machine_works", "luxury_atelier", "pharma_lab", "arms_factory", "antimatter_forge",
       "drone_works", "datacenter"].includes(def.id)
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
  return p.industry + (c.buildings.factory || 0) + Math.floor(c.pop / 12) + (c.faction === "miners" ? 1 : 0);
}
function effTech(p) {
  const c = S.colonies && S.colonies[p.id];
  if (!c) return p.tech;
  return p.tech + (c.buildings.lab || 0) + Math.floor(c.pop / 20) + (c.faction === "syndicate" ? 1 : 0);
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
    pirate: { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0, bountyKills: 0, bountyEarned: 0, subsys: { weapons: 100, shields: 100, engines: 100, sensors: 100 }, wuse: {} },  // outlaw career
    combat: { posture: "balanced", offense: 50, target: "hull", advanced: false },  // combat posture & targeting (UI-tunable)
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
    fx: [],                     // active Fortunes (temporary boons/banes): [{ key, cyclesLeft, ... }]
    signals: [],                // discoverable leads to investigate: [{ id, kind, tier, planet, ttl }]
    fxSeen: {},                 // Fortunes almanac: which effects you've experienced
    fxMastery: {},              // domains fully catalogued → permanent passive bonuses
    mandates: [],               // active pirate mandates: [{ id, bandId, planet, task, cyclesLeft, ... }]
    fleet: [],                  // your own ships built at colony shipyards: [{ id, key, home, status, hull, ... }]
    battleGroupPosture: "balanced",   // posture for a deployed fleet Battle Group in raids
    factionRel: {},              // sector relations: pairwise faction score, lazily seeded by ensureFactionRel
    pirates: {},                // pirate activity per world (0-5); hunted down, regrows in lawless space
    pirateCalm: 0,              // until this turn, pirate attacks are suppressed (you cleared the lanes)
    encounter: null,            // travel ambush: { level, strength, toll }
    pollution: {},              // per-planet industrial pollution 0–100
    climate: 0,                 // sector-wide climate stress 0–100 (smoothed mean pollution)
    visited: { [start]: true },
    log: [],
    stats: { jumps: 0, trades: 0, profit: 0, busts: 0, sales: 0 },
    journal: [],               // captain's log: persistent narrative chronicle
    unlocked: {},              // progressive disclosure: which tabs have been revealed
    disc: {},                  // feature disclosure flags (markets, galaxy, ...)
    made: {},                  // first-manufactured commodities (drives disclosure & objectives)
    showAllTabs: false,        // veteran toggle: reveal every tab at once
    sound: true,               // procedural SFX on/off
    pirateIntel: null,         // bought pirate-activity chart { worlds, until, scope }
    achieved: {},
    won: false,
  };
}

function cargoCap()  { return Math.max(20, BASE_CARGO + S.upgrades.cargo * 150 + (typeof fxAdd === "function" ? fxAdd("cargoBonus") : 0)); }
function fuelCap()   { return BASE_FUEL + S.upgrades.fueltank * 40; }
function cargoUsed() { return CARGO_IDS.reduce((s, id) => s + (S.res[id] || 0), 0); }
function cargoFree() { return cargoCap() - cargoUsed(); }
function currentPlanet() { return PLANETS.find(p => p.id === S.location); }
function actionsMax() { return Math.max(1, ACTIONS_PER_CYCLE + (typeof fxAdd === "function" ? fxAdd("actions") : 0)); }   // Fortunes can grant/sap actions
function actionsLeft() { return (S.jail > 0) ? 0 : actionsMax() - S.actionsUsed; }
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
/* The market maker's half-spread (as a fraction of the mid price). The Trade
   Computer and free-trade lanes tighten it, but it never reaches zero — so the
   player's BUY price is always strictly above the SELL price (no arbitrage). */
function tradeHalfSpread() {
  let h = 0.10 - S.upgrades.trade * 0.012;
  if (policyActive("freetrade")) h -= 0.02;
  return Math.max(0.04, h);
}
/* the local mid price, including policy/decree level shifts that move BOTH the
   buy and sell sides together (a commodity is simply worth more/less here). */
function marketMid(pid, c) {
  let mid = S.prices[pid][c];
  if (policyActive("tariff")) mid *= 1.05;                          // protectionism lifts local prices
  if (policyActive("mining") && COM[c].tier === "Raw") mid *= 1.10; // raw-material windfall
  if (S.decrees.tariff === c) mid *= 1.07;                          // your governor's tariff
  return mid;
}
// faction standing tightens YOUR side of the spread (better buy & sell), bounded
// so it can never flip buy below sell.
function repSpreadBonus(p, h) { return Math.max(-0.8 * h, Math.min(0.8 * h, repPriceFactor(p))); }
function buyPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  const h = tradeHalfSpread();
  return Math.max(2, Math.round(marketMid(pid, c) * (1 + h - repSpreadBonus(p, h)) * (1 - fxAdd("buyDisc"))));  // friendly/Fortunes → buy cheaper
}
function sellPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  const h = tradeHalfSpread();
  const raw = Math.round(marketMid(pid, c) * (1 - h + repSpreadBonus(p, h)) * (1 + fxAdd("sellPrem")));   // friendly/Fortunes → sell dearer
  return Math.max(1, Math.min(raw, buyPrice(pid, c) - 1));                              // always at least 1 below buy (rounding-proof: no arbitrage)
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
/* ============================================================
   SOUND — procedural SFX via the Web Audio API. No asset files: every sound
   is synthesized from oscillators/noise, gated behind a mute toggle. Fully
   headless-safe (no-ops where AudioContext is unavailable, e.g. tests).
   ============================================================ */
let _audio = null, _lastSfx = 0;
function soundOn() { return !(typeof S !== "undefined" && S && S.sound === false); }   // default on
function audioCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!_audio) { try { _audio = new AC(); } catch (e) { return null; } }
  return _audio;
}
function _tone(ac, t0, o) {
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
  const vol = o.gain == null ? 0.2 : o.gain;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + o.dur + 0.02);
}
function _noise(ac, t0, dur, gain) {
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = ac.createBufferSource(); src.buffer = buf;
  const g = ac.createGain(); g.gain.value = gain == null ? 0.25 : gain;
  src.connect(g).connect(ac.destination); src.start(t0);
}
function sfx(name) {
  if (!soundOn()) return;
  const ac = audioCtx(); if (!ac) return;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - _lastSfx < 45) return;             // debounce bursts so events don't pile into noise
  _lastSfx = now;
  try {
    if (ac.state === "suspended") ac.resume();
    const t = ac.currentTime;
    switch (name) {
      case "good":    _tone(ac, t, { type: "triangle", f0: 660, f1: 990, dur: 0.12, gain: 0.18 }); break;
      case "event":   _tone(ac, t, { type: "sine", f0: 880, dur: 0.12, gain: 0.16 }); break;
      case "bad":     _tone(ac, t, { type: "sawtooth", f0: 200, f1: 90, dur: 0.22, gain: 0.18 }); break;
      case "buy":     _tone(ac, t, { type: "square", f0: 520, dur: 0.05, gain: 0.12 }); _tone(ac, t + 0.06, { type: "square", f0: 780, dur: 0.07, gain: 0.12 }); break;
      case "sell":    _tone(ac, t, { type: "square", f0: 780, dur: 0.05, gain: 0.12 }); _tone(ac, t + 0.06, { type: "square", f0: 1040, dur: 0.07, gain: 0.12 }); break;
      case "fire":    _tone(ac, t, { type: "sawtooth", f0: 900, f1: 180, dur: 0.14, gain: 0.15 }); break;
      case "explode": _noise(ac, t, 0.35, 0.30); _tone(ac, t, { type: "sawtooth", f0: 160, f1: 50, dur: 0.35, gain: 0.16 }); break;
      case "travel":  _tone(ac, t, { type: "sine", f0: 220, f1: 660, dur: 0.4, gain: 0.14 }); break;
      case "repair":  _tone(ac, t, { type: "square", f0: 300, dur: 0.04, gain: 0.1 }); _tone(ac, t + 0.07, { type: "square", f0: 300, dur: 0.04, gain: 0.1 }); _tone(ac, t + 0.14, { type: "square", f0: 380, dur: 0.06, gain: 0.1 }); break;
      case "win":     [523, 659, 784, 1047].forEach((f, i) => _tone(ac, t + i * 0.1, { type: "triangle", f0: f, dur: 0.18, gain: 0.18 })); break;
      case "alarm":   _tone(ac, t, { type: "square", f0: 740, f1: 520, dur: 0.16, gain: 0.16 }); _tone(ac, t + 0.18, { type: "square", f0: 740, f1: 520, dur: 0.16, gain: 0.16 }); break;
      case "salvo":   _tone(ac, t, { type: "sawtooth", f0: 1000, f1: 160, dur: 0.18, gain: 0.16 }); _noise(ac, t, 0.18, 0.12); break;
      case "promote": [523, 784, 1047, 1319].forEach((f, i) => _tone(ac, t + i * 0.08, { type: "triangle", f0: f, dur: 0.14, gain: 0.17 })); break;
      case "click":   _tone(ac, t, { type: "square", f0: 440, dur: 0.03, gain: 0.08 }); break;
      default:        _tone(ac, t, { type: "sine", f0: 660, dur: 0.08, gain: 0.12 });
    }
  } catch (e) {}
}
function soundLabel() { return (typeof S !== "undefined" && S && S.sound === false) ? "🔇 Sound" : "🔊 Sound"; }
function toggleSound() {
  S.sound = S.sound === false ? true : false;
  if (S.sound) { _lastSfx = 0; sfx("event"); }
  const btn = typeof document !== "undefined" && document.getElementById("soundToggleBtn");
  if (btn) btn.textContent = soundLabel();
  if (typeof toast === "function") toast(S.sound ? "🔊 Sound on" : "🔇 Sound off", "");
  if (typeof saveGame === "function") saveGame();
}
function einkLabel() { return (typeof S !== "undefined" && S && S.eink) ? "🌙 Color mode" : "📖 E-ink mode"; }
function applyEink() {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle("eink", !!(typeof S !== "undefined" && S && S.eink));
}
function toggleEink() {
  S.eink = !S.eink;
  applyEink();
  const btn = typeof document !== "undefined" && document.getElementById("einkToggleBtn");
  if (btn) btn.textContent = einkLabel();
  if (typeof toast === "function") toast(S.eink ? "📖 E-ink mode — high contrast for e-readers" : "🌙 Color mode", "");
  if (typeof saveGame === "function") saveGame();
}
function toast(msg, type = "") {
  if (type === "good") sfx("good"); else if (type === "bad") sfx("bad"); else if (type === "event") sfx("event");
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
  sfx("win");
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
  if (!S.unlocked) { S.unlocked = {}; checkUnlocks(true); }   // veterans keep everything they've earned, silently
  if (S.showAllTabs == null) S.showAllTabs = false;
  if (S.sound == null) S.sound = true;
  if (S.eink == null) S.eink = false;
  if (S.pirateIntel === undefined) S.pirateIntel = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  if (S.res && S.res.drones == null) S.res.drones = 0;
  if (S.res && S.res.ai == null) S.res.ai = 0;
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
};
const PIRATE_INTEL_DURATION = 8;   // cycles of fresh intel per purchase
function pirateIntelActive() { return !!(S.pirateIntel && S.turn < S.pirateIntel.until); }
function pirateIntelKnows(pid) { return pid === S.location || (pirateIntelActive() && S.pirateIntel.worlds.indexOf(pid) >= 0); }
function buyPirateMap(scope) {
  const m = PIRATE_MAP[scope]; if (!m) return;
  if (S.res.credits < m.cost) return toast(`The ${m.name} costs ${fmt(m.cost)} cr.`, "bad");
  const here = currentPlanet();
  const worlds = PLANETS.filter(p => isActive(p) && !p.hidden && (p.id === here.id || (here.distances[p.id] || 0) <= m.ly)).map(p => p.id);
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
  S.prey = genPirate(pirateOpposition(lvl));
  bindBand(S.prey);                                       // this contact belongs to a (possibly known) band
  if (S.prey.elite) { log(`💀 ELITE contact: <span class="c">${S.prey.name}</span>${(S.prey.escorts || 0) > 0 ? ` and ${S.prey.escorts} escort(s)` : ""} — bounty ${fmt(S.prey.bounty)} cr. A dangerous mark.`, "event"); toast(`Elite raider: ${S.prey.name}!`, "event"); }
  else { log(`🎯 Pirate contact: a ${S.prey.ico} <span class="c">${S.prey.name}</span> — bounty ${fmt(S.prey.bounty)} cr on its head.`, "event"); toast(`Pirate sighted: ${S.prey.name}`, "event"); }
  afterAction();
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
  if (Math.random() < 0.05 + lvl * 0.045) {
    const pirate = genPirate(pirateOpposition(lvl, -1));
    pirate.toll = Math.round(300 * pirate.level + Math.min(2500, (S.res.credits + cargoValue()) * 0.04));
    S.encounter = pirate;
    log(`🏴‍☠️ Ambush! A ${pirate.ico} <span class="c">${pirate.name}</span> drops out of the dark off ${dest.name} and demands ${fmt(pirate.toll)} cr — or your cargo.`, "bad");
    toast(`Pirate ambush: ${pirate.name}!`, "bad");
    if (typeof announce === "function") announce("🏴‍☠️ Pirate Ambush", `A ${pirate.name} has you in its sights. Pay, run, or fight.`, false);
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
  const odds = (0.45 + S.upgrades.engine * 0.15 + (S.upgrades.aimain || 0) * 0.08 - e.level * 0.05) * condFactor("engines") * (0.7 + 0.3 * defenseMult());
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
/* ============================================================
   PIRATE BANDS — a persistent roster of named crews you build history with.
   Fighting them drops their collaboration (rep); allying, sparing, gifts and
   your fearsome dread raise it. Friendly bands accept smaller loot shares,
   rally readily, and can be hired as escorts. (Decisions: named bands, auto
   loot rate from rep+level+dread, rep via ally-calls/dread/credits/cargo/deeds.)
   ============================================================ */
const BAND_NAMES = ["Crimson Wake", "Hollow Star", "Ironjaw Pack", "Void Jackals", "Ashen Crows",
  "Rust Reapers", "Pale Mourners", "Gilded Vultures", "Black Tide", "Sable Lances", "Gravewind", "Salt Wolves"];
const BAND_TIERS = [
  { min: 76, key: "sworn", label: "👑 Sworn" },
  { min: 41, key: "friendly", label: "🤝 Friendly" },
  { min: -10, key: "neutral", label: "😐 Neutral" },
  { min: -40, key: "wary", label: "🤨 Wary" },
  { min: -101, key: "hostile", label: "☠️ Hostile" },
];
// Personalities flavour how a band haggles, hires and holds the line.
const BAND_PERSONALITIES = {
  greedy:    { ico: "🤑", name: "Greedy",    cut: 0.06,  fee: 1.25, betray: 0.08,  fp: 1.0,  steal: true },
  loyal:     { ico: "🛡️", name: "Loyal",     cut: -0.03, fee: 0.90, betray: -0.14, fp: 1.0,  steal: false },
  bold:      { ico: "⚔️", name: "Bold",      cut: 0.0,   fee: 1.05, betray: 0.02,  fp: 1.22, steal: false },
  cunning:   { ico: "🦊", name: "Cunning",   cut: 0.02,  fee: 1.0,  betray: 0.05,  fp: 1.0,  steal: true },
  honorable: { ico: "⚖️", name: "Honorable", cut: -0.02, fee: 1.0,  betray: -0.20, fp: 1.06, steal: false },
};
const BAND_PERS_KEYS = Object.keys(BAND_PERSONALITIES);
function bandPers(b) { return BAND_PERSONALITIES[(b && b.pers)] || BAND_PERSONALITIES.bold; }
function ensureBands() { if (!S.pirateBands) S.pirateBands = {}; return S.pirateBands; }
function bandList() { return Object.values(ensureBands()).filter(b => b.status !== "dead"); }
function bandById(id) { return ensureBands()[id] || null; }
function bandTier(b) { const r = (b && b.rep) || 0; return BAND_TIERS.find(t => r >= t.min) || BAND_TIERS[BAND_TIERS.length - 1]; }
function bandRepAdd(b, n) { if (!b) return; b.rep = Math.max(-100, Math.min(100, Math.round((b.rep || 0) + n))); }
function bandFoe(b) { return b && b.feudWith ? bandById(b.feudWith) : null; }
function newBand(level) {
  ensureBands();
  const used = new Set(Object.values(S.pirateBands).map(b => b.name));
  const name = BAND_NAMES.filter(n => !used.has(n))[0] || ("Free Company " + (Object.keys(S.pirateBands).length + 1));
  const lvl = Math.max(1, Math.min(5, level || rint(1, 3)));
  const id = "b" + (S.turn || 0) + "_" + Object.keys(S.pirateBands).length + "_" + Math.floor(Math.random() * 1000);
  const b = { id, name, ico: (PIRATE_RANKS[lvl] || PIRATE_RANKS[1]).ico, level: lvl, rep: 0, pers: pick(BAND_PERS_KEYS),
    encounters: 0, fought: 0, allied: 0, gifted: 0, lastSeen: S.turn || 0, status: "active", feudWith: null,
    tag: null, loc: (PLANETS.filter(isActive)[Math.floor(Math.random() * Math.max(1, PLANETS.filter(isActive).length))] || PLANETS[0]).id,
    inboundTurn: null, onCallUntil: 0, busyUntil: 0, follow: false, followUntil: 0 };
  S.pirateBands[id] = b;
  // some crews are blood rivals with an existing band — they won't serve together
  const others = Object.values(S.pirateBands).filter(o => o.id !== id && !o.feudWith && o.status !== "dead");
  if (others.length && Math.random() < 0.35) { const rival = pick(others); const d = rint(1, 3); b.feudWith = rival.id; b.feudDepth = d; rival.feudWith = id; rival.feudDepth = d; }
  return b;
}
// tie a transient foe/ally to a band identity (reuse known crews so history accrues)
function bindBand(foe, preferAlly) {
  if (!foe || foe.bandId) return bandById(foe && foe.bandId);
  const pool = bandList();
  let b = null;
  if (pool.length && Math.random() < 0.6) {
    if (preferAlly) { const friendly = pool.filter(x => (x.rep || 0) > -40); if (friendly.length) b = friendly.sort((a, c) => (c.rep || 0) - (a.rep || 0))[0]; }
    if (!b) b = pool[Math.floor(Math.random() * pool.length)];
  }
  if (!b) b = newBand(foe.level || rint(1, 3));
  foe.bandId = b.id; foe.bandName = b.name;
  b.encounters++; b.lastSeen = S.turn || 0; b.loc = S.location || b.loc;   // last seen here
  return b;
}
// the cut an allied band demands of the loot — stronger want more, friends & your dread shave it
function bandLootShare(b) {
  let s = 0.18 + (b ? b.level : 2) * 0.04;
  s -= ((b && b.rep) || 0) / 100 * 0.12;
  s -= Math.min(0.10, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.10);
  s += bandPers(b).cut;                                   // greedy crews want more, honourable less
  return Math.max(0.05, Math.min(0.45, s));
}
// a feuding band refuses to serve alongside its rival
function bandRivalServing(b) {
  const rivalId = b && b.feudWith; if (!rivalId) return false;
  if (bandTruceActive(b)) return false;                    // a bought truce lets former rivals serve together
  if ((S.allies || []).some(a => a.bandId === rivalId)) return true;
  if (S.escort && S.escort.fleet && S.escort.fleet.some(s => s.hired && s.alive && s.bandId === rivalId)) return true;
  return false;
}
function bandWillAlly(b) { return bandTier(b).key !== "hostile" && !bandRivalServing(b); }   // sworn enemies & rivals-of-an-ally refuse
// blood feuds run 1–3 deep; you can broker peace for a price that scales with the
// depth and eases with your standing (they trust you) and Dread (they fear you).
function bandFeudDepth(b) { return b && b.feudWith ? (b.feudDepth || 2) : 0; }
const BAND_TRUCE_DURATION = 6;   // cycles a bought truce holds before the feud smoulders back
function bandTruceActive(b) { return !!(b && b.feudWith && b.truceUntil && S.turn <= b.truceUntil); }
function bandTruceCost(b) { return bandFoe(b) ? Math.max(120, Math.round(bandReconcileCost(b) * 0.35)) : 0; }   // a fraction of a full settlement
function brokerTruce(id) {
  const b = bandById(id), rival = bandFoe(b);
  if (!b || !rival) return toast("No feud to settle there.", "bad");
  const cost = bandTruceCost(b);
  if ((S.res.credits || 0) < cost) return toast(`A truce costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  const until = S.turn + BAND_TRUCE_DURATION;
  b.truceUntil = until; rival.truceUntil = until;
  log(`🕊️ You bought a ${BAND_TRUCE_DURATION}-cycle truce between the ${b.ico} ${b.name} and the ${rival.ico} ${rival.name} for ${fmt(cost)} cr — they'll set the feud aside for now.`, "event");
  toast(`Truce: ${b.name} & ${rival.name} (${BAND_TRUCE_DURATION} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function processTruces() {       // lapsed truces let the feud smoulder back
  const seen = {};
  bandList().forEach(b => {
    if (b.truceUntil && S.turn > b.truceUntil) {
      const rival = bandById(b.feudWith), key = [b.id, b.feudWith || ""].sort().join("|");
      b.truceUntil = 0;
      if (!seen[key]) { seen[key] = true; log(`⚔️ The truce between the ${b.ico} ${b.name}${rival ? ` and the ${rival.ico} ${rival.name}` : ""} has lapsed — their feud smoulders again.`, ""); }
    }
  });
}
function bandReconcileCost(b) {
  const rival = bandFoe(b); if (!rival) return 0;
  const depth = bandFeudDepth(b);
  const repAvg = (((b.rep || 0) + (rival.rep || 0)) / 2);
  const standMult = 1 - Math.max(-0.2, Math.min(0.5, repAvg / 100 * 0.5));     // friendly crews → cheaper; hostile → pricier
  const dreadMult = 1 - Math.min(0.3, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.3);
  return Math.max(300, Math.round(1500 * depth * standMult * dreadMult));
}
function reconcileBands(id) {
  const b = bandById(id), rival = bandFoe(b);
  if (!b || !rival) return toast("No feud to settle there.", "bad");
  const cost = bandReconcileCost(b);
  if ((S.res.credits || 0) < cost) return toast(`Brokering this peace costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  b.feudWith = null; b.feudDepth = 0; b.truceUntil = 0; rival.feudWith = null; rival.feudDepth = 0; rival.truceUntil = 0;
  bandRepAdd(b, 4); bandRepAdd(rival, 4);                                      // both crews are grateful
  log(`🕊️ You brokered peace between the ${b.ico} ${b.name} and the ${rival.ico} ${rival.name} for ${fmt(cost)} cr — their feud is settled and they'll serve side by side now.`, "event");
  toast(`Peace brokered: ${b.name} & ${rival.name}`, "good"); sfx("event"); saveGame(); renderAll();
}
function giftRepFromCredits(amt) { return Math.min(15, Math.floor(amt / 400)); }
const GIFT_VALUED = { weapons: 1.6, ai: 1.8, luxury: 1.5, fuel: 1.3, drones: 1.5 };
function giftRepFromCargo(c, qty) { const base = (COM[c] ? COM[c].base : 50) * qty / 300; return Math.min(20, Math.max(1, Math.round(base * (GIFT_VALUED[c] || 1)))); }
function giftBandCredits(id, amt) {
  const b = bandById(id); if (!b) return;
  amt = Math.min(amt, S.res.credits);
  if (amt < 100) return toast("A tribute needs at least 100 cr.", "bad");
  S.res.credits -= amt; b.gifted = (b.gifted || 0) + amt;
  const g = giftRepFromCredits(amt); bandRepAdd(b, g);
  log(`🎁 Paid the ${b.ico} ${b.name} a ${fmt(amt)} cr tribute — collaboration +${g}.`, "good");
  toast(`${b.name}: +${g} standing`, "good"); sfx("event"); saveGame(); renderAll();
}
function giftBandCargo(id, c, qty) {
  const b = bandById(id); if (!b) return;
  qty = Math.min(qty, S.res[c] || 0); if (qty <= 0) return toast(`No ${COM[c].name} to give.`, "bad");
  S.res[c] -= qty; const g = giftRepFromCargo(c, qty); bandRepAdd(b, g);
  log(`🎁 Gifted ${qty} ${COM[c].ico} ${COM[c].name} to the ${b.ico} ${b.name} — collaboration +${g}.`, "good");
  toast(`${b.name}: +${g} standing`, "good"); sfx("event"); saveGame(); renderAll();
}
function decayBands() {                                  // standings drift toward neutral over time
  bandList().forEach(b => { if (b.rep > 0) b.rep = Math.max(0, b.rep - 1); else if (b.rep < 0) b.rep = Math.min(0, b.rep + 1); });
}
// escort recruitment: friendly bands hire on as escort ships for a negotiated fee
function escortRecruitFee(b) { return Math.round((800 + b.level * 700) * (1 - ((b.rep || 0) / 100) * 0.4) * bandPers(b).fee); }
function escortRecruitableBands() { return bandList().filter(b => ["neutral", "friendly", "sworn"].includes(bandTier(b).key) && !bandOnMandate(b) && !bandBusy(b)); }   // crews under contract / tied up can't be hired
function bandBetrayChance(b) { return Math.max(0, Math.min(0.6, 0.26 - ((b.rep || 0) / 100) * 0.32 - Math.min(0.18, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.18) + bandPers(b).betray)); }
/* ---- Tags (your loose brotherhood) + location + call-for-support ---- */
const BAND_TAGS = {
  brotherhood: { ico: "⭐", name: "Brotherhood", loyal: true },
  ally:        { ico: "🟢", name: "Ally",        loyal: true },
  watch:       { ico: "👁️", name: "Watch",       loyal: false },
  rival:       { ico: "🔴", name: "Rival",       loyal: false },
};
const BAND_TAG_KEYS = Object.keys(BAND_TAGS);
function bandTagMark(b) { return b && b.tag && BAND_TAGS[b.tag] ? BAND_TAGS[b.tag].ico : ""; }
function bandTagLoyal(b) { return !!(b && b.tag && BAND_TAGS[b.tag] && BAND_TAGS[b.tag].loyal); }
function setBandTag(id, tag) {
  const b = bandById(id); if (!b) return;
  b.tag = (b.tag === tag) ? null : (BAND_TAGS[tag] ? tag : null);   // toggle off if same
  saveGame(); renderAll();
}
function bandLocName(b) { const p = b && b.loc && PLANETS.find(x => x.id === b.loc); return p ? p.name : "parts unknown"; }
function bandDistance(b) { if (!b || !b.loc) return 6; if (b.loc === S.location) return 0; const d = currentPlanet().distances; return (d && d[b.loc]) || 6; }
const BAND_ONCALL_DURATION = 4;     // cycles a summoned band loiters in your area, ready to fight
const BAND_FOLLOW_DURATION = 6;     // cycles a band will travel WITH you once you ask them to follow
function bandFollowing(b) { return !!(b && b.follow && b.followUntil && S.turn <= b.followUntil); }
function bandOnCall(b) { return !!(b && ((b.onCallUntil && S.turn <= b.onCallUntil) || bandFollowing(b))); }
function bandInbound(b) { return !!(b && b.inboundTurn != null); }
function bandBusy(b) { return !!(b && b.busyUntil && S.turn < b.busyUntil); }
function bandsOnCall() { return bandList().filter(bandOnCall); }
// crews you can pull into the CURRENT fight: standing-by/following ones, plus willing crews based right here ("on site")
function bandsRaidable() { return bandList().filter(b => b.status !== "dead" && bandWillAlly(b) && (bandOnCall(b) || bandDistance(b) === 0)); }
// odds a band answers a call for support — rep, distance, brotherhood, your dread; nil if busy
function bandSupportOdds(b) {
  if (bandBusy(b) || !bandWillAlly(b)) return 0;
  let p = 0.35 + ((b.rep || 0) / 100) * 0.4 - bandDistance(b) * 0.03 + Math.min(0.15, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.15);
  if (bandTagLoyal(b)) p += 0.2;
  return Math.max(0, Math.min(0.95, p));
}
function callBandSupport(id) {
  const b = bandById(id); if (!b) return;
  if (bandFollowing(b)) return toast(`The ${b.name} are already riding with you.`, "");
  if (bandOnCall(b)) return toast(`The ${b.name} are already standing by.`, "");
  if (bandInbound(b)) return toast(`The ${b.name} are already inbound.`, "");
  if (bandBusy(b)) return toast(`The ${b.name} are tied up with their own business right now.`, "bad");
  if (!bandWillAlly(b)) return toast(`The ${b.name} bear you too much ill will to answer.`, "bad");
  const dist = bandDistance(b);
  if (dist === 0) { b.onCallUntil = S.turn + BAND_ONCALL_DURATION; log(`📣 The ${b.ico} ${b.name} are right here and fall in with you.`, "event"); toast(`${b.name} standing by`, "good"); sfx("event"); saveGame(); renderAll(); return; }
  if (Math.random() < bandSupportOdds(b)) {
    const travel = Math.max(1, Math.round(dist / 4));
    b.inboundTurn = S.turn + travel;
    log(`📣 The ${b.ico} ${b.name} answered your call from ${bandLocName(b)} — inbound in ${travel} cycle${travel === 1 ? "" : "s"}.`, "event");
    toast(`${b.name} inbound (${travel} cyc)`, "good"); sfx("event");
  } else {
    b.busyUntil = S.turn + rint(1, 3);
    log(`📣 The ${b.ico} ${b.name} declined — too far, or busy with their own affairs.`, "bad");
    toast(`${b.name} declined`, "bad");
  }
  saveGame(); renderAll();
}
// ask a standing-by band to travel WITH you for a stretch — they jump where you jump
function bandFollow(id) {
  const b = bandById(id); if (!b) return;
  if (bandInbound(b)) return toast(`The ${b.name} haven't arrived yet.`, "bad");
  if (!bandOnCall(b)) return toast(`The ${b.name} aren't standing by — call them first.`, "bad");
  const fresh = !bandFollowing(b);
  b.follow = true; b.followUntil = S.turn + BAND_FOLLOW_DURATION; b.loc = S.location || b.loc;
  log(`🛰️ The ${b.ico} ${b.name} ${fresh ? "fall in and will ride with you" : "agree to keep riding with you"} for ${BAND_FOLLOW_DURATION} cycles.`, "event");
  toast(`${b.name} ${fresh ? "following" : "still following"} (${BAND_FOLLOW_DURATION} cyc)`, "good"); sfx("event");
  saveGame(); renderAll();
}
// send a called / inbound / following band home early, freeing them up
function bandStandDown(id) {
  const b = bandById(id); if (!b) return;
  if (!bandInbound(b) && !bandOnCall(b)) return;
  const was = bandInbound(b) ? "recalled before arrival" : "stood down";
  b.inboundTurn = null; b.onCallUntil = 0; b.follow = false; b.followUntil = 0;
  log(`✖ The ${b.ico} ${b.name} were ${was} and return to their own affairs.`, "");
  toast(`${b.name} ${was}`, ""); saveGame(); renderAll();
}
function processBandSupport() {                          // arrivals + travelling companions, each cycle
  bandList().forEach(b => {
    if (b.inboundTurn != null && S.turn >= b.inboundTurn) {
      b.inboundTurn = null; b.onCallUntil = S.turn + BAND_ONCALL_DURATION; b.loc = S.location || b.loc;
      log(`🛬 The ${b.ico} ${b.name} arrived and are standing by your position.`, "event");
      if (typeof toast === "function") toast(`${b.name} has arrived`, "good");
      digestNote("arrivals", `${b.name} arrived`);
    }
    if (bandFollowing(b)) {
      b.loc = S.location || b.loc;                       // a following crew jumps where you jump — callable anywhere
    } else if (b.follow && b.followUntil && S.turn > b.followUntil) {
      b.follow = false; b.onCallUntil = Math.max(b.onCallUntil || 0, S.turn + BAND_ONCALL_DURATION);   // peel off, linger briefly
      log(`🛰️ The ${b.ico} ${b.name} have ridden with you long enough and break off — still nearby for now.`, "");
    }
  });
}
// synthesize a raid ally / escort support ship from a band
function bandAsAlly(b) {
  return { isPirate: true, bandId: b.id, allyName: b.name, ico: b.ico, name: b.name,
    strength: Math.round(((PIRATE_RANKS[b.level] || PIRATE_RANKS[1]).str) * 0.9), share: bandLootShare(b) };
}
// crews riding WITH you (following) pitch into a fresh engagement on their own — any prey, incl. letter-of-marque shipping
function raidJoinFollowers() {
  if (!S.prey) return;
  S.allies = S.allies || [];
  bandList().filter(bandFollowing).forEach(b => {
    if (S.allies.length >= 2 || S.allies.some(a => a.bandId === b.id) || bandRivalServing(b)) return;
    const a = bandAsAlly(b); S.allies.push(a); foeHp(a);
    b.allied = (b.allied || 0) + 1;
    log(`🛰️ The ${b.ico} ${b.name}, riding with you, swing in to your side (${Math.round(a.share * 100)}% cut).`, "event");
  });
}
// an allied pirate pours fire onto your current target
function allyStrike(target, ally) {
  const fp = bandPers(bandById(ally.bandId)).fp;          // bold crews hit harder
  const dmg = Math.max(1, Math.round((ally.strength * 0.45 + Math.random() * 6) * fp));
  target.hp = foeHp(target) - dmg;
  return dmg;
}
// a coalition victim may summon a same-faction vessel from the area
function maybeRescue(prey) {
  if (!prey || prey.isPirate) return;
  prey.pack = prey.pack || [];
  if (prey.pack.length >= 2) return;
  const others = prey._others || [];
  const idx = others.findIndex(o => !o.isPirate);
  if (idx < 0) return;
  if (Math.random() < 0.20) {
    const r = others.splice(idx, 1)[0];
    prey.pack.push(r); foeHp(r);
    log(`🆘 The ${prey.name} sent a distress call — a ${classLabel(r)} ${FACTIONS[r.faction] ? "(" + FACTIONS[r.faction].name + ")" : ""} answers! You now face ${prey.pack.length + 1} vessels, each firing on its own.`, "bad");
    toast(`Reinforcement: ${r.name}!`, "bad");
  }
}
function raidCallAllies() {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your pirate band is already full.", "bad");
  const others = S.prey._others || [];
  // bind area pirates to bands; only crews that aren't sworn enemies will rally
  const pirates = others.filter(o => o.isPirate);
  const willing = pirates.filter(a => { const b = bindBand(a, true); return bandWillAlly(b); });
  if (!pirates.length) return toast("No pirates in the area to call to your side.", "bad");
  if (!willing.length) return toast("The pirates here bear you a grudge — none will fight at your side.", "bad");
  const take = willing.slice(0, 2 - S.allies.length);
  const notes = [];
  take.forEach(a => {
    const b = bandById(a.bandId);
    a.share = bandLootShare(b); a.allyName = b ? b.name : a.name;
    S.allies.push(a); foeHp(a);
    S.prey._others = (S.prey._others || []).filter(o => o !== a);
    if (b) {
      b.allied = (b.allied || 0) + 1; bandRepAdd(b, 6);              // every call deepens the friendship
      const rival = bandFoe(b); if (rival) bandRepAdd(rival, -8);    // siding with a crew angers its blood rival
    }
    notes.push(`${b ? b.ico + " " + b.name : a.name} (${Math.round(a.share * 100)}% cut)`);
  });
  const yours = Math.round(lootShare() * 100);
  log(`📣 ${notes.join(", ")} rally to your guns — they fire independently. Your share of the loot: <b>${yours}%</b>.`, "event");
  toast(`${take.length} band(s) joined — your cut ${yours}%`, "event");
  afterAction();
}
// bring a standing-by (on-call/following) or locally-based willing band into the current fight
function raidSummonOnCall(id) {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your pirate band is already full.", "bad");
  const b = bandById(id); if (!b || !(bandOnCall(b) || (bandWillAlly(b) && bandDistance(b) === 0))) return toast("They aren't in reach to join.", "bad");
  if (b.id === (S.prey.bandId || null)) return toast("That's the crew you're fighting.", "bad");
  if (S.allies.some(a => a.bandId === id)) return toast(`The ${b.name} are already at your side.`, "bad");
  if (bandRivalServing(b)) { const r = bandFoe(b); return toast(`The ${b.name} won't fight beside their rivals the ${r ? r.name : "other crew"}.`, "bad"); }
  const a = bandAsAlly(b); S.allies.push(a); foeHp(a);
  b.allied = (b.allied || 0) + 1; bandRepAdd(b, 6);
  const rival = bandFoe(b); if (rival) bandRepAdd(rival, -8);
  log(`📣 The ${b.ico} ${b.name} swing in from nearby to your side (${Math.round(a.share * 100)}% cut). Your share: <b>${Math.round(lootShare() * 100)}%</b>.`, "event");
  toast(`${b.name} joined the fight`, "event"); afterAction();
}
function plunder(prey) {
  const share = lootShare();
  const taken = [];
  Object.keys(prey.cargo).forEach(c => {
    const room = cargoFree();
    const q = Math.min(Math.floor(prey.cargo[c] * share), room);
    if (q > 0) { S.res[c] = (S.res[c] || 0) + q; taken.push(`${q} ${COM[c].ico}`); }
  });
  const cr = Math.round(prey.credits * share * fxMult("lootMult"));   // Feared Name boosts the take
  S.res.credits += cr;
  let value = cr;
  Object.keys(prey.cargo).forEach(c => value += Math.floor(prey.cargo[c] * share) * COM[c].base);
  S.pirate.plundered += Math.round(value);
  return taken;
}
/* ---------- Multi-round raids (free combat sub-loop) ----------
   Each attack is one free round: you wear the foe's hull down, it fires back
   at your hull and subsystems. The engagement ends when the foe is destroyed,
   you disengage, or your hull buckles. Rounds cost no cycle-actions (the hunt
   that found the foe already did) — the cost is damage and the repairs after. */
function raidWinPirate(prey) {
  const taken = plunder(prey);
  S.pirate.dread += 3; clampPirate();
  pirateKillRewards(prey);
  const share = lootShare();
  const killed = bandById(prey.bandId);
  if (killed) { killed.fought = (killed.fought || 0) + 1; bandRepAdd(killed, -30); }   // blood spilled — collaboration craters
  (S.allies || []).forEach(a => { const b = bandById(a.bandId); if (b) bandRepAdd(b, 4); });  // fought at your side
  log(`🎯 You destroyed the ${prey.ico} ${prey.name}${killed ? ` of the ${killed.name}` : ""}! Bounty ${fmt(Math.round(prey.bounty * share))} cr + salvage ${taken.join(" ") || "none"}${share < 1 ? ` <span class="hint">(your cut ${Math.round(share * 100)}%)</span>` : ""}. (a lawful kill — no Wanted)`, "good");
  toast(`Bounty: ${fmt(Math.round(prey.bounty * share))} cr!`, "good");
}
function raidWinMerchant(prey, noQuarter) {
  const betray = S.commission && prey.faction === S.commission.patron;
  const taken = plunder(prey);
  const dread = noQuarter ? 9 : 5;
  const sanctioned = applyCommissionRaid(prey);
  const wanted = sanctioned ? (noQuarter ? 8 : 0) : prey.wantedGain + (noQuarter ? 8 : 0);
  S.pirate.dread += dread; S.pirate.wanted += wanted;
  addRep(prey.faction, noQuarter ? -14 : -8);
  if (!sanctioned) addRep("core", -(prey.faction === "core" ? 8 : 5));
  addRep("frontier", 3); clampPirate();
  log(`🏴‍☠️ You took the ${prey.ico} ${prey.name}${noQuarter ? " and gave no quarter" : ""}! Plundered ${taken.join(" ") || "no cargo"}${lootShare() < 1 ? ` <span class="hint">(split ${1 / lootShare()} ways)</span>` : ""}.${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""} (Dread +${dread}, Wanted +${wanted})`, "good");
  toast(`Plundered ${prey.name}!`, "good");
  if (betray) revokeCommission(true);
}
function promoteOrEnd(prey) {
  if (prey.pack && prey.pack.length) {
    const next = prey.pack.shift();
    next.pack = prey.pack; next._others = prey._others; next._engaged = true; foeHp(next);
    S.prey = next;
    log(`Now engaging the ${classLabel(next)} <span class="c">${next.name}</span> — ${next.pack.length + 1} hostile(s) remain.`, "bad");
  } else { clearEngagement(); }
}
function combatStrike(noQuarter, wkey) {
  const prey = S.prey; if (!prey) return;
  wkey = wkey && WEAPONS[wkey] && weaponAvailable(wkey) && weaponAffordable(wkey) ? wkey : "kinetic";
  if (!weaponAffordable(wkey)) return toast(`No ammo for ${WEAPONS[wkey].name}.`, "bad");
  if (!prey._engaged) { prey._engaged = true; S.pirate.raids++; }
  foeHp(prey); payAmmo(wkey); noteWeaponUse(wkey); combatState().lastWeapon = wkey;
  const ps = playerStrikes(prey, wkey);
  const tgt = applyTargetedDamage(prey, ps.dmg);
  let allyDmg = 0;
  (S.allies || []).forEach(a => { allyDmg += allyStrike(prey, a); });
  const bgDmg = battleGroupFirepower();
  if (bgDmg > 0) { prey.hp = foeHp(prey) - bgDmg; }
  if (prey.hp <= 0) {
    sfx("explode");
    if (prey.isPirate) raidWinPirate(prey); else raidWinMerchant(prey, noQuarter);
    promoteOrEnd(prey);
    return afterAction();
  }
  sfx("fire");
  const hpPct = Math.max(0, Math.round(prey.hp / prey.maxhp * 100));
  const incoming = [];
  const hostiles = allHostiles(prey);
  for (let idx = 0; idx < hostiles.length; idx++) {
    const fs = foeStrikes(hostiles[idx], idx === 0 ? (noQuarter ? 0.27 : 0.22) : 0.20);
    incoming.push(`${idx === 0 ? "" : hostiles[idx].ico + " "}−${fs.dmg}${subsysHitLog(fs.subHit)}`);
    if (!S.prey) break;   // shipCrippled ended the engagement
  }
  if (battleGroupShips().length) {
    const bgTaken = battleGroupTakeFire(prey);
    if (bgTaken) incoming.push(`✦ battle fleet −${bgTaken}`);
    if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
  }
  log(`⚔️ You hit the ${prey.ico} ${prey.name} for ${tgt.hullDmg} hull (now ${hpPct}%)${tgt.note}${allyDmg > 0 ? ` · 🤝 allies +${allyDmg}` : ""}${bgDmg > 0 ? ` · ✦ battle fleet +${bgDmg}` : ""}; return fire — Hull ${incoming.join(", ")}.`, "");
  toast(`Foe hull ${hpPct}%${prey.pack && prey.pack.length ? ` · +${prey.pack.length} more` : ""}`, "");
  if (!S.prey) return afterAction();
  maybeRescue(prey);
  if (foeFleeCheck(prey)) {
    if (prey.isPirate) { const b = bandById(prey.bandId); if (b) bandRepAdd(b, 4); }   // they live to remember you let them go
    log(`🏃 The ${prey.ico} ${prey.name} lit its drive and jumped clear — you never crippled its 🚀 engines. The ${prey.isPirate ? "bounty" : "haul"} got away.`, "bad");
    toast(`${prey.name} escaped!`, "bad");
    promoteOrEnd(prey);
    return afterAction();
  }
  afterAction();
}
function raidAttack(wkey) { if (!S.prey) return; combatStrike(false, wkey); }
function raidNoQuarter(wkey) { if (!S.prey || S.prey.isPirate) return; combatStrike(true, wkey); }
function raidExtort() {
  const prey = S.prey; if (!prey) return;
  const intimidation = S.pirate.dread + raidPower() * 0.3 + Math.random() * 20;
  if (intimidation >= prey.strength * 1.4) {
    // they surrender tribute without a fight — partial haul, low heat
    const tributeCargo = {};
    Object.keys(prey.cargo).forEach(c => { const q = Math.floor(prey.cargo[c] * 0.6); if (q > 0) tributeCargo[c] = q; });
    const credits = Math.round(prey.credits * 0.6);
    const taken = plunder({ cargo: tributeCargo, credits });
    const sanctioned = applyCommissionRaid(prey);
    S.pirate.dread = Math.max(0, S.pirate.dread - 12); if (!sanctioned) S.pirate.wanted += Math.round(prey.wantedGain * 0.4);   // menace spent leaning on them
    addRep(prey.faction, -5); clampPirate();
    log(`💀 Your reputation alone broke the ${prey.ico} ${prey.name} — it paid tribute: ${taken.join(" ") || "credits"} + ${fmt(credits)} cr.${sanctioned ? ` ⚖️ Sanctioned bounty +${fmt(COMM_BOUNTY)} cr.` : ""} No shots fired. <span class="hint">(Dread −12 — fear fades when it isn't backed by blood)</span>`, "good");
    toast(`Tribute extorted from ${prey.name}! (Dread −12)`, "good");
  } else {
    S.pirate.dread = Math.max(0, S.pirate.dread - 5); S.pirate.wanted += Math.round(prey.wantedGain * 0.3); clampPirate();   // a called bluff dents your menace
    log(`💀 The ${prey.ico} ${prey.name} called your bluff and ran. You aren't feared enough… yet. <span class="hint">(Dread −5)</span>`, "bad");
    toast("They called your bluff. (Dread −5)", "bad");
  }
  if (S.commission && prey.faction === S.commission.patron) revokeCommission(true);
  clearEngagement();
  afterAction();
}
// spare a beaten pirate crew instead of finishing them — they remember the mercy
function raidCanSpare() { const p = S.prey; return !!(p && p.isPirate && p._engaged && foeHp(p) <= p.maxhp * 0.35); }
function raidSpareRecruit() {
  if (!raidCanSpare()) return toast("Cripple them first — a proud crew won't parley until they're beaten.", "bad");
  const prey = S.prey; const b = bandById(prey.bandId) || bindBand(prey);
  if (b) bandRepAdd(b, 20);
  log(`🤝 You stayed your guns and let the ${prey.ico} ${prey.name}${b ? " of the " + b.name : ""} limp away — a debt they'll remember. Collaboration +20.`, "good");
  toast(`${b ? b.name : "Crew"}: +20 standing (spared)`, "good"); sfx("event");
  promoteOrEnd(prey);                                     // next consort steps up, or the engagement ends
  afterAction();
}
function raidVolley(n) {
  n = Math.max(1, Math.min(8, n || 5));
  const wkey = (combatState().lastWeapon) || "kinetic";
  for (let i = 0; i < n; i++) {
    const foe = S.encounter || S.prey;
    if (!foe) break;                                   // foe destroyed or fled
    if (!weaponAffordable(wkey)) break;                // out of ammo for the chosen weapon
    if (S.encounter) encounterFight(wkey); else combatStrike(false, wkey);
  }
}
function raidDisengage() {
  if (!S.prey) return;
  if (S.prey.isPirate) { const b = bandById(S.prey.bandId); if (b) bandRepAdd(b, 3); }   // you spared the crew
  if (S.prey._engaged) {
    allHostiles(S.prey).forEach(f => { if (S.prey) foeStrikes(f, 0.2); });   // every hostile takes a parting shot
    log(`You break off from the ${S.prey ? S.prey.name : "engagement"}${S.prey && (S.prey.pack || []).length ? " and its consorts" : ""} under fire.`, "bad");
    toast("Broke off under fire.", "bad");
  } else {
    log("You let the target slip past, unmolested.", "");
  }
  clearEngagement();
  afterAction();
}
/* a repair at your own haven or base also tops off the fuel tank, free */
function topUpFuelAtVenue() {
  if (!(atHaven() || atBase())) return;
  const cap = fuelCap();
  if (S.res.fuel >= cap) return;
  const added = cap - S.res.fuel;
  S.res.fuel = cap;
  const where = atHaven() && atBase() ? "haven & base" : atHaven() ? "haven" : "base";
  log(`⛽ Topped off fuel (+${added}) at your ${where}.`, "good");
}
function repairShip() {
  if (combatLocked()) return;
  if (S.pirate.hull >= HULL_MAX) return toast("Hull is already pristine.", "bad");
  const cost = Math.round((HULL_MAX - S.pirate.hull) * 30 * repairDiscount());   // your own dry-dock & base workshop patch up cheap
  if (S.res.credits < cost) return toast(`Repairs cost ${fmt(cost)} credits.`, "bad");
  S.res.credits -= cost; S.pirate.hull = HULL_MAX;
  log(`🔧 Hull fully repaired at ${currentPlanet().name}${repairVenueNote()} for ${fmt(cost)} credits.`, "good");
  sfx("repair"); toast("Hull repaired.", "good");
  topUpFuelAtVenue();
  afterAction();
}
function subsysRepairCost(sub) {
  const c = shipCond(sub); if (c >= 100) return null;
  const miss = 100 - c, rate = 15 * repairDiscount();
  return { credits: Math.round(miss * rate), mat: SUBSYS_META[sub].mat, matQ: Math.ceil(miss / 35) };
}
function repairSubsys(sub) {
  if (combatLocked()) return;
  const q = subsysRepairCost(sub);
  if (!q) return toast(`${SUBSYS_META[sub].name} is intact.`, "bad");
  if (S.res.credits < q.credits) return toast(`${SUBSYS_META[sub].name} repair costs ${fmt(q.credits)} cr.`, "bad");
  if ((S.res[q.mat] || 0) < q.matQ) return toast(`Need ${q.matQ} ${COM[q.mat].name} to repair ${SUBSYS_META[sub].name}.`, "bad");
  S.res.credits -= q.credits; S.res[q.mat] -= q.matQ; S.pirate.subsys[sub] = 100;
  log(`🔧 ${SUBSYS_META[sub].ico} ${SUBSYS_META[sub].name} repaired for ${fmt(q.credits)} cr + ${q.matQ} ${COM[q.mat].ico}.`, "good");
  toast(`${SUBSYS_META[sub].name} repaired.`, "good");
  topUpFuelAtVenue();
  afterAction();
}
function repairAll() {
  if (combatLocked()) return;
  let spent = 0; const did = [];
  if (S.pirate.hull < HULL_MAX) {
    const cost = Math.round((HULL_MAX - S.pirate.hull) * 30 * repairDiscount());
    if (S.res.credits >= cost) { S.res.credits -= cost; S.pirate.hull = HULL_MAX; spent += cost; did.push("hull"); }
  }
  SUBSYS.forEach(sub => {
    const q = subsysRepairCost(sub); if (!q) return;
    if (S.res.credits >= q.credits && (S.res[q.mat] || 0) >= q.matQ) {
      S.res.credits -= q.credits; S.res[q.mat] -= q.matQ; S.pirate.subsys[sub] = 100;
      spent += q.credits; did.push(SUBSYS_META[sub].name);
    }
  });
  if (!did.length) return toast("Nothing to refit, or you can't afford it.", "bad");
  log(`🔧 Refit at ${currentPlanet().name}: ${did.join(", ")} — ${fmt(spent)} cr + materials.`, "good");
  sfx("repair"); toast("Ship refitted.", "good");
  topUpFuelAtVenue();
  afterAction();
}
/* ---------- Field repair (combat only) ----------
   Full repairs are a dockside job (Ship tab). Mid-fight you can only jury-rig
   an emergency patch with materials on hand — and you hold fire to do it, so
   the foe gets a free strike. A real tactical gamble. */
const FIELD_REPAIR = { hull: 15, sub: 18, mats: { metals: 4, electronics: 3 } };
function canFieldRepair() { return Object.entries(FIELD_REPAIR.mats).every(([c, q]) => (S.res[c] || 0) >= q); }
function fieldRepairWorthwhile() { return S.pirate.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100); }
function fieldRepair() {
  const foe = S.encounter || S.prey;
  if (!foe) return toast("No engagement — repair fully at the 🚀 Ship tab.", "bad");
  if (!fieldRepairWorthwhile()) return toast("Hull and systems are already sound.", "bad");
  if (!canFieldRepair()) return toast(`Field patch needs ${matsString(FIELD_REPAIR.mats)}.`, "bad");
  Object.entries(FIELD_REPAIR.mats).forEach(([c, q]) => { S.res[c] -= q; });
  const before = S.pirate.hull;
  S.pirate.hull = Math.min(HULL_MAX, S.pirate.hull + FIELD_REPAIR.hull);
  const worst = SUBSYS.reduce((m, k) => (shipCond(k) < shipCond(m) ? k : m), SUBSYS[0]);
  let sysNote = "";
  if (shipCond(worst) < 100) { S.pirate.subsys[worst] = Math.min(100, S.pirate.subsys[worst] + FIELD_REPAIR.sub); sysNote = ` and shored up ${SUBSYS_META[worst].ico} ${SUBSYS_META[worst].name}`; }
  log(`🔧 Field patch: +${S.pirate.hull - before} hull${sysNote} — but you held fire, and the ${foe.name} presses the attack.`, "");
  const fs = foeStrikes(foe, S.encounter ? 0.3 : 0.28);   // you forfeited your turn — the foe strikes
  toast(`Patched +${S.pirate.hull - before + fs.dmg > 0 ? S.pirate.hull - before : 0} hull; ${foe.name} hit you for ${fs.dmg}.`, "");
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
  unlock("raid"); if (typeof setTab === "function") setTab("raid");
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
/* repair venues stack: a haven dry-dock (40% off) and/or a base workshop (25% off) */
function atBase() { return !!(S.bases && S.bases[S.location]); }
function repairDiscount() { return (atHaven() ? 0.6 : 1) * (atBase() ? 0.75 : 1); }
function repairVenueNote() {
  const v = [];
  if (atHaven()) v.push("haven dry-dock");
  if (atBase()) v.push("base workshop");
  return v.length ? ` (${v.join(" + ")}, ${Math.round((1 - repairDiscount()) * 100)}% off)` : "";
}
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
  if (tribute > 0) { S.res.credits += tribute; cycleLedger("haven tribute", tribute); }
}

/* ------------------------------------------------------------
   PRIVATEER COMMISSIONS — letters of marque: raid a faction's rivals, legally
   ------------------------------------------------------------ */
const FACTION_RIVAL = { core: "frontier", frontier: "core", syndicate: "core", miners: "agri", agri: "miners" };
/* ------------------------------------------------------------
   SECTOR RELATIONS — a persistent, evolving state between every pair of
   factions (not just the static FACTION_RIVAL lookup). Drifts each cycle
   toward tension (rivals) or peace (everyone else), nudged by your own
   letters of marque and the occasional random incident. Slice 1 of the
   sector 4X layer: pure new state — nothing existing reads it yet, so it
   can't destabilize anything already built.
   ------------------------------------------------------------ */
const FACTION_KEYS = Object.keys(FACTIONS);
const FACTION_REL_META = {
  alliance: { ico: "🤝", label: "Alliance" },
  peace:    { ico: "🕊️", label: "Peace" },
  cold:     { ico: "❄️", label: "Cold War" },
  war:      { ico: "⚔️", label: "War" },
};
const FACTION_INCIDENTS_GOOD = ["a trade accord eases tensions", "a diplomatic exchange builds goodwill", "a joint relief effort earns trust", "a border dispute is settled quietly"];
const FACTION_INCIDENTS_BAD = ["a border skirmish flares up", "a smuggling bust sparks accusations", "a tariff dispute turns bitter", "a stolen convoy inflames old grudges"];
function factionPairKey(a, b) { return [a, b].sort().join("_"); }
function factionsAreRivals(a, b) { return FACTION_RIVAL[a] === b || FACTION_RIVAL[b] === a; }   // the table has one one-way entry (syndicate->core)
function ensureFactionRel() {
  if (!S.factionRel) S.factionRel = {};
  FACTION_KEYS.forEach((a, i) => FACTION_KEYS.slice(i + 1).forEach(b => {
    const key = factionPairKey(a, b);
    if (S.factionRel[key] == null) S.factionRel[key] = factionsAreRivals(a, b) ? -20 : 25;   // rivals start tense, others start at peace
  }));
  return S.factionRel;
}
function factionRelScore(a, b) { if (a === b) return 100; ensureFactionRel(); return S.factionRel[factionPairKey(a, b)] ?? 25; }
function factionRelTier(score) {
  if (score >= 60) return "alliance";
  if (score >= 15) return "peace";
  if (score >= -30) return "cold";
  return "war";
}
function factionRelation(a, b) { const score = factionRelScore(a, b); const tier = factionRelTier(score); return { score: Math.round(score), tier, ...FACTION_REL_META[tier] }; }
function processFactionRelations() {
  const rel = ensureFactionRel();
  const keys = Object.keys(rel);
  keys.forEach(key => {
    const [a, b] = key.split("_"), rival = factionsAreRivals(a, b);
    const target = rival ? -60 : 25;                          // rivals drift toward war; everyone else settles toward peace
    rel[key] += (target - rel[key]) * 0.015;
    if (S.commission && ((S.commission.patron === a && S.commission.target === b) || (S.commission.patron === b && S.commission.target === a)))
      rel[key] -= 1.2;                                        // your active letter of marque stokes exactly this rivalry
    rel[key] = Math.max(-100, Math.min(100, rel[key]));
  });
  if (S.turn % 4 === 0 && Math.random() < 0.5) {               // an occasional named incident nudges one pair harder
    const key = pick(keys), [a, b] = key.split("_");
    const beforeTier = factionRelTier(rel[key]);
    const good = Math.random() < 0.5;
    rel[key] = Math.max(-100, Math.min(100, rel[key] + (good ? 1 : -1) * rint(8, 16)));
    const afterTier = factionRelTier(rel[key]);
    log(`🌐 ${FACTIONS[a].name} &amp; ${FACTIONS[b].name}: ${good ? pick(FACTION_INCIDENTS_GOOD) : pick(FACTION_INCIDENTS_BAD)}.`, good ? "good" : "bad");
    if (afterTier !== beforeTier) {
      const meta = FACTION_REL_META[afterTier];
      const tone = afterTier === "war" ? "bad" : afterTier === "alliance" ? "good" : "";
      log(`${meta.ico} <b>${FACTIONS[a].name}</b> and <b>${FACTIONS[b].name}</b> now stand at <b>${meta.label}</b>.`, tone);
      if (typeof digestNote === "function") digestNote("sector", `${FACTIONS[a].name}–${FACTIONS[b].name}: ${meta.ico} ${meta.label}`);
    }
  }
}
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
    { label: (() => { const hot = actives.filter(p => pirateLevel(p.id) > 1).length; return `Pacify the sector — no world above activity 1${hot ? ` (${hot} still hot)` : ""}`; })(), ok: actives.every(p => pirateLevel(p.id) <= 1) },
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
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const r = RECIPES.find(x => x.id === recipeId);
  if (!recipeAvailable(r)) return toast("Technology not yet researched.", "bad");
  const p = currentPlanet();
  let cap = Math.floor((3 + effIndustry(p)) * (1 + S.upgrades.factory * 0.30) * fxMult("yieldMult"));
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
  S.made = S.made || {}; S.made[r.out] = true;   // first-manufactured tracking (disclosure / objectives)
  useAction();
  const inStr = Object.entries(r.in).map(([k, v]) => `${v*batches} ${COM[k].ico}`).join(" + ");
  log(`Produced <span class="c">${r.qty*batches}</span> ${COM[r.out].ico} ${COM[r.out].name} (used ${inStr}) on ${p.name}.`, "good");
  toast(`+${r.qty*batches} ${COM[r.out].ico} ${COM[r.out].name}`, "good");
  afterAction();
}

/* ============================================================
   RESEARCH & POLITICS actions
   ============================================================ */
/* ---------- Research economy ----------
   Running experiments burns lab power (energy) and pays off most at high-tech
   worlds. Unlocking a tech also costs domain-themed MATERIALS — and a world
   that specialises in that domain halves the bill (local expertise), while
   the most advanced tech can only be cracked on a sufficiently advanced world. */
const RESEARCH_ENERGY = 4;   // ⚡ to power one round of experiments
const TECH_DOMAINS = {
  mining: "⛏️ mining", bio: "🌿 bio", gas: "🎈 gas", industry: "🏭 industry",
  energy: "⚡ energy", computing: "🖥️ computing", military: "⚔️ military", civic: "🏛️ civic",
};
const TECH_RESEARCH = {
  deepcore:    { domain: "mining",    mats: { ore: 8 } },
  xenobio:     { domain: "bio",       mats: { biomass: 8 } },
  gasharvest:  { domain: "gas",       mats: { gas: 6 } },
  salvaging:   { domain: "mining",    mats: { metals: 5 } },
  metallurgy:  { domain: "industry",  mats: { ore: 10, metals: 4 } },
  electronics: { domain: "computing", mats: { crystals: 6, metals: 4 } },
  reactors:    { domain: "energy",    mats: { radioactives: 6 } },
  gasfuel:     { domain: "energy",    mats: { gas: 6 } },
  biotech:     { domain: "bio",       mats: { spice: 4, chemicals: 4 } },
  markets:     { domain: "civic",     mats: { goods: 6 } },
  weapontech:  { domain: "military",  mats: { metals: 8, electronics: 4 } },
  diplomacy:   { domain: "civic",     mats: { goods: 8, luxury: 3 } },
  colonial:    { domain: "civic",     mats: { goods: 10, alloys: 4 } },
  energyweapons: { domain: "military", mats: { electronics: 6, crystals: 4 } },
  torpedoes:   { domain: "military",  mats: { radioactives: 6, metals: 6 } },
  dronetech:   { domain: "computing", mats: { electronics: 8, alloys: 4 } },
  aicores:     { domain: "computing", mats: { electronics: 10, relics: 2 }, minTech: 5 },
  antimatter:  { domain: "energy",    mats: { radioactives: 10, electronics: 6 }, minTech: 5 },
  terraform:   { domain: "bio",       mats: { biomass: 10, ice: 8, energy: 10 }, minTech: 4 },
};
function worldAffinity(p, domain) {
  const dep = p.deposits || {};
  switch (domain) {
    case "mining":    return effIndustry(p) >= 4 || ["ore", "crystals", "radioactives"].some(c => dep[c]);
    case "bio":       return p.faction === "agri" || ["biomass", "spice", "ice"].some(c => dep[c]);
    case "gas":       return !!dep.gas;
    case "industry":  return effIndustry(p) >= 4;
    case "energy":    return effIndustry(p) >= 4 || !!dep.radioactives || !!dep.gas;
    case "computing": return effTech(p) >= 5;
    case "military":  return effIndustry(p) >= 4;
    case "civic":     return effTech(p) >= 5 || p.faction === "core";
    default:          return false;
  }
}
function techMatCost(t) {
  const r = TECH_RESEARCH[t.id]; if (!r || !r.mats) return {};
  const affine = worldAffinity(currentPlanet(), r.domain);
  const out = {};
  Object.entries(r.mats).forEach(([k, v]) => { out[k] = affine ? Math.max(1, Math.ceil(v * 0.5)) : v; });
  return out;
}
function techMinTechMet(t) {
  const r = TECH_RESEARCH[t.id];
  return !(r && r.minTech) || effTech(currentPlanet()) >= r.minTech;
}
function matsPlain(mats) { return Object.entries(mats).map(([c, q]) => `${q}${COM[c].ico}`).join(" + "); }
function research() {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if ((S.res.energy || 0) < RESEARCH_ENERGY) return toast(`Experiments need ${RESEARCH_ENERGY} ⚡ energy to power the lab — refine or buy some.`, "bad");
  const p = currentPlanet();
  S.res.energy -= RESEARCH_ENERGY;
  const pts = Math.round((2 + effTech(p)) * (1 + S.upgrades.lab * 0.40) * fxMult("researchMult"));
  S.res.tech += pts; useAction();
  log(`Generated <span class="c">${pts}</span> tech points on ${p.name} (−${RESEARCH_ENERGY}⚡, Tech ${effTech(p)}).`, "good");
  toast(`+${pts} 🔬 (−${RESEARCH_ENERGY}⚡)`, "good");
  if (Math.random() < 0.08) rollFx("boon");   // breakthroughs sometimes spark a windfall
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
  let inf = Math.round((2 + (effTech(p) + effIndustry(p)) / 3) * (1 + S.upgrades.envoy * 0.40) * fxMult("influenceMult"));
  if (S.perks.senator) inf = Math.round(inf * 1.3);
  if (S.perks.governor) inf = Math.round(inf * 1.6);
  S.res.influence += inf;
  const repGain = Math.round(3 * (1 + S.upgrades.envoy * 0.4) * fxMult("repMult"));
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
  if (combatLocked()) return;
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
    if (S.res.credits >= due) { S.res.credits -= due; cycleLedger("org upkeep", -due); }
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
      S.res.credits -= cost; cycleLedger("UBI policy", -cost); applyPolDelta({ popularity: 2 });
      Object.values(S.colonies || {}).forEach(c => c.unrest = Math.max(0, (c.unrest || 0) - 1));
    } else {
      delete S.policies.ubi; applyPolDelta({ popularity: -6 });
      log("⚠️ The treasury couldn't fund Universal Basic Income — it lapsed amid protests.", "bad");
    }
  }
  if (policyActive("monopoly_grant")) { S.res.credits += 1200; cycleLedger("monopoly grant", 1200); applyPolDelta({ heat: 4 }); }
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
  if (combatLocked()) return;
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
  sfx("buy"); toast(`Bought ${qty} ${COM[c].name}`, "good");
  afterAction();
}
function sell(c, qty) {
  if (combatLocked()) return;
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
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue; S.stats.sales = (S.stats.sales || 0) + revenue;
  applyMarketMove(S.location, c, slip, true);  // flooding the market → price down
  addRep(currentPlanet().faction, 1);
  log(`Sold ${qty} ${COM[c].ico} ${COM[c].name} for <span class="c">${fmt(revenue)}</span> cr${slip > 0.05 ? " (price fell)" : ""}.`, "good");
  sfx("sell"); toast(`Sold ${qty} ${COM[c].name} (+${fmt(revenue)} cr)`, "good");
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
  // a fence is no dumber than the open market: it never pays more than you could
  // buy the same good for here. That kills risk-free buy-public / fence-black
  // arbitrage, while plunder and genuine cross-world runs stay profitable.
  const raw = Math.round(sellPrice(pid, c) * fenceMul(c));
  return Math.max(1, Math.min(raw, buyPrice(pid, c)));
}
function fence(c, qty) {
  if (combatLocked()) return;
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  const p = currentPlanet();
  if (!hasBlackMarket(p)) return toast("No fence operates here — try a syndicate world or the lawless rim.", "bad");
  if ((S.res[c] || 0) < qty) return toast("You don't have that many.", "bad");
  const slip = tradeSlippage(p, c, qty);
  const revenue = Math.round(fencePrice(S.location, c) * (1 - slip / 2) * qty);
  S.res[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue; S.stats.sales = (S.stats.sales || 0) + revenue;
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
  S.stats.trades++; S.stats.profit += total; S.stats.sales = (S.stats.sales || 0) + total; addRep("syndicate", 2);
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
  cost *= fxMult("fuelMult");                 // Clean Burn / Ion Storm Fortunes
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
  if (S.prey) { log(`Your quarry, the ${S.prey.ico} ${S.prey.name}, slipped away as you left the system.`, ""); S.prey = null; if (typeof releaseBattleGroup === "function") releaseBattleGroup(); }
  if (S.preyChoices) S.preyChoices = null;
  S.allies = null;
  const firstVisit = !S.visited[destId];
  S.res.fuel -= cost; S.location = destId; S.visited[destId] = true; S.stats.jumps++;
  sfx("travel");
  log(`Jumped to <span class="c">${dest.name}</span> (−${cost} ⛽).`, "event");
  toast(`Arrived at ${dest.name}`, "event");
  if (firstVisit && Math.random() < 0.30) rollFx(Math.random() < 0.8 ? "boon" : "bane");   // exploring new worlds turns up Fortunes
  if (firstVisit && Math.random() < 0.35) spawnSignal();                                   // …and reveals fresh leads to chase
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
  if (combatLocked()) return;
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
  if (combatLocked()) return;
  const t = TECHS.find(x => x.id === tid);
  if (!techAvailable(t)) return;
  if (S.res.tech < t.cost) return toast("Not enough tech points.", "bad");
  const r = TECH_RESEARCH[tid];
  if (r && r.minTech && effTech(currentPlanet()) < r.minTech)
    return toast(`${t.name} can only be cracked on a Tech ${r.minTech}+ world (here: ${effTech(currentPlanet())}).`, "bad");
  const mats = techMatCost(t);
  if (!canAfford(mats)) return toast(`Need materials in your hold: ${matsPlain(mats)}.`, "bad");
  S.res.tech -= t.cost; pay(mats); S.techs[tid] = true;
  const affine = r && worldAffinity(currentPlanet(), r.domain);
  log(`Researched ${t.ico} <span class="c">${t.name}</span>! (−${t.cost}🔬${Object.keys(mats).length ? " + " + matsPlain(mats) : ""}${affine ? " · local expertise halved the bill" : ""})`, "event");
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
  S.bases[pid] = { modules: {}, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };
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
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();   // fuel goes to the tank, everything else to the hold
  qty = Math.min(qty, space);
  if (qty <= 0) return toast(COM[c].isFuel ? "Fuel tank is full." : "Cargo hold is full.", "bad");
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
const BASE_MARKET_IMPACT = 1.5;   // bases trade in bulk — their deals move the local market harder than a ship's
// Buy/Sell the BASE's stockpile at the local market (not the ship)
function baseMarketBuy(c, qty) {
  if (combatLocked()) return;
  const b = S.bases[S.location]; if (!b) return toast("No base here.", "bad");
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  const p = currentPlanet();
  const room = baseStorageCap(S.location) - baseStorageUsed(b);
  if (room <= 0) return toast("Base storage is full.", "bad");
  qty = Math.min(qty, room);
  const slip = tradeSlippage(p, c, qty);
  const cost = Math.round(buyPrice(S.location, c) * (1 + slip / 2) * qty);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost; b.storage[c] = (b.storage[c] || 0) + qty; S.stats.trades++;
  applyMarketMove(S.location, c, Math.min(0.6, slip * BASE_MARKET_IMPACT), false);   // a depot buys wholesale — bigger market move
  log(`Bought ${qty} ${COM[c].ico} ${COM[c].name} into the base for <span class="c">${fmt(cost)}</span> cr — local price rose to ${fmt(S.prices[S.location][c])}.`, "good");
  sfx("buy"); toast(`Bought ${qty} ${COM[c].name} → base`, "good");
  afterAction();
}
function baseMarketSell(c, qty) {
  if (combatLocked()) return;
  const b = S.bases[S.location]; if (!b) return toast("No base here.", "bad");
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  if ((b.storage[c] || 0) < qty) return toast("The base doesn't have that many.", "bad");
  const p = currentPlanet();
  if (isIllegalAt(c, S.location) && Math.random() < bustRisk(c, qty, p)) {
    const conf = b.storage[c] || 0, fine = Math.min(S.res.credits, Math.round(conf * COM[c].base * 0.4) + 200);
    b.storage[c] = 0; S.res.credits -= fine;
    addRep("core", -12); addRep(p.faction, -6); addRep("frontier", 3); S.stats.busts++;
    log(`🚨 CUSTOMS BUST at ${p.name}! ${conf} ${COM[c].ico} ${COM[c].name} seized from your base, fined ${fmt(fine)} cr.`, "bad");
    toast(`🚨 Busted! ${COM[c].name} seized`, "bad");
    return afterAction();
  }
  const slip = tradeSlippage(p, c, qty);
  const revenue = Math.round(sellPrice(S.location, c) * (1 - slip / 2) * qty);
  b.storage[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue; S.stats.sales = (S.stats.sales || 0) + revenue;
  applyMarketMove(S.location, c, Math.min(0.6, slip * BASE_MARKET_IMPACT), true); addRep(p.faction, 1);   // dumping a stockpile floods the local market
  log(`Sold ${qty} ${COM[c].ico} ${COM[c].name} from the base for <span class="c">${fmt(revenue)}</span> cr — local price fell to ${fmt(S.prices[S.location][c])}.`, "good");
  sfx("sell"); toast(`Sold ${qty} ${COM[c].name} (+${fmt(revenue)} cr)`, "good");
  afterAction();
}
function baseBuyQty(c) { const el = document.getElementById("xfer-" + c); baseMarketBuy(c, el ? +el.value : 0); }
function baseSellQty(c) { const el = document.getElementById("xfer-" + c); baseMarketSell(c, el ? +el.value : 0); }
function withdrawQty(c) { transferFromBase(c, +document.getElementById("xfer-" + c).value); }

/* runs every cycle (including while you travel) */
function processBases() {
  const summary = {};
  Object.entries(S.bases).forEach(([pid, b]) => {
    const planet = PLANETS.find(p => p.id === pid);
    const cap = baseStorageCap(pid);
    baseModuleList(planet).forEach(mod => {
      if (mod.refiner) return;                       // refineries consume inputs — handled below
      const out = moduleOutput(planet, mod, b.modules[mod.id] || 0);
      if (out <= 0) return;
      const add = Math.min(out, cap - baseStorageUsed(b));
      if (add > 0) {
        b.storage[mod.produces] = (b.storage[mod.produces] || 0) + add;
        summary[mod.produces] = (summary[mod.produces] || 0) + add;
        digestProd(mod.produces, add);
      }
    });
    // Fuel Refinery: crack stored ice into fuel, limited by ice on hand and free space
    const reflvl = b.modules.fuelrefinery || 0;
    if (reflvl > 0) {
      const ice = b.storage.ice || 0, room = cap - baseStorageUsed(b);
      let made = Math.min(reflvl * REFINERY_RATE, Math.floor(ice / REFINERY_ICE_PER_FUEL), room);
      if (made > 0) {
        b.storage.ice -= Math.ceil(made * REFINERY_ICE_PER_FUEL);
        b.storage.fuel = (b.storage.fuel || 0) + made;
        summary.fuel = (summary.fuel || 0) + made;
        digestProd("fuel", made);
      }
    }
  });
  const keys = Object.keys(summary);
  if (keys.length) log(`🏗️ Your bases produced ${keys.map(c => summary[c] + COM[c].ico).join(" ")}.`, "good");
}
/* ============================================================
   BASE <-> COLONY TRADE NETWORK
   A base with a Storage Depot can run a trade route: each cycle it exports its
   raw-material stock to fill your colonies' raw orders, and imports colonies'
   finished-goods surplus into base storage. Costs: distance-scaled freight,
   a tariff on faction-aligned colonies, customs seizure when routing goods
   that are contraband at either end, and pirate convoy ambushes by distance
   and activity. Watch the per-cycle net balance for deficits.
   ============================================================ */
const FREIGHT_RATE = 0.5;            // credits per unit per light-year
const BASE_TRADE_THROUGHPUT = 30;    // units per commodity per route per cycle
const TRADE_SEIZE_CHANCE = 0.18;     // per-cycle customs risk for routing contraband
function worldDist(a, b) { const pa = PLANETS.find(p => p.id === a); return (pa && pa.distances[b]) || 1; }
function isFinishedGood(c) { return ["Finished", "Luxury", "Strategic"].includes(COM[c].tier) || c === "medicine"; }
// what a base will import from colonies: finished goods + combat drones (a Component colonies manufacture)
function baseImportable(c) { return isFinishedGood(c) || c === "drones" || c === "fuel"; }   // bases also collect colony fuel
function colonyFinishedReserve(col, c) {
  if (c === "goods") return col.pop;                       // mirror the colony's own happiness reserve
  if (c === "luxury" || c === "medicine") return Math.ceil(col.pop / 3);
  return 0;
}
function baseTradeActive(b) { return !!(b && b.trade && b.trade.on && (b.modules.warehouse || 0) > 0); }
function tradeExpOk(b, c) { return !(b.trade && b.trade.exp && b.trade.exp[c] === false); }   // default-on; player disables specific goods
function tradeImpOk(b, c) { return !(b.trade && b.trade.imp && b.trade.imp[c] === false); }
// Import/export are mutually exclusive per commodity so a finished good can't loop
// (imported from one colony then exported back to another, paying freight each way).
// Only finished goods can be imported, so they're the only ones that can conflict;
// when both flags are on (the default) import wins and export is locked out.
function baseImporting(b, c) { return baseImportable(c) && tradeImpOk(b, c); }
function baseExporting(b, c) { return tradeExpOk(b, c) && !baseImporting(b, c); }
function tradeColOk(b, cid) { return !(b.trade && b.trade.cols && b.trade.cols[cid] === false); }
let _trade = null;
function tradeBegin() { _trade = { freight: 0, importedVal: 0, exportedVal: 0, ambushLoss: 0, imp: {}, exp: {}, seized: {} }; }
function tradeSeizeCheck(c, bid, cid) { return (isIllegalAt(c, bid) || isIllegalAt(c, cid)) && Math.random() < TRADE_SEIZE_CHANCE; }
function tradeFine(c, q) {
  const f = Math.min(S.res.credits, Math.round(q * COM[c].base * 1.5));
  S.res.credits -= f; S.pirate.wanted = Math.min(100, (S.pirate.wanted || 0) + 4);
  _trade.seized[c] = (_trade.seized[c] || 0) + q; if (typeof clampPirate === "function") clampPirate();
}
// EXPORT pass: bases ship raw stock to fill colony orders (runs before colonies manufacture)
function processBaseTrade() {
  tradeBegin();
  const bases = Object.entries(S.bases || {}).filter(([id, b]) => baseTradeActive(b));
  const cols = Object.entries(S.colonies || {});
  if (!bases.length || !cols.length) return;
  bases.forEach(([bid, b]) => {
    cols.forEach(([cid, col]) => {
      const cp = PLANETS.find(p => p.id === cid);
      const dist = worldDist(bid, cid);
      if (!tradeColOk(b, cid)) return;
      const tariff = col.faction ? 1.25 : 1;
      STORE_IDS.forEach(c => {                        // export ANY product the base stocks (incl. fuel) to fill colony orders
        if (!baseExporting(b, c)) return;            // ...unless it's set to import (avoid loops)
        const need = (col.orders[c] || 0) - (col.storage[c] || 0);
        if (need <= 0) return;
        const room = colonyStorageCap(col, cp) - colonyStorageUsed(col);
        const move = Math.min(need, b.storage[c] || 0, BASE_TRADE_THROUGHPUT, room);
        if (move <= 0) return;
        b.storage[c] -= move;
        if (tradeSeizeCheck(c, bid, cid)) { tradeFine(c, move); return; }
        col.storage[c] = (col.storage[c] || 0) + move;
        _trade.freight += Math.ceil(dist * move * FREIGHT_RATE * tariff * colonyFreightMult(cid));
        _trade.exp[c] = (_trade.exp[c] || 0) + move; _trade.exportedVal += move * COM[c].base;
      });
    });
  });
}
// IMPORT pass: called per colony during processColonies, BEFORE its market export, so
// your bases get first claim on freshly-manufactured finished goods (the colony sells the rest).
function runBaseImport(col, cid, cp) {
  if (!_trade) tradeBegin();
  const bases = Object.entries(S.bases || {}).filter(([id, b]) => baseTradeActive(b));
  if (!bases.length) return;
  bases.forEach(([bid, b]) => {
    const cap = baseStorageCap(bid);
    const dist = worldDist(bid, cid);
    if (!tradeColOk(b, cid)) return;
    const tariff = col.faction ? 1.25 : 1;
    STORE_IDS.filter(baseImportable).forEach(c => {
      if (!tradeImpOk(b, c)) return;
      const reserve = colonyFinishedReserve(col, c) + (col.orders[c] || 0);
      const surplus = (col.storage[c] || 0) - reserve;
      if (surplus <= 0) return;
      const move = Math.min(surplus, BASE_TRADE_THROUGHPUT, cap - baseStorageUsed(b));
      if (move <= 0) return;
      col.storage[c] -= move;
      if (tradeSeizeCheck(c, bid, cid)) { tradeFine(c, move); return; }
      b.storage[c] = (b.storage[c] || 0) + move;
      _trade.freight += Math.ceil(dist * move * FREIGHT_RATE * tariff * colonyFreightMult(cid));
      _trade.imp[c] = (_trade.imp[c] || 0) + move; _trade.importedVal += move * COM[c].base;
    });
  });
}
// settle the cycle's trade: pirate ambush, freight charge, ledger + log
function finalizeBaseTrade() {
  const t = _trade; _trade = null;
  if (!t) return;
  const threat = PLANETS.reduce((s2, p) => s2 + pirateLevel(p.id), 0) / PLANETS.length;
  if (!pirateCalm() && (t.importedVal + t.exportedVal) > 0 && Math.random() < 0.05 + threat * 0.03) {
    t.ambushLoss = Math.min(S.res.credits, 150 + Math.round(threat * 350));
    S.res.credits -= t.ambushLoss;
    log(`🏴‍☠️ Pirates raided a base-supply convoy — ${fmt(t.ambushLoss)} cr lost. Calm the lanes to protect your routes.`, "bad");
  }
  if (t.freight > 0) S.res.credits = Math.max(0, S.res.credits - t.freight);
  const net = Math.round(t.importedVal - t.exportedVal - t.freight - t.ambushLoss);
  if (t.importedVal + t.exportedVal > 0 || Object.keys(t.seized).length) {
    S.tradeNet = (S.tradeNet || 0) + net;
    S.tradeLastCycle = { imp: t.imp, exp: t.exp, freight: t.freight, net, seized: t.seized, ambushLoss: t.ambushLoss };
  }
  if (Object.keys(t.seized).length) log(`🚔 Customs seized contraband from your trade route: ${Object.entries(t.seized).map(([c, q]) => q + COM[c].ico).join(" ")} — fined, Wanted up. Don't route illegal goods.`, "bad");
  if (t.importedVal + t.exportedVal > 0) {
    const impStr = Object.entries(t.imp).map(([c, q]) => q + COM[c].ico).join(" ") || "—";
    const expStr = Object.entries(t.exp).map(([c, q]) => q + COM[c].ico).join(" ") || "—";
    log(`🔄 Base trade: exported ${expStr} → colonies, imported ${impStr} → bases; freight/tariffs ${fmt(t.freight)} cr → net ${net >= 0 ? "+" : ""}${fmt(net)} cr/cyc.`, net >= 0 ? "good" : "bad");
  }
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
  const factionMul = col.faction ? 1.25 : 1;   // bloc trade network lifts commerce
  return Math.round(col.pop * (col.tax / 100) * 5 * (col.happiness / 100) * factionMul);
}
function colonyDefense(col) { return (col.buildings.garrison || 0) + colonyFactionDefenseBonus(col); }

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
    digestNote("threats", `${name} raided`);
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

/* ---------- Colony faction alignment ----------
   A colony may petition to join one of the great factions. The charter buys
   real benefits — the bloc's trade network (commerce), its patrols (support)
   and a flavored perk — at the price of irking rival blocs. */
const ALIGN_REP_REQ = 20;     // your standing with the bloc before they'll charter a colony
const ALIGN_COST_INF = 3;     // influence to push the petition through
const FACTION_COLONY_PERKS = {
  core:      "⚖️ +1 extra defense level — the law watches over you",
  miners:    "⛏️ +1 planetary Industry — guild engineers on site",
  agri:      "🌾 Farms yield +25% — combine agronomists at work",
  syndicate: "🔬 +1 planetary Tech — syndicate data access",
  frontier:  "🛰️ Import fees cut to the bone — free-trader routes",
};
function colonyFactionDefenseBonus(col) { return col.faction ? (col.faction === "core" ? 2 : 1) : 0; }
function alignColony(fid) {
  const pid = S.location, col = S.colonies[pid], planet = currentPlanet();
  if (!col || !FACTIONS[fid] || col.faction === fid) return;
  if ((S.rep[fid] || 0) < ALIGN_REP_REQ) return toast(`${FACTIONS[fid].name} won't charter a colony for a stranger — need rep ${ALIGN_REP_REQ}+.`, "bad");
  if ((S.res.influence || 0) < ALIGN_COST_INF) return toast(`Need ${ALIGN_COST_INF} influence to push the petition through.`, "bad");
  if (col.happiness < 40) return toast("The colonists are too unhappy to rally behind a banner (need 40+ happiness).", "bad");
  const old = col.faction;
  S.res.influence -= ALIGN_COST_INF;
  col.faction = fid;
  addRep(fid, 8);
  Object.keys(FACTIONS).forEach(o => { if (o !== fid && o !== old) addRep(o, -3); });
  if (old) addRep(old, -10);
  const F = FACTIONS[fid];
  log(`${F.ico} <span class="c">${planet.name}</span> has joined the <b>${F.name}</b>${old ? ` — the ${FACTIONS[old].name} are furious` : ""}. Their trade network and patrols now serve the colony.`, "event");
  toast(`${planet.name} joins the ${F.name}!`, "event");
  jot(`${planet.name} raised the colors of the ${F.name} — commerce, protection, and a bloc's expectations.`, "colony");
  afterAction();
}
function colonyIndependence() {
  const pid = S.location, col = S.colonies[pid], planet = currentPlanet();
  if (!col || !col.faction) return;
  const old = col.faction;
  col.faction = null;
  addRep(old, -10);
  col.unrest = (col.unrest || 0) + 1;
  col.happiness = Math.max(0, col.happiness - 8);
  log(`🏳️ <span class="c">${planet.name}</span> declares independence from the ${FACTIONS[old].name}. The bloc takes it badly, and the streets are tense.`, "bad");
  toast(`${planet.name} goes independent.`, "bad");
  afterAction();
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
  S.colonies[pid] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
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
/* ============================================================
   PLAYER FLEET — ships built at colony shipyards (freighters & warships).
   Slice 1: tier-gated timed construction, roster, upkeep, repair, scrap.
   Missions / combat allies / freight convoys land in later slices.
   ============================================================ */
const FLEET_HULL_BASE = 52, FLEET_FP_BASE = 15;
const FLEET_SHIPS = {
  // ---- civil freighters (cargo capacity; weak guns) ----
  light_freighter: { role: "freighter", cls: "corvette",   name: "Light Freighter",  ico: "🚚", tier: 1, build: 2, cap: 120, cost: { credits: 2500,  metals: 30 } },
  med_freighter:   { role: "freighter", cls: "frigate",    name: "Medium Freighter", ico: "🚛", tier: 2, build: 3, cap: 240, cost: { credits: 5000,  metals: 60,  electronics: 6 } },
  heavy_freighter: { role: "freighter", cls: "cruiser",    name: "Heavy Freighter",  ico: "🚍", tier: 3, build: 5, cap: 420, cost: { credits: 9000,  metals: 110, electronics: 14 } },
  bulk_freighter:  { role: "freighter", cls: "battleship", name: "Bulk Hauler",      ico: "🛳️", tier: 4, build: 7, cap: 700, cost: { credits: 16000, metals: 200, alloys: 20, electronics: 24 } },
  // ---- warships (defense; combat stats from SHIP_CLASSES) ----
  corvette:   { role: "warship", cls: "corvette",   name: "Corvette",   ico: "🚤", tier: 1, build: 2, cost: { credits: 3500,  metals: 40,  electronics: 6 } },
  frigate:    { role: "warship", cls: "frigate",    name: "Frigate",    ico: "🚢", tier: 2, build: 3, cost: { credits: 7000,  metals: 80,  electronics: 14 } },
  cruiser:    { role: "warship", cls: "cruiser",    name: "Cruiser",    ico: "🛡️", tier: 3, build: 5, cost: { credits: 13000, metals: 150, alloys: 18, electronics: 26 } },
  battleship: { role: "warship", cls: "battleship", name: "Battleship", ico: "⚔️", tier: 4, build: 8, cost: { credits: 26000, metals: 280, alloys: 40, electronics: 50 } },
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
  if (s.status === "mission" || s.status === "escort" || s.status === "logistics") return toast("That ship is on duty — recall it first.", "bad");
  const refund = def ? Math.round((def.cost.metals || 0) * 0.4) : 0;
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
let fleetMissionForm = { ship: null, planet: null, task: "cull", dur: 6 };
function setFleetMissionField(k, v) { fleetMissionForm[k] = (k === "dur") ? (parseInt(v, 10) || 6) : v; renderFleet(); }
let fleetLogiForm = { planet: null };
function setFleetLogiField(k, v) { fleetLogiForm[k] = v; renderFleet(); }
function renderFleet() {
  const el = (typeof document !== "undefined") && document.getElementById("panel-fleet"); if (!el) return;
  const f = fleetList(), pid = S.location, col = S.colonies && S.colonies[pid], yard = colonyShipyardTier(pid);
  const bar = (h, m) => { const pct = Math.max(0, Math.round(h / m * 100)), col2 = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)"; return `<div class="bar"><span style="width:${pct}%;background:${col2}"></span></div>`; };
  const shipRow = s => {
    const def = FLEET_SHIPS[s.key]; if (!def) return "";
    const homeName = (PLANETS.find(p => p.id === s.home) || {}).name || "—", here = s.home === pid && yard > 0, rc = fleetRepairCost(s);
    const onMission = s.status === "mission" && s.mission, onLogi = s.status === "logistics";
    const status = s.status === "building" ? `<span style="color:var(--warn)">🏗️ building (${s.buildLeft} cyc)</span>`
      : onMission ? `<span style="color:var(--accent)">🎯 ${MANDATE_TASKS[s.mission.task].name} @ ${mdPlanetName(s.mission.planet)} (${s.mission.cyclesLeft} cyc · +${fmt(s.mission.accrued)} cr)</span>`
      : s.status === "escort" ? `<span style="color:var(--accent)">🛡️ escorting a convoy</span>`
      : onLogi ? `<span style="color:var(--accent)">${def.role === "freighter" ? "🚚 hauling for" : "🛡️ guarding"} ${mdPlanetName(s.station)}</span>`
      : `<span style="color:var(--good)">idle</span>`;
    const repBtn = (s.status === "idle" && rc.miss > 0 && here) ? `<button class="btn btn-sm" title="Repair at home shipyard" onclick="repairFleetShip('${s.id}')">🔧 ${fmt(rc.credits)}</button>` : "";
    const ctlBtn = onMission ? `<button class="btn btn-sm" title="Recall — bank what it's earned" onclick="recallFleetMission('${s.id}')">↩ Recall</button>`
      : onLogi ? `<button class="btn btn-sm" title="Recall from logistics duty" onclick="recallLogistics('${s.id}')">↩ Recall</button>`
      : s.status === "building" || s.status === "escort" ? "" : `<button class="btn btn-sm btn-bad" title="Scrap this ship (salvage some metals)" onclick="scrapShip('${s.id}')">♻️</button>`;
    const spec = def.role === "warship" ? `🔥${fleetShipStr(def)} · 🛡️${s.hullMax}` : `📦${def.cap} cargo`;
    return `<div class="ship-stat" style="align-items:center">
      <span class="k">${def.ico} ${s.name} <span class="hint">${SHIP_CLASSES[def.cls].name} · ${spec} · ⚓ ${homeName}</span></span>
      <span class="v" style="min-width:160px">${s.status === "building" ? status : bar(s.hull, s.hullMax) + `<span class="hint">${status} · ${Math.round(s.hull)}/${s.hullMax}</span>`} ${repBtn}${ctlBtn}</span></div>`;
  };
  const warships = f.filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
  const freighters = f.filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter");
  const roster = `<div class="card"><h4>✦ Your Fleet <span class="hint">${f.length} ship(s) · upkeep ${fmt(fleetUpkeep())} cr/cyc</span></h4>
    ${f.length ? `${warships.length ? `<div class="ship-stat"><span class="k">⚔️ Warships</span></div>${warships.map(shipRow).join("")}` : ""}${freighters.length ? `<div class="ship-stat" style="margin-top:6px"><span class="k">🚚 Freighters</span></div>${freighters.map(shipRow).join("")}` : ""}` : '<div class="hint">No ships yet — lay down a hull at a colony Shipyard below.</div>'}</div>`;
  let yardCard;
  if (!col) yardCard = `<div class="card"><div class="hint">🏗️ Dock at one of your colonies with a <b>Shipyard</b> to build ships. (Build a Shipyard in the 🌍 Colonies tab — it needs Metallurgy.)</div></div>`;
  else if (yard <= 0) yardCard = `<div class="card"><div class="hint">${currentPlanet().name} has no <b>Shipyard</b>. Build one in the 🌍 Colonies tab (needs Metallurgy) to construct ships here.</div></div>`;
  else {
    const slips = fleetBuildingAt(pid);
    const rows = FLEET_SHIP_KEYS.filter(k => FLEET_SHIPS[k].tier <= yard).map(k => {
      const d = FLEET_SHIPS[k], mats = fleetMatsOf(d), matStr = Object.keys(mats).map(x => `${mats[x]}${COM[x].ico}`).join(" ");
      const ok = (S.res.credits || 0) >= d.cost.credits && canAfford(mats) && slips < yard;
      const spec = d.role === "warship" ? `🔥${fleetShipStr(d)} · 🛡️${fleetShipHullMax(d)}` : `📦${d.cap}`;
      return `<div class="ship-stat" style="align-items:center"><span class="k">${d.ico} ${d.name} <span class="hint">${spec} · ⏱️${d.build} cyc · T${d.tier}</span></span>
        <span class="v"><span class="hint">${fmt(d.cost.credits)} cr ${matStr}</span> <button class="btn btn-sm ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="${slips >= yard ? "All slipways busy" : ""}" onclick="orderShip('${k}')">Build</button></span></div>`;
    }).join("");
    yardCard = `<div class="card"><h4>🏗️ ${currentPlanet().name} Shipyard <span class="hint">Tier ${yard} · slipways ${slips}/${yard}</span></h4>
      <div class="hint">Lay down hulls up to Tier ${yard}; construction takes several cycles and materials come from your hold. A bigger yard adds slipways for parallel builds (upgrade it in the 🌍 Colonies tab).</div>
      ${rows}</div>`;
  }
  // ---- dispatch an idle warship on a system mission (100% of the take) ----
  const idleWar = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
  let missionCard = "";
  if (idleWar.length) {
    const fm = fleetMissionForm;
    if (!fm.ship || !idleWar.some(s => s.id === fm.ship)) fm.ship = idleWar[0].id;
    if (!fm.planet || !PLANETS.find(p => p.id === fm.planet)) fm.planet = S.location;
    const known = PLANETS.filter(p => isActive(p) && galaxyKnown(p));
    const s = fleetList().find(x => x.id === fm.ship), lvl = s ? shipMissionLevel(s) : 2;
    const shipOpts = idleWar.map(x => `<option value="${x.id}" ${x.id === fm.ship ? "selected" : ""}>${FLEET_SHIPS[x.key].ico} ${x.name}</option>`).join("");
    const planetOpts = known.map(p => `<option value="${p.id}" ${p.id === fm.planet ? "selected" : ""}>${p.name}${p.id === S.location ? " (here)" : ""} · ${pirateIntelKnows(p.id) ? pirateLevelLabel(pirateLevel(p.id)) : "activity ❔"}</option>`).join("");
    const taskBtns = Object.keys(MANDATE_TASKS).map(k => { const t = MANDATE_TASKS[k]; return `<button class="btn btn-sm ${fm.task === k ? "btn-primary" : ""}" title="${t.blurb}" onclick="setFleetMissionField('task','${k}')">${t.ico} ${t.name}</button>`; }).join(" ");
    const durBtns = MANDATE_DURATIONS.map(d => `<button class="btn btn-sm ${fm.dur === d ? "btn-primary" : ""}" onclick="setFleetMissionField('dur','${d}')">${d} cyc</button>`).join(" ");
    const t = MANDATE_TASKS[fm.task], est = fleetMissionEst(lvl, fm.planet, fm.task, fm.dur);
    const fac = (PLANETS.find(p => p.id === fm.planet) || {}).faction, sanc = fac && commissionCovers(fac);
    missionCard = `<div class="card"><h4>🎯 Dispatch a warship on a mission</h4>
      <div class="hint">${t.blurb} <b>You keep 100% of the take</b> — no fee, but the ship draws upkeep and risks combat damage (a light hull in an infested system can be lost). Pirate activity shows only for systems you hold intel on (⚔️ Raider charts).</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="hint">Ship</span><select onchange="setFleetMissionField('ship',this.value)">${shipOpts}</select>
        <span class="hint">System</span><select onchange="setFleetMissionField('planet',this.value)">${planetOpts}</select></div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Task</span> ${taskBtns}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Duration</span> ${durBtns}</div>
      <div class="ship-stat" style="margin-top:8px"><span class="k">Your take</span><span class="v">100% · <span class="hint">est. ~${fmt(est)} cr over ${fm.dur} cyc</span></span></div>
      ${t.heat ? `<div class="hint" style="color:${sanc ? "var(--good)" : "var(--bad)"}">${sanc ? `⚖️ Sanctioned by your letter of marque against ${FACTIONS[fac].name} — no Wanted.` : `⚠️ Piracy in your name — raises Wanted${fac ? ` and angers ${FACTIONS[fac].name}` : ""}.`}</div>` : `<div class="hint" style="color:var(--good)">Lawful — suppresses pirate activity at the target.</div>`}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" onclick="assignFleetMission('${fm.ship}','${fm.planet}','${fm.task}',${fm.dur})">🎯 Dispatch (${fm.dur} cyc)</button></div>
    </div>`;
  }
  // ---- logistics duty: station freighters (cheaper transport) + warship guards (cut ambush risk) ----
  const myCols = Object.keys(S.colonies || {});
  let logiCard = "";
  if (myCols.length) {
    const lf = fleetLogiForm; if (!lf.planet || !S.colonies[lf.planet]) lf.planet = myCols[0];
    const colOpts = myCols.map(cid => `<option value="${cid}" ${cid === lf.planet ? "selected" : ""}>${mdPlanetName(cid)} · ${pirateIntelKnows(cid) ? pirateLevelLabel(pirateLevel(cid)) : "activity ❔"}</option>`).join("");
    const feeDisc = Math.round(colonyHaulDiscount(lf.planet) * 100), frDisc = Math.round((1 - colonyFreightMult(lf.planet)) * 100);
    const haulers = colonyHaulers(lf.planet), guards = colonyGuards(lf.planet), plv = pirateLevel(lf.planet);
    const risk = haulers.length ? Math.round((0.05 + plv * 0.04) * Math.pow(0.45, guards.length) * 100) : 0;
    const idleFr = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter");
    const idleWar = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
    const frBtns = idleFr.map(s => `<button class="btn btn-sm btn-good" onclick="assignLogistics('${s.id}','${lf.planet}')">🚚 ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
    const warBtns = idleWar.map(s => `<button class="btn btn-sm" onclick="assignLogistics('${s.id}','${lf.planet}')">🛡️ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
    logiCard = `<div class="card"><h4>🚚 Logistics duty</h4>
      <div class="hint">Station <b>freighters</b> at one of your colonies to haul its goods — cutting its market import fee and base↔colony freight. Pirate-active systems risk an <b>ambush</b> (your freighter takes damage and loses goods); station a <b>warship</b> there to guard the convoy and cut that risk. Activity shows for systems you hold intel on.</div>
      <div class="row" style="margin-top:8px;align-items:center"><span class="hint">Colony</span> <select onchange="setFleetLogiField('planet',this.value)">${colOpts}</select></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Stationed</span><span class="v">${haulers.length} hauler(s) · ${guards.length} guard(s)</span></div>
      <div class="ship-stat"><span class="k">Transport savings</span><span class="v">−${feeDisc}% import fee · −${frDisc}% freight</span></div>
      ${haulers.length ? `<div class="ship-stat"><span class="k">Ambush risk</span><span class="v" style="color:${risk >= 15 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--good)"}">${risk}%/cyc${guards.length ? " (guarded)" : plv > 0 ? " — unguarded!" : ""}</span></div>` : ""}
      ${idleFr.length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign hauler</span> ${frBtns}</div>` : ""}
      ${idleWar.length ? `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign guard</span> ${warBtns}</div>` : ""}
      ${!idleFr.length && !idleWar.length ? '<div class="hint" style="margin-top:6px">No idle ships to assign — build more, or recall some.</div>' : ""}</div>`;
  }
  el.innerHTML = `<h2>✦ Fleet</h2>
    <div class="subtitle">Your own ships, built at colony shipyards — loyal and fully under your command. <b>Freighters</b> to haul your goods, <b>warships</b> to fight or work systems on contract. They cost credits &amp; materials to build and draw upkeep each cycle (see the 💰 Cycle accounts log). Dispatch a warship on a system mission (you keep <b>100%</b>), call ships into your raids/escorts, deploy your whole idle fleet as a raid Battle Group, or station freighters on logistics duty to cut transport costs.</div>
    ${roster}
    ${missionCard}
    ${logiCard}
    ${yardCard}`;
}
function setTax(delta) {
  const col = S.colonies[S.location];
  if (!col) return;
  col.tax = Math.max(0, Math.min(50, col.tax + delta));
  afterAction();
}
function colonyDeposit(c) {
  if (combatLocked()) return;
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
  if (combatLocked()) return;
  const col = S.colonies[S.location];
  if (!col) return;
  let qty = Math.min(+document.getElementById("col-" + c).value || 0, col.storage[c] || 0);
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();   // fuel to the tank, else the hold
  qty = Math.floor(Math.max(0, Math.min(qty, space)));
  if (qty <= 0) return toast(COM[c].isFuel ? "Nothing to withdraw (or tank full)." : "Nothing to withdraw (or hold full).", "bad");
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
    const store = (c, q) => { const add = Math.min(q, cap - colonyStorageUsed(col)); if (add > 0) { col.storage[c] = (col.storage[c] || 0) + add; digestProd(c, add); } };
    let foodMade = 0;   // net food (biomass) produced this cycle — sets the colony's carrying capacity

    // 1a) raw producers (farm, extractors) + passive research run first
    colonyBuildingList(planet).forEach(b => {
      const t = col.buildings[b.id] || 0; if (t <= 0) return;
      if (col.idle && col.idle[b.id]) return;                             // paused by the governor — no inputs consumed, no output
      if (b.id === "lab") { S.res.tech += t * 3; return; }                 // passive research
      if (b.id === "datacenter") { S.res.tech += t * 2; }                    // machine minds crunch data too (recipe still runs below)
      if (b.id === "scrubber") { if (S.pollution && S.pollution[pid]) S.pollution[pid] = Math.max(0, S.pollution[pid] - t * 1.2); return; }
      if (b.recipe) return;                                               // industry chain handled in 1b
      if (b.produces) {
        let out;
        if (b.id === "farm") out = Math.round(t * 8 * pollutionFarmMult(pid) * (col.faction === "agri" ? 1.25 : 1));   // smog withers crops; Agri-Combine agronomists boost them
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
      if (col.idle && col.idle[b.id]) return;                             // paused — the line is idle this cycle
      const r = b.recipe;
      let batches = t * r.rate;                                            // throughput scales with tier
      Object.entries(r.in).forEach(([c, q]) => { batches = Math.min(batches, Math.floor((col.storage[c] || 0) / q)); });
      const net = r.outQty - Object.values(r.in).reduce((s, q) => s + q, 0); // only net growth needs free space
      if (net > 0) batches = Math.min(batches, Math.floor((cap - colonyStorageUsed(col)) / net));
      if (batches <= 0) return;
      Object.entries(r.in).forEach(([c, q]) => { col.storage[c] -= batches * q; });
      if (r.in[COLONY_FOOD]) foodMade -= batches * r.in[COLONY_FOOD];      // food burned by industry can't feed people
      store(r.out, batches * r.outQty);
      S.made = S.made || {}; S.made[r.out] = true;
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
    if (col.faction) target += 6;                              // a bloc's backing steadies morale
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
    if (income > 0) { S.res.credits += income; cycleLedger("colony tax", income); }
    if (col.faction && S.turn % 5 === 0) addRep(col.faction, 1);   // loyal colonies endear you to their bloc

    // 5a-bis) your bases get first claim on finished goods before the colony sells the rest
    runBaseImport(col, pid, planet);
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
        if (col.faction) revenue = Math.round(revenue * 1.15);     // bloc merchants pay a premium
        S.res.credits += revenue; cycleLedger("colony exports", revenue);
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
const COLONY_SUPPLY = ["biomass", "energy", "alloys", "medicine", "goods", "luxury", "fuel"];  // staples every colony can order by default
// everything the network will carry for a given cycle: staples, plus anything
// any networked colony stores or has ordered — so mines feed factories too
function networkGoods(nets) {
  const set = new Set(COLONY_SUPPLY);
  nets.forEach(([, c]) => {
    Object.entries(c.orders || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
    Object.entries(c.storage || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
  });
  return STORE_IDS.filter(c => set.has(c));
}
function spaceportTier(col) { return col.buildings.spaceport || 0; }
function colonyNetworked(col) { return spaceportTier(col) > 0; }
function logisticsFee(col) {
  let fee = 0.30 - spaceportTier(col) * 0.05;
  if (col.faction) fee -= col.faction === "frontier" ? 0.15 : 0.10;   // bloc trade routes
  fee -= colonyHaulDiscount(colonyPidOf(col));                        // your own freighters haul it cheaper
  return Math.max(col.faction ? 0.05 : 0.10, fee);
}
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
    const nets0 = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c));
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
  const nets = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c));
  if (nets.length < 1) return;
  const used = {};
  nets.forEach(([id]) => { used[id] = {}; });
  let spent = 0, moved = false;

  networkGoods(nets).forEach(c => {
    nets.forEach(([id]) => { used[id][c] = used[id][c] || 0; });
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
const GALAXY_FUEL_HORIZON = 100;   // worlds within this fuel cost of where you are show on the map (rolls as you travel)
function galaxyKnown(p) {
  if (!isVisible(p)) return false;
  if (S.showAllTabs || S.visited[p.id]) return true;          // always show worlds you've been to
  if (p.hidden && S.discovered[p.id]) return true;            // surveyed worlds stay charted
  if (p.colonizable && !canColonize()) return false;          // colony worlds stay off-map until the Colonial Charter
  return p.id === S.location || fuelCost(p.id) <= GALAXY_FUEL_HORIZON;
}
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
function spawnSignal(opts = {}) {
  if (!Array.isArray(S.signals)) S.signals = [];
  if (S.signals.length >= SIGNAL_MAX) return null;
  const kind = opts.kind || pick(Object.keys(SIGNAL_KINDS));
  const tier = opts.tier || signalTier();
  const planet = opts.planet || pick(planetsForSignal()).id;
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
const FX_DOMAINS = { combat: "⚔️ Combat", economy: "💱 Trade", logistics: "🚀 Logistics", science: "🔬 Science", industry: "🏭 Industry", escort: "🛡️ Escort", politics: "🏛️ Politics", piracy: "🏴‍☠️ Piracy" };
function renderFortunesPanel() {
  const el = (typeof document !== "undefined") && document.getElementById("panel-fortunes"); if (!el) return;
  const act = fxActive();
  const boons = act.filter(f => FX[f.key].kind === "boon"), banes = act.filter(f => FX[f.key].kind === "bane");
  const sig = (Array.isArray(S.signals) ? S.signals : []).slice().sort((a, b) => (b.planet === S.location ? 1 : 0) - (a.planet === S.location ? 1 : 0));
  const seen = S.fxSeen || {}, tierName = ["", "faint", "strong", "rare"];
  const fxCard = f => {
    const d = FX[f.key], good = d.kind === "boon", col = good ? "var(--good)" : "var(--bad)";
    const total = f.dur || f.cyclesLeft, pct = Math.max(4, Math.round(f.cyclesLeft / total * 100)), cc = fxClearCost(f);
    const clr = (d.kind === "bane" && cc) ? `<div class="row" style="margin-top:6px"><button class="btn btn-sm" ${S.res.credits >= cc ? "" : "disabled"} title="Pay to shake it off now — cheaper as it nears its end" onclick="clearFx('${f.key}')">🧹 Clear (${fmt(cc)} cr)</button></div>` : "";
    return `<div class="card" style="border-color:${col}">
      <h4>${d.ico} ${d.name} <span class="pill ${good ? "good" : "bad"}">${tierName[d.tier]} ${good ? "boon" : "bane"}</span></h4>
      <div class="hint">${d.blurb}</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Time left</span><span class="v" style="color:${col}">${f.cyclesLeft} cycle${f.cyclesLeft === 1 ? "" : "s"}</span></div>
      <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>${clr}
    </div>`;
  };
  const sigCard = s => {
    const k = SIGNAL_KINDS[s.kind], here = s.planet === S.location, fuel = SIGNAL_FUEL[s.tier] || 6;
    const dist = here ? 0 : ((currentPlanet().distances || {})[s.planet] || "?");
    const can = here && actionsLeft() > 0 && S.res.fuel >= fuel && !(typeof combatLocked === "function" && combatLocked());
    const ctl = here
      ? `<button class="btn ${can ? "btn-good" : ""}" ${can ? "" : "disabled"} title="Spend 1 action + ${fuel}⛽" onclick="investigateSignal('${s.id}')">🔍 Investigate (${fuel}⛽)</button>`
      : `<button class="btn btn-sm" ${S.res.fuel >= fuelCost(s.planet) ? "" : "disabled"} onclick="travel('${s.planet}')">Travel ▸ ${sigPlanetName(s.planet)} (${dist} ly)</button>`;
    return `<div class="card">
      <h4>${k.ico} ${tierName[s.tier]} signal <span class="pill">${sigPlanetName(s.planet)}${here ? " · here" : ""}</span></h4>
      <div class="hint">${k.blurb}</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Fades in</span><span class="v">${s.ttl} cycle${s.ttl === 1 ? "" : "s"}</span></div>
      <div class="row" style="margin-top:6px">${ctl}</div>
    </div>`;
  };
  const allKeys = Object.keys(FX), seenCount = allKeys.filter(k => seen[k]).length, groups = {};
  allKeys.forEach(k => { (groups[FX[k].domain] = groups[FX[k].domain] || []).push(k); });
  const mastery = S.fxMastery || {}, masteredCount = Object.keys(FX_MASTERY).filter(dn => mastery[dn]).length;
  const almanac = Object.keys(FX_DOMAINS).filter(dn => groups[dn]).map(dn => {
    const keys = groups[dn], sc = keys.filter(k => seen[k]).length, done = !!mastery[dn];
    const badge = done ? `<span class="pill good" title="${FX_MASTERY[dn] ? FX_MASTERY[dn].blurb : ""}">🏅 mastered</span>` : `<span class="hint">${sc}/${keys.length}</span>`;
    const chips = keys.sort((a, b) => (FX[a].tier || 1) - (FX[b].tier || 1)).map(k => {
      const d = FX[k], good = d.kind === "boon";
      return seen[k]
        ? `<span class="pill ${good ? "good" : "bad"}" title="${d.blurb} (${tierName[d.tier]} · ${good ? "boon" : "bane"})">${d.ico} ${d.name}</span>`
        : `<span class="pill" style="opacity:.5" title="Undiscovered — keep exploring &amp; investigating signals to find it">❔ ??? <span style="opacity:.7">(${tierName[d.tier]})</span></span>`;
    }).join(" ");
    return `<div class="ship-stat" style="margin-top:8px"><span class="k">${FX_DOMAINS[dn]} ${badge}</span></div><div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>`;
  }).join("");
  const full = sig.length >= SIGNAL_MAX, noAct = actionsLeft() <= 0;
  const scanBtn = (kind) => { const c = SIGNAL_SCAN[kind], ok = !full && !noAct && (S.res.credits || 0) >= c.cost; return `<button class="btn ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="${full ? "Your scope is full of leads" : noAct ? "No actions left" : "Flush a fresh lead onto your scope (1 action)"}" onclick="buySignalScan('${kind}')">${kind === "deep" ? "🛰️" : "📡"} ${c.label} (${fmt(c.cost)} cr)</button>`; };
  el.innerHTML = `<h2>✨ Fortunes</h2>
    <div class="subtitle">Temporary <b>boons &amp; banes</b> you pick up by exploring, sweeping the lanes, and chasing <b>📡 signals</b> — fly to one and <b>🔍 Investigate</b> for a roll. Stronger effects are briefer; the rare, powerful ones are the prize of a hunted signal. Banes always wear off, and many can be 🧹 cleared (cheaper the closer they are to fading). Current phase: <b>${gamePhase()}</b>.</div>
    <div class="card"><h4>Active Fortunes <span class="hint">${act.length}/${FX_MAX_ACTIVE}</span></h4>${act.length ? "" : '<div class="hint">None right now — go find some.</div>'}</div>
    ${act.length ? `<div class="cards">${[...boons, ...banes].map(fxCard).join("")}</div>` : ""}
    <div class="card" style="margin-top:10px"><h4>📡 Signals on your scope <span class="hint">${sig.length}</span></h4>${sig.length ? "" : '<div class="hint">No leads right now. Explore new worlds and sweep the lanes (⚔️ Raider tab) to flush them out.</div>'}</div>
    ${sig.length ? `<div class="cards">${sig.map(sigCard).join("")}</div>` : ""}
    <div class="card" style="margin-top:10px"><h4>🛰️ Sensor Office</h4>
      <div class="hint">Buy intel to flush a fresh lead onto your scope (costs 1 action). A deep scan runs pricier but turns up stronger, rarer signals.</div>
      <div class="row" style="margin-top:6px">${scanBtn("scan")} ${scanBtn("deep")}</div></div>
    <div class="card" style="margin-top:10px"><h4>📖 Almanac <span class="hint">${seenCount}/${allKeys.length} discovered · 🏅 ${masteredCount}/${Object.keys(FX_MASTERY).length} domains mastered</span></h4>
      <div class="hint">Effects you've experienced are revealed; the rest await discovery. Catalogue every effect in a domain for a <b>permanent</b> passive edge.</div>${almanac}</div>`;
}
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
// ---- per-cycle treasury ledger: the recurring automatic flows (tax, upkeep,
// tribute, policy income/cost…) each report here so the cycle's credit moves are
// summarised in one line — no more "credits changed for unknown reasons".
let _cledger = null;
function cycleLedger(cat, amt) { amt = Math.round(amt || 0); if (_cledger && amt) _cledger[cat] = (_cledger[cat] || 0) + amt; }
function reportCycleLedger() {
  const L = _cledger; _cledger = null; if (!L) return;
  const ent = Object.entries(L).filter(([, v]) => v !== 0); if (!ent.length) return;
  const net = ent.reduce((s, [, v]) => s + v, 0);
  const parts = ent.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))} ${k}`);
  log(`💰 Cycle accounts: ${parts.join(" · ")} → net ${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))} cr.`, net >= 0 ? "good" : "bad");
}
// ---- per-cycle digest: a second, separate line rolling up non-financial noise
// (production totals, arrivals/completions, rising threats) into one recap, so
// a busy empire's log doesn't bury the headline in a dozen scattered lines.
let _cdigest = null;
function digestProd(key, qty) { if (_cdigest && qty) _cdigest.production[key] = (_cdigest.production[key] || 0) + qty; }
function digestNote(cat, text) { if (_cdigest && _cdigest[cat]) _cdigest[cat].push(text); }
function reportCycleDigest() {
  const D = _cdigest; _cdigest = null; if (!D) return;
  const parts = [];
  const prodKeys = Object.keys(D.production);
  if (prodKeys.length) parts.push(`🏭 produced ${prodKeys.map(c => `${fmt(D.production[c])}${COM[c] ? COM[c].ico : ""}`).join(" ")}`);
  if (D.arrivals.length) parts.push(`✅ ${D.arrivals.join(", ")}`);
  if (D.threats.length) parts.push(`⚠️ ${D.threats.join(", ")}`);
  if (D.sector && D.sector.length) parts.push(`🌐 ${D.sector.join(", ")}`);
  if (!parts.length) return;
  log(`📋 Cycle ${S.turn} recap: ${parts.join(" · ")}.`, "");
}
function endTurn(fromTravel = false) {
  if (!fromTravel && combatLocked()) return;
  S.turn++; S.actionsUsed = 0; _cledger = {}; _cdigest = { production: {}, arrivals: [], threats: [], sector: [] };
  if (S.jail > 0) { S.jail--; log(`⛓️ You serve a cycle in detention (${S.jail} remaining).`, "bad"); }
  processFx(); processSignals();
  processCrises(); processPirates(); processFactionRelations(); rollPrices(); processReserves(); processPollution(); applyDecreeIncome(); applyPolicyEffects(); processPlanetLaws(); processOrgs(); processInvestigation(); processOffice(); processWanted(); processHaven(); processCommission(); processBases(); processBaseTrade(); processLogistics(); processColonies(); finalizeBaseTrade(); expireContracts(); maybeGenContract(); maybeEvent(); maybeFortune(); maybeSignal();
  if (typeof escortDeadlineCheck === "function") escortDeadlineCheck();
  if (typeof decayBands === "function") decayBands();
  if (typeof processBandSupport === "function") processBandSupport();
  if (typeof processMandates === "function") processMandates();
  if (typeof processTruces === "function") processTruces();
  if (typeof processFleet === "function") processFleet();
  reportCycleLedger();
  reportCycleDigest();
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
     <div class="ship-stat" style="margin-top:8px"><span class="k">Actions</span><span class="v">${actionsLeft()}/${actionsMax()}</span></div>
     ${(S.pirate && S.pirate.hull < HULL_MAX) ? `<div class="ship-stat" style="margin-top:6px"><span class="k">Hull</span><span class="v" style="color:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}">${S.pirate.hull}/${HULL_MAX}</span></div>
     <div class="bar"><span style="width:${S.pirate.hull}%;background:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}"></span></div>` : ""}
     <div class="ship-stat" style="margin-top:8px"><span class="k">Hold</span></div>
     <div style="font-size:12px;line-height:1.7">${held}</div>
     ${mods ? `<div class="ship-stat" style="margin-top:8px"><span class="k">Mods</span></div><div style="font-size:13px">${mods}</div>` : ""}`;
}
// ---- Operations board: one live digest of every timed/background activity ----
function renderOps() {
  const el = (typeof document !== "undefined") && document.getElementById("opsPanel"); if (!el) return;
  const rows = [];
  const row = (ico, txt, cyc, tab, col) => rows.push(`<div class="ship-stat" style="align-items:center${tab ? ";cursor:pointer" : ""}"${tab ? ` onclick="setTab('${tab}')" title="Open the ${tab} tab"` : ""}>
    <span class="k">${ico} <span class="hint">${txt}</span></span>${cyc != null ? `<span class="v"${col ? ` style="color:${col}"` : ""}>${cyc}</span>` : ""}</div>`);
  // combat first (most urgent)
  if (S.interdiction) row("🚨", "Navy interdiction", null, "raid", "var(--bad)");
  if (S.encounter) row("🏴", `Ambush: ${S.encounter.name}`, null, "raid", "var(--bad)");
  if (S.prey) row("🎯", `Engaging ${S.prey.name}`, null, "raid", "var(--warn)");
  if (S.jail > 0) row("⛓️", "In detention", S.jail + "c", null, "var(--bad)");
  // your fleet
  fleetList().forEach(s => { const def = FLEET_SHIPS[s.key]; if (!def) return;
    if (s.status === "building") row("🏗️", `${def.ico} ${s.name} building`, s.buildLeft + "c", "fleet", "var(--warn)");
    else if (s.status === "mission" && s.mission) row(MANDATE_TASKS[s.mission.task].ico, `${def.ico} ${s.name} · ${MANDATE_TASKS[s.mission.task].name} @ ${mdPlanetName(s.mission.planet)} <span style="color:var(--gold)">+${fmt(s.mission.accrued)}</span>`, s.mission.cyclesLeft + "c", "fleet", "var(--accent)");
    else if (s.status === "logistics") row(def.role === "freighter" ? "🚚" : "🛡️", `${def.ico} ${s.name} · ${def.role === "freighter" ? "hauling for" : "guarding"} ${mdPlanetName(s.station)}`, null, "fleet", "var(--accent)");
    else if (s.status === "escort") row("🛡️", `${def.ico} ${s.name} · escorting`, null, "escort", "var(--accent)");
    else if (s.status === "battle") row(FORMATION_SLOTS[shipFormation(s)].ico, `${def.ico} ${s.name} · ${FORMATION_SLOTS[shipFormation(s)].name} (${Math.round(s.hull)}/${s.hullMax})`, null, "raid", "var(--bad)");
  });
  // pirate mandates
  (S.mandates || []).forEach(m => { const b = bandById(m.bandId), t = MANDATE_TASKS[m.task]; if (!t) return;
    row(t.ico, `${b ? b.ico + " " + b.name : "crew"} · ${t.name} @ ${mdPlanetName(m.planet)} <span style="color:var(--gold)">+${fmt(m.accrued)}</span>`, m.cyclesLeft + "c", "contacts", "var(--accent)"); });
  // active escort run
  if (S.escort && S.escort.active && S.escort.mission) { const m = S.escort.mission, left = m.deadline != null ? Math.max(0, m.deadline - S.turn) : null;
    row(m.pirate ? "🏴" : "🛡️", `${m.pirate ? "Smuggling run" : "Escort"} → ${mdPlanetName(m.to)} · leg ${m.legs - m.legsLeft}/${m.legs}`, left != null ? left + "c" : null, "escort", left != null && left <= 2 ? "var(--bad)" : "var(--warn)"); }
  // letter of marque
  if (S.commission) { const c = S.commission; row("📜", `Marque vs ${FACTIONS[c.target].name} · ${c.done}/${c.quota} raids`, Math.max(0, c.expires - S.turn) + "c", "raid", "var(--good)"); }
  // brotherhood: following / standing by / inbound
  bandList().forEach(b => {
    if (bandFollowing(b)) row("🛰️", `${b.ico} ${b.name} following`, (b.followUntil - S.turn) + "c", "contacts", "var(--good)");
    else if (bandOnCall(b)) row("📣", `${b.ico} ${b.name} standing by`, (b.onCallUntil - S.turn) + "c", "contacts", "var(--good)");
    else if (bandInbound(b)) row("📣", `${b.ico} ${b.name} inbound`, (b.inboundTurn - S.turn) + "c", "contacts", "var(--warn)");
  });
  const opsHtml = rows.join("");
  const fxHtml = renderFortunes(), sigHtml = renderSignals();   // active Fortunes (clearable) + signals (investigate)
  el.innerHTML = (opsHtml || fxHtml || sigHtml) ? `<h3>📋 Operations</h3>${opsHtml}${fxHtml}${sigHtml}` : "";
}
function renderSignals() {
  const sig = Array.isArray(S.signals) ? S.signals : [];
  if (!sig.length) return "";
  const rows = sig.map(s => {
    const k = SIGNAL_KINDS[s.kind], here = s.planet === S.location;
    const dist = here ? 0 : ((currentPlanet().distances || {})[s.planet] || "?");
    const fuel = SIGNAL_FUEL[s.tier] || 6, tl = ["", "faint", "strong", "rare"][s.tier];
    const can = here && actionsLeft() > 0 && S.res.fuel >= fuel && !(typeof combatLocked === "function" && combatLocked());
    const ctl = here
      ? `<button class="btn btn-sm ${can ? "btn-good" : ""}" ${can ? "" : "disabled"} title="${k.blurb} — spend 1 action + ${fuel}⛽" onclick="investigateSignal('${s.id}')">🔍 Investigate (${fuel}⛽)</button>`
      : `<span class="hint">travel to ${sigPlanetName(s.planet)} (${dist} ly)</span>`;
    return `<div class="ship-stat" style="margin-top:4px"><span class="k" title="${k.blurb}">${k.ico} ${tl} ${k.name}</span><span class="v">${s.ttl}c · ${ctl}</span></div>`;
  }).join("");
  return `<div class="ship-stat" style="margin-top:8px"><span class="k">📡 Signals</span></div>${rows}`;
}
function renderFortunes() {
  const act = fxActive();
  if (!act.length) return "";
  const chips = act.map(f => {
    const def = FX[f.key], good = def.kind === "boon";
    const cc = fxClearCost(f);
    const clr = (def.kind === "bane" && cc) ? ` <button class="btn btn-sm" title="Pay ${fmt(cc)} cr to shake it off now (cheaper as it nears its end)" onclick="clearFx('${f.key}')">🧹 ${fmt(cc)}</button>` : "";
    return `<div class="ship-stat" style="margin-top:4px"><span class="k" style="color:${good ? "var(--good)" : "var(--bad)"}" title="${def.blurb}">${def.ico} ${def.name}</span><span class="v">${f.cyclesLeft} cyc${clr}</span></div>`;
  }).join("");
  return `<div class="ship-stat" style="margin-top:8px"><span class="k">✨ Fortunes</span></div>${chips}`;
}
function renderLog() {
  const el = document.getElementById("log"); if (!el) return;
  el.innerHTML = S.log.map(e => `<div class="log-entry ${e.type}"><span style="opacity:.5">[${e.turn}]</span> ${e.msg}</div>`).join("");
}

function renderSectorRelations() {
  ensureFactionRel();
  const pairs = [];
  FACTION_KEYS.forEach((a, i) => FACTION_KEYS.slice(i + 1).forEach(b => pairs.push([a, b])));
  const rows = pairs
    .map(([a, b]) => ({ a, b, rel: factionRelation(a, b) }))
    .sort((x, y) => x.rel.score - y.rel.score)   // most tense (war) first
    .map(({ a, b, rel }) => {
      const pct = Math.round((rel.score + 100) / 2);
      const col = rel.tier === "war" ? "var(--bad)" : rel.tier === "cold" ? "var(--warn)" : "var(--good)";
      return `<div class="ship-stat"><span class="k">${FACTIONS[a].ico} ${FACTIONS[a].name} ↔ ${FACTIONS[b].ico} ${FACTIONS[b].name}</span>
        <span class="v"><span class="pill" style="border-color:${col};color:${col}">${rel.ico} ${rel.label}</span></span></div>
        <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
    }).join("");
  return `<div class="card"><h4>🌐 Sector Relations</h4>
    <div class="hint">How the great powers stand with each other — independent of your own standing with them. Drifts each cycle; rivals trend toward war unless something intervenes, and an active letter of marque stokes the rivalry it's fighting for.</div>
    ${rows}</div>`;
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
  const cards = PLANETS.filter(galaxyKnown).map(p => {
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
    const _plv = pirateLevel(p.id);
    const piratePill = pirateIntelKnows(p.id)
      ? (_plv > 0 ? `<span class="pill ${_plv >= 2 ? "bad" : ""}" title="Pirate activity level ${_plv} (from your charts)">🏴 pirates ${_plv}</span>` : `<span class="pill good" title="No pirate activity (from your charts)">🏴 clear</span>`)
      : '';
    const tag = p.colonizable
      ? `<span class="pill good">${S.colonies[p.id] ? "your colony 🌍" : "colonizable"}</span>`
      : `${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}`;
    const escortPill = (S.escort && S.escort.active && S.escort.mission && S.escort.mission.to === p.id)
      ? `<span class="pill" title="Your active convoy is bound here (${S.escort.mission.legsLeft} leg(s) left)">🛡️ convoy bound</span>` : '';
    const _fMissions = fleetList().filter(s => s.status === "mission" && s.mission && s.mission.planet === p.id);
    const fleetMissionPill = _fMissions.length
      ? `<span class="pill" title="${_fMissions.map(s => `${FLEET_SHIPS[s.key].ico} ${s.name} — ${MANDATE_TASKS[s.mission.task].name} (${s.mission.cyclesLeft} cyc)`).join(" · ")}">🎯 fleet mission ×${_fMissions.length}</span>` : '';
    const _fLogi = fleetList().filter(s => s.status === "logistics" && s.station === p.id);
    const fleetLogiPill = _fLogi.length
      ? `<span class="pill" title="${_fLogi.map(s => `${FLEET_SHIPS[s.key].ico} ${s.name} (${FLEET_SHIPS[s.key].role === "freighter" ? "hauler" : "guard"})`).join(" · ")}">🚚 convoy stationed</span>` : '';
    const _mandatesHere = (S.mandates || []).filter(m => m.planet === p.id);
    const mandatePill = _mandatesHere.length
      ? `<span class="pill" title="${_mandatesHere.map(m => `${(bandById(m.bandId) || {}).name || "crew"} — ${MANDATE_TASKS[m.task].name} (${m.cyclesLeft} cyc)`).join(" · ")}">📜 mandate ×${_mandatesHere.length}</span>` : '';
    const _sig = (S.signals || []).find(s => s.planet === p.id);
    const signalPill = _sig ? `<span class="pill good" title="${SIGNAL_KINDS[_sig.kind].blurb} — ${_sig.ttl} cyc to investigate">${SIGNAL_KINDS[_sig.kind].ico} ${["", "faint", "strong", "rare"][_sig.tier]} signal</span>` : '';
    const sigFuel = _sig ? (SIGNAL_FUEL[_sig.tier] || 6) : 0;
    const sigBtn = (_sig && here) ? `<button class="btn btn-sm ${actionsLeft() > 0 && S.res.fuel >= sigFuel ? "btn-good" : ""}" ${actionsLeft() > 0 && S.res.fuel >= sigFuel ? "" : "disabled"} title="${SIGNAL_KINDS[_sig.kind].blurb}" onclick="investigateSignal('${_sig.id}')">🔍 Investigate signal (${sigFuel}⛽)</button>` : '';
    return `<div class="planet-card ${here ? "current" : ""}">
      <div class="planet-orb" style="background:radial-gradient(circle at 35% 30%, ${p.color}, #000 130%)"></div>
      <div class="planet-name">${p.name} ${S.visited[p.id] ? "" : '<span class="badge">unknown</span>'}</div>
      <div class="planet-tag">${p.tag} · ${tag}</div>
      <div class="planet-desc">${p.desc}</div>
      <div class="planet-levels">
        <span class="lvl-chip">🏭 Ind ${effIndustry(p)}</span>
        <span class="lvl-chip">🔬 Tech ${effTech(p)}</span>
        ${enf}${polPill}${crisisPill}${piratePill}${escortPill}${fleetMissionPill}${fleetLogiPill}${mandatePill}${signalPill}
      </div>
      <div class="hint" style="margin-bottom:8px">Extract: ${deps || "—"}</div>
      ${sigBtn ? `<div class="row" style="margin-bottom:8px">${sigBtn}</div>` : ""}
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
  // pirate-chart summary, like the crisis badge — live for the chart's validity window
  let intelBadge = "";
  if (pirateIntelActive()) {
    const left = S.pirateIntel.until - S.turn;
    const hot = S.pirateIntel.worlds.filter(id => pirateLevel(id) >= 2).length;
    intelBadge = `<span class="pill ${hot ? "bad" : "good"}" title="Active pirate chart — ${left} cycle(s) left. Activity updates live on the map.">🏴 ${hot ? hot + " pirate hotspot" + (hot > 1 ? "s" : "") : "lanes charted"} · ${left}cyc</span>`;
  }
  el.innerHTML = `<h2>Galactic Map ${crisisBadge}${climateBadge}${intelBadge}</h2>
    <div class="subtitle">A random ${activeCoreTotal()} of 15 core worlds feature this game, so every run charts a different sector. Each world has its own resources, industry, laws and faction; extraction is bound to where the resource exists — and every deposit is finite: strip a world and yields fall, prices climb, and the region feels it. Industry breeds <b>pollution</b>; the sector's aggregate drives <b>climate stress</b> that withers farms everywhere. Frontier worlds marked <span class="pill good">colonizable</span> are fresh: full reserves, clean skies. Travelling costs fuel and advances a cycle.</div>
    <div class="planet-grid">${cards}</div>
    ${(() => { const beyond = PLANETS.filter(p => isActive(p) && !p.hidden && !p.colonizable && !galaxyKnown(p)).length; return beyond ? `<div class="hint" style="margin-top:8px">🛰️ ${beyond} more world(s) lie beyond your sensor range (~${GALAXY_FUEL_HORIZON} fuel) — travel toward the frontier to chart them.</div>` : ""; })()}
    <div class="section-title">🔭 Exploration</div>
    <div class="cards">${survey}</div>
    <div class="hint" style="margin-top:14px">🏆 Your long-term legacy goals and all contracts now live in the <b>🎯 Missions</b> tab.</div>`;
}

/* ----- Market ----- */
// ---- quick-trade state (session-only UI, not saved — same convention as subViews) ----
let marketQty = {};      // remembers the last quantity typed per commodity, so re-renders don't reset it to 10
let marketSort = "default";
function setMarketSort(mode) { marketSort = mode; renderMarket(); }
// the best KNOWN world to sell a commodity bought here, ranked by profit per light-year of travel
function bestFlipFor(c) {
  const here = currentPlanet();
  let best = null;
  PLANETS.filter(galaxyKnown).forEach(p => {
    if (p.id === here.id) return;
    const dist = (here.distances && here.distances[p.id]) || 0;
    if (!dist) return;
    const there = sellPrice(p.id, c);
    const profitPerLy = (there - buyPrice(here.id, c)) / dist;
    if (!best || profitPerLy > best.profitPerLy) best = { p, there, dist, profitPerLy };
  });
  return best;
}
// everything sellable (legal) in your hold at this market, for the one-click "Sell hold" action
function sellableHoldPreview() {
  const p = currentPlanet();
  const parts = [];
  CARGO_IDS.forEach(c => {
    const qty = S.res[c] || 0;
    if (qty <= 0 || isIllegalAt(c, p.id)) return;
    const slip = tradeSlippage(p, c, qty);
    const rev = Math.round(sellPrice(p.id, c) * (1 - slip / 2) * qty);
    parts.push({ c, qty, slip, rev });
  });
  const illegalHeld = CARGO_IDS.filter(c => (S.res[c] || 0) > 0 && isIllegalAt(c, p.id));
  return { total: parts.reduce((s, x) => s + x.rev, 0), parts, illegalHeld };
}
function sellEntireHold() {
  const { parts, illegalHeld, total } = sellableHoldPreview();
  if (!parts.length) return toast(illegalHeld.length ? "Only illegal goods in hold here — sell those individually (risks a customs check)." : "Your hold is empty.", "bad");
  const p = currentPlanet();
  const summary = [];
  parts.forEach(({ c, qty, slip, rev }) => {
    S.res[c] -= qty; S.res.credits += rev;
    summary.push(`${qty}${COM[c].ico}`);
    applyMarketMove(p.id, c, slip, true);
  });
  S.stats.trades++; S.stats.profit += total; S.stats.sales = (S.stats.sales || 0) + total; addRep(p.faction, 1);
  log(`Sold your hold — ${summary.join(" ")} for <span class="c">${fmt(total)}</span> cr${illegalHeld.length ? ` (${illegalHeld.length} illegal good(s) held back)` : ""}.`, "good");
  toast(`Sold hold (+${fmt(total)} cr)`, "good"); sfx("sell");
  afterAction();
}
function renderMarket() {
  const el = document.getElementById("panel-market");
  const p = currentPlanet();
  const showTrend = S.techs.markets;
  const flipCache = {};
  const flipFor = c => (c in flipCache) ? flipCache[c] : (flipCache[c] = bestFlipFor(c));
  let rows = "";
  TIERS.forEach(tier => {
    let ids = COM_IDS.filter(c => COM[c].tier === tier);
    if (!ids.length) return;
    if (!tierRevealed(tier) && !ids.some(c => (S.res[c] || 0) > 0)) return;   // hidden until disclosed (unless you carry some)
    if (marketSort === "margin") ids = ids.slice().sort((a, b) => (flipFor(b) ? flipFor(b).profitPerLy : -Infinity) - (flipFor(a) ? flipFor(a).profitPerLy : -Infinity));
    rows += `<tr><td colspan="6" class="section-title" style="padding-top:14px">${tier}</td></tr>`;
    ids.forEach(c => {
      const bp = buyPrice(p.id, c), sp = sellPrice(p.id, c), base = COM[c].base;
      const trend = bp > base * 1.12 ? '<span class="price-up">▲</span>' : bp < base * 0.88 ? '<span class="price-down">▼</span>' : '<span class="hint">—</span>';
      const illegal = isIllegalAt(c, p.id) ? ' <span class="pill bad" title="Contraband here">illegal</span>' : '';
      const flip = flipFor(c);
      const flipHint = (flip && flip.profitPerLy > 0 && flip.there > sp * 1.15)
        ? ` <span class="hint" title="Best flip: buy here, sell at ${flip.p.name} for ${fmt(flip.there)} cr (${flip.dist} ly) — ~${fmt(Math.round(flip.profitPerLy))} cr/ly profit">💡${flip.p.name}</span>` : "";
      rows += `<tr>
        <td>${COM[c].ico} ${COM[c].name}${illegal}</td>
        <td class="num">${fmt(bp)}</td><td class="num">${fmt(sp)}${flipHint}</td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td>${showTrend ? trend : '<span class="hint">?</span>'}</td>
        <td><div class="trade-controls">
          <input class="qty" id="qty-${c}" type="number" min="1" value="${marketQty[c] || 10}" />
          <button class="btn btn-sm btn-good" onclick="buyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-good" title="Buy until cargo/tank is full" onclick="buyMax('${c}')">Fill</button>
          <button class="btn btn-sm btn-bad" onclick="sellQty('${c}')">Sell</button>
          <button class="btn btn-sm btn-bad" title="Sell your entire stock" onclick="sellAll('${c}')">All</button>
        </div></td></tr>`;
    });
  });
  if (TIERS.some(t => !tierRevealed(t))) rows += `<tr><td colspan="6" class="hint" style="padding-top:12px">🔒 Advanced markets (components, finished goods, luxuries, strategics) open once you <b>manufacture your first Medicine</b> — see Missions → Next Steps.</td></tr>`;
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
  const sortBtns = `<span class="hint">Sort:</span> <button class="btn btn-sm ${marketSort === "default" ? "btn-primary" : ""}" onclick="setMarketSort('default')">Default</button> <button class="btn btn-sm ${marketSort === "margin" ? "btn-primary" : ""}" title="Rank each tier by its best known cross-world profit per light-year" onclick="setMarketSort('margin')">💡 Best margin</button>`;
  const holdPreview = sellableHoldPreview();
  const sellHoldBtn = holdPreview.parts.length
    ? `<button class="btn btn-bad" style="margin-top:10px" title="Sell every legal good in your hold at today's prices${holdPreview.illegalHeld.length ? ` (${holdPreview.illegalHeld.length} illegal good(s) here will be held back)` : ""}" onclick="sellEntireHold()">💰 Sell entire hold (+${fmt(holdPreview.total)} cr)</button>` : "";
  el.innerHTML = `<h2>${p.name} Market ${_mcr ? `<span class="pill bad">${CRISES[_mcr.type].ico} crisis</span>` : ""}</h2>
    <div class="subtitle">${p.tag}. ${showTrend ? "Galactic Exchange reveals trends &amp; deepens liquidity." : "Research the Galactic Exchange to reveal price trends."} Large trades move the price — dumping a lot crashes it, bulk buying spikes it; markets recover over cycles. Items marked <span class="pill bad">illegal</span> risk a customs bust here.${hasBlackMarket(p) ? ' A <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">black market</span> operates here.' : ''} 💡 hints show the best known world to flip a good you buy here.</div>
    ${crisisBanner}
    <div class="row" style="margin:8px 0;flex-wrap:wrap;gap:6px;align-items:center">${sortBtns}</div>
    <table><thead><tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Hold</th><th>Trend</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${blackMarket}
    <div class="row" style="margin-top:14px"><span class="hint">Cargo ${cargoUsed()}/${cargoCap()} · Fuel ${S.res.fuel}/${fuelCap()} · Credits ${fmt(S.res.credits)}</span></div>
    ${sellHoldBtn}`;
}
function buyQty(c) { const v = +document.getElementById("qty-" + c).value; marketQty[c] = v; buy(c, v); }
function sellQty(c) { const v = +document.getElementById("qty-" + c).value; marketQty[c] = v; sell(c, v); }
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
  marketQty[c] = qty;
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

  const IND_VIEWS = [["extract", "⛏️ Extraction"], ["produce", "🏭 Production"]];
  const body = subView("industry", IND_VIEWS) === "produce"
    ? `<div class="section-title">🏭 Production</div>
       <div class="cards">${prodCards}</div>`
    : `<div class="section-title">⛏️ Extraction (here)</div>
       <div class="cards">${extractCards || '<div class="hint">No raw deposits on this world — trade or produce instead.</div>'}</div>`;
  el.innerHTML = `<h2>Industry — ${p.name}</h2>
    <div class="subtitle">Industry level ${p.industry}/10. Extract raw materials (only what this world holds), then refine and manufacture them. Each task uses 1 action. Actions left: <b>${al}</b>.</div>
    ${subTabBar("industry", IND_VIEWS)}
    ${body}`;
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
    const r = TECH_RESEARCH[t.id];
    const mats = techMatCost(t);
    const affine = r && worldAffinity(p, r.domain);
    const gateOk = techMinTechMet(t);
    const canPts = S.res.tech >= t.cost, canMat = canAfford(mats);
    const domainLine = r ? `<div class="hint">${TECH_DOMAINS[r.domain] || r.domain} research${affine ? ' · <span style="color:var(--good)">local expertise (materials halved)</span>' : '<span style="opacity:.7"> · no local expertise here</span>'}</div>` : "";
    const matLine = (!done && Object.keys(mats).length) ? `<div class="hint">Materials: ${matsString(mats)}</div>` : "";
    const gateLine = (!done && r && r.minTech && !gateOk) ? `<div class="hint" style="color:var(--bad)">🔒 needs a Tech ${r.minTech}+ world (here: ${effTech(p)})</div>` : "";
    return `<div class="${cls}">
      <h4>${t.ico} ${t.name} ${done ? '<span class="pill good">researched</span>' : ""}</h4>
      <div class="desc">${t.desc}</div>
      ${reqTxt ? `<div class="hint">${reqTxt}</div>` : ""}
      ${done ? "" : domainLine + matLine + gateLine}
      <div class="meta"><span class="cost">${t.cost} 🔬${Object.keys(mats).length ? " + materials" : ""}</span>
        ${done ? "" : `<button class="btn btn-primary" ${avail && canPts && canMat && gateOk ? "" : "disabled"} onclick="researchTech('${t.id}')">Research</button>`}</div>
    </div>`;
  }).join("");
  const researched = TECHS.filter(techUnlocked).length;
  const RES_VIEWS = [["lab", "🔬 Laboratory"], ["tree", `🌳 Tech Tree (${researched}/${TECHS.length})`]];
  const expPts = Math.round((2 + effTech(p)) * (1 + S.upgrades.lab * 0.40));
  const haveEnergy = (S.res.energy || 0) >= RESEARCH_ENERGY;
  const labBody = `<div class="cards"><div class="card">
      <h4>🔬 Run Experiments</h4>
      <div class="desc">Burns <b>${RESEARCH_ENERGY} ⚡ energy</b> to power the lab. Output scales with this world's tech level (${effTech(p)}/10) and your Research Lab — research at a tech hub for far more.</div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">+${expPts} 🔬 · −${RESEARCH_ENERGY}⚡</span></div>
      ${haveEnergy ? "" : `<div class="hint" style="color:var(--bad)">Not enough energy (have ${fmt(S.res.energy || 0)}⚡) — refine or buy some.</div>`}
      <button class="btn btn-primary" ${al > 0 && haveEnergy ? "" : "disabled"} onclick="research()">Research (1 action)</button>
    </div>
    <div class="card"><h4>📈 Knowledge</h4>
      <div class="ship-stat"><span class="k">🔬 Tech points</span><span class="v">${fmt(S.res.tech)}</span></div>
      <div class="ship-stat"><span class="k">🧪 Researched</span><span class="v">${researched} / ${TECHS.length}</span></div>
      <div class="ship-stat"><span class="k">🔬 Lab tier</span><span class="v">${S.upgrades.lab ? "Tier " + S.upgrades.lab : "none"}</span></div>
      <div class="hint" style="margin-top:6px">Switch to the 🌳 Tech Tree to spend points.</div>
    </div></div>`;
  const body = subView("research", RES_VIEWS) === "tree"
    ? `<div class="section-title">Technology Tree</div><div class="cards">${techCards}</div>`
    : labBody;
  el.innerHTML = `<h2>Research & Technology</h2>
    <div class="subtitle">Generate tech points, then unlock new extraction, production and strategic tech. You have <b>${fmt(S.res.tech)} 🔬</b>.</div>
    ${subTabBar("research", RES_VIEWS)}
    ${body}`;
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
      ${renderSectorRelations()}
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

  const gateSteps = DISCLOSURE_GATES.filter(g => !(S.disc && S.disc[g.id])).map(g =>
    `<div class="card" style="border-color:var(--accent)"><h4>${g.icon} ${g.goal}</h4><div class="hint">🔓 ${g.reward}${g.fallbackTurn ? ` · or automatically by cycle ${g.fallbackTurn}` : ""}</div></div>`).join("");
  const tabSteps = (typeof TAB_LADDER !== "undefined" ? TAB_LADDER : []).filter(g => !(S.unlocked && S.unlocked[g.id])).map(g =>
    `<div class="card"><h4>🔓 ${tabLabel(g.id)}</h4><div class="hint">${g.blurb} — ${g.hint}</div></div>`).join("");
  const nextSteps = gateSteps + tabSteps;
  const nextStepsSection = nextSteps ? `<div class="section-title">🧭 Next Steps — unlock new features</div><div class="cards">${nextSteps}</div>` : "";
  el.innerHTML = `<h2>🎯 Missions</h2>
    <div class="subtitle">Everything with an objective in one place: <b>time-bound contracts</b> race the clock, <b>career missions</b> unlock as you grow, and your <b>legacy goals</b> are the long game that wins it all.</div>
    ${nextStepsSection}
    <div class="section-title">📋 Contracts (time-bound)</div>
    <div class="cards">${contractCards}</div>
    <div class="section-title">🧭 Career Missions (long-term)</div>
    <div class="cards">${missionCards}</div>
    <div class="section-title">🏆 Your Legacy (win conditions)</div>
    <div class="cards"><div class="card">${goals}<div class="hint">Net worth: ${fmt(netWorth())} cr</div></div></div>`;
}

/* ----- Ship ----- */
/* tactical readout + weapon buttons for a prey/encounter card */
function tacticalHTML(t, attackFn) {
  const al = actionsLeft();
  const scanBtn = t.scanned ? "" :
    `<button class="btn btn-sm" title="Reveal defenses, weapon class and the best counter${S.upgrades.aimain >= 1 ? " (free — AI Mainframe)" : " (4 ⚡)"}" onclick="deepScan()">🔍 Deep Scan${S.upgrades.aimain >= 1 ? "" : " (4⚡)"}</button>`;
  foeHp(t);                                  // lock in the real (rubber-banded) hull so the readout doesn't jump after the first shot
  const _max = t.maxhp, _hp = t.hp;
  const _pct = Math.max(0, Math.min(100, _hp / _max * 100));
  const _hpCol = _pct >= 60 ? "var(--good)" : _pct >= 30 ? "var(--warn)" : "var(--bad)";
  const badges = `${t.elite ? '<span class="pill bad" title="Elite captain — tougher, hardened against your favourite weapon">💀 ELITE</span> ' : ""}${(t.escorts || 0) > 0 ? `<span class="pill" title="Fights with ${t.escorts} escort(s) — more hull, heavier fire">🛰️ ${t.escorts} escort${t.escorts > 1 ? "s" : ""}</span> ` : ""}`;
  const hullBar = `${badges ? `<div style="margin-top:4px">${badges}</div>` : ""}<div class="ship-stat" style="margin-top:4px"><span class="k">Foe hull</span><span class="v" style="color:${_hpCol}">${Math.max(0, Math.round(_hp))}/${_max}</span></div>
    <div class="bar"><span style="width:${_pct}%;background:${_hpCol}"></span></div>`;
  // live tactical stats: revealed by a scan, or learned once you've traded fire —
  // so you can watch Weapons-targeting drop its strength and Defenses-targeting strip its layers
  const known = t.scanned || t._engaged;
  const engDots = (t.enginesMax || 0) > 0 ? Array.from({ length: t.enginesMax }, (_, i) => i < (t.engines || 0) ? "●" : "○").join("") : "";
  const profile = known
    ? `<div class="hint">💥 strength <b>${Math.round(t.strength)}</b> · 🛡️ <b>${t.def.armor}</b> 🔰 <b>${t.def.shield}</b> 📡 <b>${t.def.pd}</b>${engDots ? ` · 🚀 drive <b>${engDots}</b>` : ""}${t.scanned ? ` · fires <b>${t.wtype}</b> — counter <b>${bestWeaponHint(t).ico} ${bestWeaponHint(t).name}</b>` : ""}</div>`
    : `<div class="hint">Capabilities unknown — a 🔍 Deep Scan reveals its defenses and the best counter.</div>`;
  // warn when a hurt foe with live engines may bolt
  const fleeWarn = (t.engines || 0) > 0 && t.hp != null && t.hp / t.maxhp < 0.55
    ? `<div class="hint" style="color:var(--warn)">⚠️ Drive still live — it may jump away. Target 🚀 Engines to pin it.</div>` : "";
  const lastW = combatState().lastWeapon;
  const recW = t.scanned ? bestWeaponHint(t) : null;
  const weapons = Object.keys(WEAPONS).filter(weaponAvailable).map(w => {
    const W = WEAPONS[w];
    const ammoStr = Object.entries(W.ammo).map(([c, q]) => `${q}${COM[c].ico}`).join("") || "free";
    const eff = t.scanned ? ` ×${weaponEff(w, t).toFixed(2)}` : "";
    const ok = weaponAffordable(w);   // combat is a free sub-loop — attacking costs no cycle-actions (the sweep paid)
    const isSel = lastW === w;        // the weapon you last fired — the active one
    const isRec = recW === W;         // the recommended counter (a hint, not a selection)
    return `<button class="btn btn-sm ${isSel ? "btn-primary" : ""}" ${ok ? "" : "disabled"}
      title="${W.name} — ammo: ${ammoStr}${isRec ? " · ★ recommended counter" : ""}${t.scanned ? ` · effectiveness vs this target${eff}` : ""}"
      onclick="${attackFn}('${w}')">${W.ico}${isRec ? "★" : ""}${eff}</button>`;
  }).join(" ");
  const dr = dronesDeployable();
  const droneLine = (S.upgrades.dronebay || 0) > 0
    ? `<div class="hint">🛸 ${dr > 0 ? `Will deploy <b>${dr}</b> drone${dr > 1 ? "s" : ""}${t.scanned && t.def.pd > 0 ? " (their point-defense will thin them)" : ""}` : "Drone Bay empty — stock 🛸 Combat Drones"}</div>` : "";
  const c = combatState();
  const budget = combatBudget();
  const postureBtns = Object.entries(COMBAT_PRESETS).map(([k, pre]) =>
    `<button class="btn btn-sm ${c.posture === k && !c.advanced ? "btn-primary" : ""}" title="${pre.hint}" onclick="setCombatPosture('${k}')">${pre.label}</button>`).join(" ");
  const advBtn = `<button class="btn btn-sm ${c.advanced ? "btn-primary" : ""}" title="Fine-tune the offense/defense split" onclick="setCombatOffense(${c.offense})">⚙️ Advanced</button>`;
  const advRow = c.advanced
    ? `<div class="row" style="margin-top:4px;align-items:center"><span class="hint">Offense ${c.offense}% / Defense ${100 - c.offense}%</span>
       <input type="range" min="0" max="100" step="5" value="${c.offense}" oninput="setCombatOffense(this.value)" style="flex:1;min-width:120px" /></div>`
    : "";
  const budgetNote = budget > 100 ? ` <span class="hint">· power budget ${budget}% (reactor/AI)</span>` : "";
  const targetBtns = Object.entries(COMBAT_TARGETS).map(([k, tg]) =>
    `<button class="btn btn-sm ${c.target === k ? "btn-primary" : ""}" title="${tg.hint}" onclick="setCombatTarget('${k}')">${tg.ico} ${tg.name}</button>`).join(" ");
  const frWorth = fieldRepairWorthwhile(), frHasMat = canFieldRepair(), frUsable = frWorth && frHasMat;
  const frMatsPlain = Object.entries(FIELD_REPAIR.mats).map(([c, q]) => `${q}${COM[c].ico}`).join(" + ");   // plain text — safe inside the title attribute
  const frLabel = !frWorth ? "🔧 Field Repair — hull & systems sound"
    : !frHasMat ? `🔧 Field Repair — need ${frMatsPlain} aboard`
    : `🔧 Field Repair (+${FIELD_REPAIR.hull} hull · ${frMatsPlain})`;
  const frBtn = `<button class="btn btn-sm ${frUsable ? "btn-good" : ""}" ${frUsable ? "" : "disabled"} title="Emergency patch: +${FIELD_REPAIR.hull} hull and shore up your worst subsystem for ${frMatsPlain} — but you hold fire this round and the foe attacks" onclick="fieldRepair()">${frLabel}</button>`;
  const ownHullCol = S.pirate.hull >= 60 ? "var(--good)" : S.pirate.hull >= 30 ? "var(--warn)" : "var(--bad)";
  return `${hullBar}${profile}${fleeWarn}${droneLine}
    <div class="row" style="margin-top:8px;align-items:center"><span class="hint">Posture:</span> ${postureBtns} ${advBtn}${budgetNote}</div>
    ${advRow}
    <div class="row" style="margin-top:4px;align-items:center"><span class="hint">Target:</span> ${targetBtns}</div>
    <div class="row" style="margin-top:6px;align-items:center">${scanBtn} <span class="hint">Fire:</span> ${weapons}${t._engaged && combatState().lastWeapon ? ` <button class="btn btn-sm" title="Repeat your last attack (${WEAPONS[combatState().lastWeapon] ? WEAPONS[combatState().lastWeapon].name : ""}) for up to 5 rounds — handy for grinding down big hulls" onclick="raidVolley(5)">⏩ Volley ×5</button>` : ""}</div>
    <div class="row" style="margin-top:6px;align-items:center"><span class="hint">🛡️ Your hull <b style="color:${ownHullCol}">${S.pirate.hull}/${HULL_MAX}</b> ·</span> ${frBtn}</div>`;
}
function preyCombatCard(prey, al) {
  const isPirate = prey.isPirate;
  const who = isPirate ? `<span class="pill bad">🏴 Pirate</span>` : `<span class="pill">${FACTIONS[prey.faction].ico} ${FACTIONS[prey.faction].name}</span>`;
  const reward = isPirate
    ? `<span class="pill good">🎯 bounty ${fmt(prey.bounty)} 💰</span>`
    : `<span class="hint">Hold: ${Object.keys(prey.cargo).map(c => `${prey.cargo[c]}${COM[c].ico}`).join(" ") || "scant"} · ${fmt(prey.credits)} 💰</span>`;
  const pinned = (prey.engines || 0) <= 0;
  const lawNote = isPirate
    ? `A <b>lawful kill</b> — bounty, salvage, faction goodwill, no Wanted.`
    : `Raiding coalition shipping earns <b>Wanted</b>. ${pinned ? "" : "Cripple its 🚀 engines so it can't run."}`;
  // pirates loitering in the area you can recruit (loot shared); rescuers already engaged
  const areaPirates = (prey._others || []).filter(o => o.isPirate).length;
  const allyN = (S.allies && S.allies.length) || 0;
  const packN = (prey.pack || []).length;
  const callBtn = (areaPirates > 0 && allyN < 2)
    ? `<button class="btn btn-sm" title="Call ${areaPirates} pirate(s) in the area to your side — they fire independently, loot splits evenly" onclick="raidCallAllies()">📣 Call pirate allies (${areaPirates})</button>`
    : "";
  const onCallBtns = (allyN < 2 ? bandsRaidable().filter(b => b.id !== prey.bandId && !bandRivalServing(b) && !(S.allies || []).some(a => a.bandId === b.id)) : [])
    .map(b => `<button class="btn btn-sm btn-good" title="${bandTagMark(b)} ${b.name} ${bandFollowing(b) ? "are riding with you" : bandOnCall(b) ? "are standing by" : "are based here"} — bring them in (${Math.round(bandLootShare(b) * 100)}% cut)" onclick="raidSummonOnCall('${b.id}')">📣 ${bandTagMark(b)}${b.ico} ${b.name}</button>`).join("");
  // your own loyal warships — callable into any fight, no loot cut
  const fleetBtns = (allyN < 2 ? fleetRaidable().filter(s => !(S.allies || []).some(a => a.fleetId === s.id)) : [])
    .map(s => `<button class="btn btn-sm btn-good" title="Your ${FLEET_SHIPS[s.key].name} — joins loyally, no loot cut" onclick="raidSummonFleet('${s.id}')">✦ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join("");
  const squadLine = (packN > 0 || allyN > 0)
    ? `<div class="hint">${packN > 0 ? `<span class="pill bad">⚔️ ${packN + 1} hostiles</span> ` : ""}${allyN > 0 ? `<span class="pill good">🤝 ${allyN} ally${allyN > 1 ? "ies" : ""} · loot split ${allyN + 1} ways</span>` : ""}</div>`
    : "";
  const spareBtn = (typeof raidCanSpare === "function" && raidCanSpare())
    ? `<button class="btn btn-sm btn-good" title="Hold fire and let the beaten crew live — a big boost to their collaboration" onclick="raidSpareRecruit()">🤝 Spare crew (+standing)</button>` : "";
  const buttons = isPirate
    ? `${spareBtn}${callBtn}${onCallBtns}${fleetBtns}<button class="btn btn-sm" onclick="raidDisengage()">Break off</button>`
    : `<button class="btn btn-bad" title="Slaughter the crew: more Dread, more Wanted" onclick="raidNoQuarter()">☠️ No Quarter</button>
       <button class="btn btn-sm" title="Spend Dread to extort tribute — no fight (Dread −12)" onclick="raidExtort()">💀 Extort</button>
       ${callBtn}${onCallBtns}${fleetBtns}<button class="btn btn-sm" onclick="raidDisengage()">Disengage</button>`;
  // no crew at hand, but you have friends out there — tell the player how to bring them
  const willingElsewhere = bandList().filter(b => b.status !== "dead" && bandWillAlly(b) && b.id !== prey.bandId).length;
  const crewHint = (allyN === 0 && callBtn === "" && onCallBtns === "" && willingElsewhere > 0)
    ? `<div class="hint">🤝 No allied crew on the scene. Summon one from the 🏴‍☠️ <b>Contacts</b> tab (📣 Call for support) or set a crew to 🛰️ <b>Follow</b> you — standing-by, following, and locally-based crews fight at your side here, even under a letter of marque.</div>` : "";
  const preyBand = prey.bandId ? bandById(prey.bandId) : null;
  const bandLine = preyBand ? `<div class="hint">${bandTagMark(preyBand)} of the <b>${preyBand.name}</b> · ${bandPers(preyBand).ico} ${bandPers(preyBand).name} · ${bandTier(preyBand).label} (${preyBand.rep}) · based at ${bandLocName(preyBand)}</div>` : "";
  // Battle Group: your WHOLE idle warship fleet as a pooled formation, separate from the 2-ally cap
  const bgShips = battleGroupShips(), bgIdle = fleetRaidable();
  let bgBlock = "";
  if (bgShips.length) {
    const posture = S.battleGroupPosture || "balanced";
    const postBtns = Object.entries(ESCORT_POSTURES).map(([k, p]) => `<button class="btn btn-sm ${posture === k ? "btn-primary" : ""}" title="${p.hint}" onclick="setBattleGroupPosture('${k}')">${p.label}</button>`).join(" ");
    const bgHull = bgShips.reduce((s, x) => s + x.hull, 0), bgHullMax = bgShips.reduce((s, x) => s + x.hullMax, 0);
    const frontTier = shipFormation(battleGroupFrontTier()[0] || {});
    const tierRows = FORMATION_TIERS.map(t => {
      const def = FORMATION_SLOTS[t];
      const members = bgShips.filter(s => shipFormation(s) === t);
      const tHull = members.reduce((s, x) => s + x.hull, 0), tHullMax = members.reduce((s, x) => s + x.hullMax, 0);
      const holding = t === frontTier;
      const shipRows = members.map(s => {
        const otherSlots = FORMATION_TIERS.filter(k => k !== t);
        const moveBtns = otherSlots.map(k => `<button class="btn btn-sm" title="Move to ${FORMATION_SLOTS[k].name}" onclick="setBattleGroupFormation('${s.id}','${k}')">${FORMATION_SLOTS[k].ico}</button>`).join("");
        return `<div class="ship-stat" style="align-items:center;font-size:12px"><span class="k">${FLEET_SHIPS[s.key].ico} ${s.name}</span><span class="v">${Math.round(s.hull)}/${s.hullMax} ${moveBtns}</span></div>`;
      }).join("");
      return `<div style="margin-top:4px${members.length ? "" : ";opacity:.5"}">
        <div class="hint" title="${def.hint}"><b>${def.ico} ${def.name}</b>${members.length ? ` — ${members.length} ship(s), ${Math.round(tHull)}/${tHullMax} hull${holding ? ' <span style="color:var(--bad)">◀ taking fire</span>' : ""}` : " — empty"}</div>
        ${shipRows}</div>`;
    }).join("");
    bgBlock = `<div class="hint" style="margin-top:6px">✦ <b>Battle fleet</b> (${bgShips.length} ship${bgShips.length === 1 ? "" : "s"}): 🔥${battleGroupFirepower()} pooled firepower · 🛡️ ${Math.round(bgHull)}/${bgHullMax} hull</div>
      <div class="row" style="margin-top:4px;flex-wrap:wrap;gap:4px"><span class="hint">Posture:</span> ${postBtns} <button class="btn btn-sm" onclick="recallBattleGroup()">↩ Recall fleet</button></div>
      ${tierRows}`;
  } else if (bgIdle.length) {
    bgBlock = `<div class="row" style="margin-top:6px"><button class="btn btn-sm btn-good" title="Deploy your whole idle warship fleet (${bgIdle.length}) as a pooled formation — no loot cut, escort-style posture, but they take real damage and can be lost" onclick="deployBattleGroup()">✦ Deploy Battle Fleet (${bgIdle.length})</button></div>`;
  }
  return `<div class="card" style="border-color:${isPirate ? "var(--good)" : "var(--warn)"}">
    <h4>${preyBand ? bandTagMark(preyBand) : ""}${classLabel(prey)} <span class="hint">— ${prey.name}</span> ${who} ${reward}${pinned ? ' <span class="pill bad">🚀 pinned</span>' : ""}</h4>
    ${bandLine}
    <div class="hint">${lawNote}</div>
    ${squadLine}${crewHint}
    ${tacticalHTML(prey, "raidAttack")}
    <div class="row" style="margin-top:6px">${buttons}</div>
    ${bgBlock}
  </div>`;
}
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
    <div class="ship-stat" style="margin-top:10px"><span class="k">🛠️ Subsystems</span><span class="v">${SUBSYS.every(k => shipCond(k) >= 100) ? '<span class="pill good">all nominal</span>' : '<span class="pill bad">damaged</span>'}</span></div>
    ${SUBSYS.map(k => { const c = shipCond(k), col = c >= 60 ? "var(--good)" : c >= 30 ? "var(--warn)" : "var(--bad)", m = SUBSYS_META[k];
      return `<div class="ship-stat"><span class="k">${m.ico} ${m.name}</span><span class="v" style="color:${col}">${c}%</span></div>
        <div class="bar"><span style="width:${c}%;background:${col}"></span></div>`;
    }).join("")}
    ${(P.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100)) ? `<div class="hint" style="margin-top:6px">🔧 Full repairs at the 🚀 <b>Ship</b> tab (Repair Bay). Mid-fight, use 🔧 Field Repair below.</div>` : ""}
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
    const fleeOdds = Math.round(Math.max(5, Math.min(95, (0.45 + S.upgrades.engine * 0.15 + (S.upgrades.aimain || 0) * 0.08 - e.level * 0.05) * 100)));
    action = `<div class="card" style="border-color:var(--bad)">
      <h4>🏴‍☠️ Ambush: ${classLabel(e)} <span class="hint">— ${e.name}</span> <span class="pill bad">🏴 Pirate</span></h4>
      <div class="hint">It demands <b>${fmt(e.toll)} 💰</b> to let you pass. Bounty on its head ${fmt(e.bounty)} cr. ${(e.engines||0)>0 ? "Cripple its 🚀 engines if you mean to stop it running." : ""}</div>
      <div class="meta"><span class="hint">Fight odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${e.strength}</span></div>
      ${tacticalHTML(e, "encounterFight")}
      <div class="row" style="margin-top:6px">
        <button class="btn btn-sm" ${S.res.credits >= e.toll ? "" : "disabled"} title="Pay the toll — bloodless, but galling" onclick="encounterPay()">💰 Pay ${fmt(e.toll)}</button>
        <button class="btn btn-sm" title="Burn for it — failing costs hull" onclick="encounterFlee()">🏃 Flee (~${fleeOdds}%)</button>
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
  } else if (S.prey) {
    action = preyCombatCard(S.prey, al);
  } else if (S.preyChoices && S.preyChoices.length) {
    const rows = S.preyChoices.map((c, i) => {
      const who = c.isPirate ? `<span class="pill bad">🏴 Pirate</span>` : `<span class="pill">${FACTIONS[c.faction].ico} ${FACTIONS[c.faction].name}</span>`;
      const eliteTag = c.elite ? ` <span class="pill bad">💀 elite</span>` : "";
      const escTag = (c.escorts || 0) > 0 ? ` <span class="pill">🛰️ ${c.escorts} escort${c.escorts > 1 ? "s" : ""}</span>` : "";
      return `<div class="card" style="padding:10px">
        <h4 style="margin:0">${classLabel(c)} <span class="hint">— ${c.name}</span></h4>
        <div style="margin:6px 0">${who}${eliteTag}${escTag}</div>
        <button class="btn btn-primary btn-sm" ${al >= 0 ? "" : "disabled"} onclick="engageTarget(${i})">⚔️ Engage</button>
      </div>`;
    }).join("");
    action = `<div class="card"><h4>🔭 Contacts on the scope <span class="pill">${S.preyChoices.length}</span></h4>
      <div class="hint">Read the <b>hull class</b> and allegiance, then commit. Bigger classes hit harder, soak more, and run when losing — knock out their 🚀 engines to pin them. Coalition ships carry cargo (raiding earns Wanted); 🏴 pirates carry bounties (a lawful kill).</div>
      <div class="cards" style="margin-top:8px">${rows}</div>
      <button class="btn btn-sm" style="margin-top:8px" onclick="standDown()">Stand down</button>
    </div>`;
  } else {
    const armed = S.upgrades.cannons >= 1;
    const lvl = pirateLevel(p.id);
    const richness = p.enforce >= 0.5 ? "fat, well-escorted lawful traffic — and bigger hulls" : p.enforce >= 0.25 ? "mixed traffic" : "lean rim runners, smugglers & pirates";
    action = `<div class="card">
      <h4>🔭 Sweep the lanes near ${p.name} ${lvl > 0 ? `<span class="pill ${lvl >= 2 ? "bad" : ""}">pirate activity ${lvl}</span>` : '<span class="pill good">lanes quiet</span>'}</h4>
      <div class="desc">One sweep turns up several contacts — coalition traffic and pirates alike (${richness}). You'll see each one's faction and <b>hull class</b>; pick your mark. Lawful space runs richer and heavier; the lawless rim is leaner. Costs ${PROWL_FUEL} ⛽ and one action.</div>
      ${armed ? "" : `<div class="hint" style="color:var(--warn)">Install 🔫 Weapon Systems (Ship tab) to raid with any real teeth.</div>`}
      <button class="btn btn-primary" ${al > 0 && S.res.fuel >= PROWL_FUEL ? "" : "disabled"} onclick="prowl()">Sweep (1 action)</button>
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
      <div class="hint">Sanctioned to raid <b>${FACTIONS[c.target].ico} ${FACTIONS[c.target].name}</b> shipping — their kills draw no Wanted and pay a ${fmt(c.bounty)} cr bounty. Bring your brotherhood: crews <b>🛰️ following</b> you join these hunts on their own, and any standing-by crew can be summoned mid-fight. Don't turn on your patron.</div>
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
  // ---- Pirate intel charts ----
  const mapBtns = Object.entries(PIRATE_MAP).map(([k, m]) =>
    `<button class="btn btn-sm" ${S.res.credits >= m.cost ? "" : "disabled"} title="Reveal pirate activity ${m.ly === Infinity ? "across the whole sector" : "within " + m.ly + " ly"} for ${PIRATE_INTEL_DURATION} cycles" onclick="buyPirateMap('${k}')">${m.ico} ${m.name} (${fmt(m.cost)} 💰)</button>`).join(" ");
  let intelCard;
  if (pirateIntelActive()) {
    const left = S.pirateIntel.until - S.turn;
    const rows = S.pirateIntel.worlds
      .map(id => ({ id, pl: PLANETS.find(x => x.id === id), lvl: pirateLevel(id), d: currentPlanet().distances[id] || 0 }))
      .filter(r => r.pl)
      .sort((a, b) => b.lvl - a.lvl || a.d - b.d)
      .map(r => `<div class="ship-stat"><span class="k">${r.pl.name} <span class="hint">${r.id === S.location ? "here" : r.d + " ly"}</span></span><span class="v" style="color:${r.lvl >= 2 ? "var(--bad)" : r.lvl >= 1 ? "var(--warn)" : "var(--good)"}">${r.lvl > 0 ? "🏴 " + r.lvl : "clear"}</span></div>`).join("");
    const hot = S.pirateIntel.worlds.filter(id => pirateLevel(id) > 1).length;
    intelCard = `<div class="card"><h4>🗺️ Pirate Intel <span class="pill ${left <= 2 ? "bad" : ""}">${left} cyc left</span></h4>
      <div class="hint">${hot ? `<b>${hot}</b> charted world(s) above activity 1 — hunt them down to pacify the sector.` : "All charted worlds are pacified (≤1)."}</div>
      <div style="margin:6px 0">${rows}</div>
      <div class="row">${mapBtns}</div></div>`;
  } else {
    intelCard = `<div class="card"><h4>🗺️ Buy Pirate Intel</h4>
      <div class="desc">Charts reveal pirate activity by world for ${PIRATE_INTEL_DURATION} cycles — find hotspots to hunt (the path to pacifying the sector) or lanes to avoid. Activity shows on the 🪐 Galaxy map too.</div>
      <div class="row">${mapBtns}</div></div>`;
  }
  el.innerHTML = `<h2>⚔️ Raider</h2>
    <div class="subtitle">Two trades, one gun: <b>prey on shipping</b> (build Dread, mind your Wanted — the navy interdicts the notorious; havens and letters of marque are an outlaw&#39;s tools) or <b>hunt pirates</b> for lawful bounties that scale with their rank — every kill calms the lanes, shielding your colonies and convoys. Travel through infested systems and the pirates may find <i>you</i>.</div>
    <div class="cards raid-top">${status}<div class="raid-action">${action}</div></div>
    <div class="cards" style="margin-top:14px">${intelCard}${commCard}${havenCard}${lordCard}${marshalCard}</div>`;
}
// ---- Pirate Contacts tab: manage the bands you've built history with ----
/* ============================================================
   MANDATES — commission a band to work a system for several cycles:
   cull pirates, guard the lanes, or prey on shipping. You pay an
   upfront fee and take a cut of what they bring in over the run.
   ============================================================ */
const MANDATE_TASKS = {
  cull:    { ico: "🎯", name: "Cull pirates",     cut: 0.55, base: 180, perLvl: 110, feeMul: 1.0, scalesPirate: true,  suppress: 0.30, heat: 0,   blurb: "Drive hostile crews out — lowers the system's pirate activity; you take a cut of the bounties." },
  protect: { ico: "🛡️", name: "Guard the lanes",  cut: 0.50, base: 150, perLvl: 90,  feeMul: 0.85, scalesPirate: false, suppress: 0.22, heat: 0,   blurb: "Patrol the system — steadily suppresses pirates; a share of the escort fees." },
  raid:    { ico: "🏴", name: "Prey on shipping", cut: 0.50, base: 190, perLvl: 110, feeMul: 1.1, scalesPirate: true,  suppress: 0,    heat: 2.5, blurb: "Plunder shipping in the system — a fat cut of the loot, but it's piracy in your name: Wanted climbs and the locals seethe." },
};
const MANDATE_DURATIONS = [3, 6, 9];
const MANDATE_ACT_CAP = 1.3;   // diminishing returns: a single mandate can't milk an infested system forever
function mdPlanetName(id) { const p = PLANETS.find(x => x.id === id); return p ? p.name : "?"; }
function bandOnMandate(b) { return !!(b && b.mandate); }
function mandateFee(b, planetId, task, dur) {
  const here = currentPlanet(), dist = (here.distances && here.distances[planetId]) || 0, lvl = b.level || 1;
  let fee = (70 + lvl * 42) * dur * (1 + dist * 0.025) * ((MANDATE_TASKS[task] || MANDATE_TASKS.cull).feeMul || 1);
  fee *= (1 - Math.min(0.30, ((b.rep || 0) / 100) * 0.30));   // friendlier crews charge less
  return Math.max(150, Math.round(fee));
}
function mandateAct(planetId, t) { return t.scalesPirate ? Math.min(MANDATE_ACT_CAP, 0.45 + pirateLevel(planetId) * 0.22) : 0.9; }
function mandateCycleYield(b, planetId, task) {
  const lvl = b.level || 1, t = MANDATE_TASKS[task] || MANDATE_TASKS.cull;
  return Math.round((t.base + lvl * t.perLvl) * mandateAct(planetId, t) * (0.6 + Math.random() * 0.8));
}
function mandateEstCut(b, planetId, task, dur) {   // average expected player cut over the run (preview)
  const lvl = b.level || 1, t = MANDATE_TASKS[task] || MANDATE_TASKS.cull;
  return Math.round((t.base + lvl * t.perLvl) * mandateAct(planetId, t) * t.cut * dur);
}
function mandateEligibleBands() { return bandList().filter(b => bandWillAlly(b) && !bandOnMandate(b) && !bandBusy(b) && !bandOnCall(b) && !bandInbound(b) && b.status === "active"); }
function commissionMandate(bandId, planetId, task, dur) {
  const b = bandById(bandId); if (!b) return toast("Pick a crew.", "bad");
  if (!MANDATE_TASKS[task]) return; dur = MANDATE_DURATIONS.includes(dur) ? dur : 6;
  if (bandOnMandate(b) || bandBusy(b)) return toast(`The ${b.name} are already occupied.`, "bad");
  if (!bandWillAlly(b)) return toast(`The ${b.name} won't take your coin.`, "bad");
  if (!planetId || !PLANETS.find(p => p.id === planetId)) return toast("Pick a target system.", "bad");
  const fee = mandateFee(b, planetId, task, dur);
  if ((S.res.credits || 0) < fee) return toast(`That mandate costs ${fmt(fee)} cr.`, "bad");
  S.res.credits -= fee;
  if (!Array.isArray(S.mandates)) S.mandates = [];
  const id = "md" + S.turn + "_" + Math.floor(Math.random() * 1e4);
  S.mandates.push({ id, bandId, planet: planetId, task, cyclesLeft: dur, total: dur, fee, accrued: 0, cut: MANDATE_TASKS[task].cut });
  b.mandate = id; b.busyUntil = S.turn + dur; b.loc = planetId;
  const t = MANDATE_TASKS[task];
  log(`📜 You commissioned the ${b.ico} ${b.name} to <b>${t.name.toLowerCase()}</b> at ${mdPlanetName(planetId)} for ${dur} cycles (−${fmt(fee)} cr).`, "event");
  toast(`${b.name} on mandate (${dur} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function processMandates() {
  if (!Array.isArray(S.mandates) || !S.mandates.length) return;
  for (let i = S.mandates.length - 1; i >= 0; i--) {
    const md = S.mandates[i], b = bandById(md.bandId), t = MANDATE_TASKS[md.task];
    if (!b || !t) { S.mandates.splice(i, 1); continue; }
    md.accrued += Math.round(mandateCycleYield(b, md.planet, md.task) * md.cut);
    if (t.suppress && Math.random() < t.suppress + 0.06 * (b.level || 1)) S.pirates[md.planet] = Math.max(0, pirateLevel(md.planet) - 1);
    if (md.task === "raid") {
      const fac = (PLANETS.find(p => p.id === md.planet) || {}).faction;
      const sanctioned = fac && commissionCovers(fac);                 // a letter of marque vs this faction makes it legal
      if (!sanctioned) S.pirate.wanted = Math.min(100, (S.pirate.wanted || 0) + t.heat);
      if (fac) addRep(fac, -1);                                        // you're still hurting them either way
      clampPirate();
    }
    md.cyclesLeft--;
    if (md.cyclesLeft <= 0) {
      S.res.credits += md.accrued; bandRepAdd(b, 6); b.mandate = null; b.loc = md.planet;
      log(`📜 The ${b.ico} ${b.name} finished their ${t.name.toLowerCase()} at ${mdPlanetName(md.planet)} — your cut: <b>${fmt(md.accrued)} cr</b>.`, "good");
      if (typeof toast === "function") toast(`${b.name} mandate done: +${fmt(md.accrued)} cr`, "good");
      digestNote("arrivals", `${b.name}'s mandate complete (+${fmt(md.accrued)} cr)`);
      if (typeof sfx === "function") sfx("good");
      S.mandates.splice(i, 1);
    }
  }
}
function cancelMandate(id) {
  const i = (S.mandates || []).findIndex(m => m.id === id); if (i < 0) return;
  const md = S.mandates[i], b = bandById(md.bandId);
  S.res.credits += md.accrued;                       // keep what they've earned so far; the fee is forfeit
  if (b) { b.mandate = null; b.busyUntil = S.turn; bandRepAdd(b, -4); }
  log(`📜 You recalled the ${b ? b.name : "crew"} from their mandate early — banked ${fmt(md.accrued)} cr (fee forfeit).`, "");
  toast("Mandate ended", ""); S.mandates.splice(i, 1); saveGame(); renderAll();
}
let mandateForm = { band: null, planet: null, task: "cull", dur: 6 };
function setMandateField(k, v) { mandateForm[k] = (k === "dur") ? (parseInt(v, 10) || 6) : v; renderContacts(); }
function renderContacts() {
  const el = document.getElementById("panel-contacts"); if (!el) return;
  const views = [["all", "🤝 All contacts"], ["around", "📍 Around here"], ["mandates", "📜 Mandates"]];
  const view = subView("contacts", views);
  const body = view === "around" ? renderContactsAround() : view === "mandates" ? renderContactsMandates() : renderContactsAll();
  el.innerHTML = `<h2>🏴‍☠️ Pirate Contacts</h2>${subTabBar("contacts", views)}${body}`;
}
function contactCard(b) {
  const giftCargo = ["weapons", "fuel", "luxury", "ai", "drones"].filter(c => (S.res[c] || 0) > 0);
  const t = bandTier(b), pr = bandPers(b), rival = bandFoe(b), mark = bandTagMark(b);
  const cargoBtns = giftCargo.map(c => `<button class="btn btn-sm" title="Gift 1 ${COM[c].name} (+standing)" onclick="giftBandCargo('${b.id}','${c}',1)">${COM[c].ico}+</button>`).join("");
  const pct = Math.round((((b.rep || 0) + 100) / 200) * 100);
  const cut = Math.round(bandLootShare(b) * 100), fee = escortRecruitFee(b), risk = Math.round(bandBetrayChance(b) * 100);
  const dist = bandDistance(b);
  const tagBtns = BAND_TAG_KEYS.map(k => `<button class="btn btn-sm ${b.tag === k ? "btn-primary" : ""}" title="Tag as ${BAND_TAGS[k].name}" onclick="setBandTag('${b.id}','${k}')">${BAND_TAGS[k].ico}</button>`).join("");
  const supStatus = bandOnMandate(b) ? `<span style="color:var(--accent)">📜 on mandate</span>`
    : bandFollowing(b) ? `<span style="color:var(--good)">🛰️ riding with you (${b.followUntil - S.turn} cyc)</span>`
    : bandOnCall(b) ? `<span style="color:var(--good)">standing by (${b.onCallUntil - S.turn} cyc)</span>`
    : bandInbound(b) ? `<span style="color:var(--warn)">inbound (${b.inboundTurn - S.turn} cyc)</span>`
    : bandBusy(b) ? `<span class="hint">busy (${b.busyUntil - S.turn} cyc)</span>`
    : `${Math.round(bandSupportOdds(b) * 100)}% to answer`;
  const callDisabled = bandOnCall(b) || bandInbound(b) || bandBusy(b) || bandOnMandate(b) || !bandWillAlly(b);
  const followBtn = bandOnCall(b) && !bandFollowing(b)
    ? `<button class="btn btn-sm btn-good" title="They'll jump where you jump for ${BAND_FOLLOW_DURATION} cycles" onclick="bandFollow('${b.id}')">🛰️ Follow me</button>` : "";
  const standDownBtn = (bandOnCall(b) || bandInbound(b))
    ? `<button class="btn btn-sm" title="Send them back to their own affairs now" onclick="bandStandDown('${b.id}')">✖ ${bandInbound(b) ? "Recall" : "Stand down"}</button>` : "";
  return `<div class="card">
      <h4>${mark ? mark + " " : ""}${b.ico} ${b.name}</h4>
      <div class="hint">${pr.ico} ${pr.name} · L${b.level} · ${t.label} (${b.rep})${rival ? ` · <span style="color:var(--bad)">⚔️ feud: ${rival.name} (depth ${bandFeudDepth(b)})</span>` : ""}</div>
      <div class="bar"><span style="width:${pct}%;background:${(b.rep||0) >= 41 ? "var(--good)" : (b.rep||0) < -10 ? "var(--bad)" : "var(--warn)"}"></span></div>
      <div class="ship-stat"><span class="k">Based at</span><span class="v">${bandLocName(b)} <span class="hint">${dist === 0 ? "(here)" : dist + " ly"}</span></span></div>
      <div class="ship-stat"><span class="k">History</span><span class="v">🤝 ${b.allied || 0} allied · ⚔️ ${b.fought || 0} fought · 🎁 ${fmt(b.gifted || 0)} cr</span></div>
      <div class="ship-stat"><span class="k">As an ally</span><span class="v">${bandWillAlly(b) ? `wants ${cut}% of loot` : "won't fight for you"}</span></div>
      <div class="ship-stat"><span class="k">As a hire</span><span class="v">${fmt(fee)} cr · ${risk}% desert risk</span></div>
      <div class="ship-stat"><span class="k">Support</span><span class="v">${supStatus}</span></div>
      ${rival ? (() => { const truce = bandTruceActive(b), tc = bandTruceCost(b), pc = bandReconcileCost(b);
        return `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center">
          ${truce ? `<span class="hint" style="color:var(--warn)">🕊️ truce w/ ${rival.name}: ${b.truceUntil - S.turn} cyc</span>` : ""}
          <button class="btn btn-sm" ${S.res.credits >= tc ? "" : "disabled"} title="A temporary truce for ${BAND_TRUCE_DURATION} cycles — they'll serve together for now, then the feud resumes" onclick="brokerTruce('${b.id}')">🕊️ ${truce ? "Extend truce" : "Truce"} (${fmt(tc)} cr · ${BAND_TRUCE_DURATION} cyc)</button>
          <button class="btn btn-sm" ${S.res.credits >= pc ? "" : "disabled"} title="Settle the feud with the ${rival.name} for good (depth ${bandFeudDepth(b)}) — cheaper with higher standing &amp; Dread" onclick="reconcileBands('${b.id}')">🤝 Broker peace (${fmt(pc)} cr)</button>
        </div>`; })() : ""}
      <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px"><span class="hint">Tag:</span> ${tagBtns}</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px">
        <button class="btn btn-sm" ${callDisabled ? "disabled" : ""} title="Call them to your side — nearby crews come at once, distant ones may travel in" onclick="callBandSupport('${b.id}')">📣 Call for support</button>
        ${followBtn}${standDownBtn}
        <button class="btn btn-sm" ${S.res.credits >= 500 ? "" : "disabled"} title="Pay a 500 cr tribute" onclick="giftBandCredits('${b.id}',500)">💰 500</button>
        <button class="btn btn-sm" ${S.res.credits >= 2000 ? "" : "disabled"} title="Pay a 2,000 cr tribute" onclick="giftBandCredits('${b.id}',2000)">💰 2k</button>
        ${cargoBtns}
      </div></div>`;
}
function renderContactsAll() {
  const bands = bandList().sort((a, b) => (b.rep || 0) - (a.rep || 0));
  const cards = bands.map(contactCard).join("");
  return `<div class="subtitle">Crews you've crossed in the void — your loose brotherhood. <b>Tag</b> them to track who's who. <b>Standing</b> rises when you ally, spare a beaten crew, pay tributes or gift valued cargo — and with your <b>Dread</b>; it craters when you kill them. <b>📣 Call for support</b> to summon a crew; once standing by, ask them to <b>🛰️ Follow</b> or <b>✖ Stand down</b>. Friendlier bands take a smaller loot cut, hire cheaper &amp; answer calls readily. Use <b>📍 Around here</b> for crews &amp; pirate activity in this system, and <b>📜 Mandates</b> to put a crew to work patrolling a world.</div>
    <div class="cards">${cards || '<div class="card"><div class="hint">No pirate bands on your books yet — hunt or ally with them from the ⚔️ Raider tab.</div></div>'}</div>`;
}
function pirateLevelLabel(n) { return n <= 0 ? "🟢 clear" : n >= 4 ? "🔴 infested" : n >= 2 ? "🟠 active" : "🟡 light"; }
function renderContactsAround() {
  const here = currentPlanet(), plv = pirateLevel(here.id);
  const local = bandList().filter(b => b.loc === here.id).sort((a, b) => (b.rep || 0) - (a.rep || 0));
  const onMandateHere = (S.mandates || []).filter(m => m.planet === here.id);
  const meter = `<div class="card"><h4>📍 ${here.name} <span class="pill ${plv >= 2 ? "bad" : plv === 0 ? "good" : ""}">${pirateLevelLabel(plv)} (${plv}/5)</span></h4>
    <div class="hint">Pirate activity here drives ambush, interdiction and convoy threat. Hunt raiders in the ⚔️ Raider tab, or commission a 🎯 <b>Cull pirates</b> mandate to drive them out${onMandateHere.length ? ` — <span style="color:var(--accent)">${onMandateHere.length} mandate(s) working this system now</span>` : ""}.</div>
    <div class="row" style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="setMandateField('planet','${here.id}');setSubView('contacts','mandates')">📜 Commission a mandate here</button></div></div>`;
  const cards = local.map(contactCard).join("");
  return `<div class="subtitle">Crews based in <b>${here.name}</b> right now, and how lawless these lanes are. Bands relocate as you cross them and as they finish mandates.</div>
    ${meter}
    <div class="cards">${cards || '<div class="card"><div class="hint">No known crews are based in this system. Sweep the lanes (⚔️ Raider) to turn some up.</div></div>'}</div>`;
}
function renderContactsMandates() {
  // ---- active mandates ----
  const active = (S.mandates || []).map(md => {
    const b = bandById(md.bandId), t = MANDATE_TASKS[md.task], done = md.total - md.cyclesLeft;
    const pct = Math.round(done / md.total * 100);
    return `<div class="card">
      <h4>${t.ico} ${b ? b.ico + " " + b.name : "crew"} <span class="hint">${t.name} · ${mdPlanetName(md.planet)}</span></h4>
      <div class="ship-stat"><span class="k">Progress</span><span class="v">${done}/${md.total} cycles</span></div>
      <div class="bar"><span style="width:${pct}%;background:var(--accent)"></span></div>
      <div class="ship-stat"><span class="k">Your cut so far</span><span class="v" style="color:var(--gold)">${fmt(md.accrued)} cr</span></div>
      <div class="ship-stat"><span class="k">Paid in advance</span><span class="v">${fmt(md.fee)} cr</span></div>
      <div class="row" style="margin-top:6px"><button class="btn btn-sm btn-bad" title="Recall the crew now — bank what they've earned, forfeit the fee" onclick="cancelMandate('${md.id}')">✖ Recall</button></div>
    </div>`;
  }).join("");
  // ---- commission form ----
  const elig = mandateEligibleBands();
  const f = mandateForm;
  if (!f.band || !elig.some(b => b.id === f.band)) f.band = elig.length ? elig[0].id : null;
  if (!f.planet || !PLANETS.find(p => p.id === f.planet)) f.planet = S.location;
  const known = PLANETS.filter(p => isActive(p) && galaxyKnown(p));
  let form;
  if (!elig.length) {
    form = `<div class="card"><h4>📜 Commission a mandate</h4><div class="hint">No crew is free to take a contract right now — raise standing with a band (and make sure it isn't already busy, summoned, or on another mandate).</div></div>`;
  } else {
    const b = bandById(f.band);
    const bandOpts = elig.map(x => `<option value="${x.id}" ${x.id === f.band ? "selected" : ""}>${x.ico} ${x.name} · L${x.level} · ${bandTier(x).label}</option>`).join("");
    const planetOpts = known.map(p => `<option value="${p.id}" ${p.id === f.planet ? "selected" : ""}>${p.name}${p.id === S.location ? " (here)" : ""} · ${pirateIntelKnows(p.id) ? pirateLevelLabel(pirateLevel(p.id)) : "activity ❔"}</option>`).join("");
    const taskBtns = Object.keys(MANDATE_TASKS).map(k => { const t = MANDATE_TASKS[k]; return `<button class="btn btn-sm ${f.task === k ? "btn-primary" : ""}" title="${t.blurb}" onclick="setMandateField('task','${k}')">${t.ico} ${t.name}</button>`; }).join(" ");
    const durBtns = MANDATE_DURATIONS.map(d => `<button class="btn btn-sm ${f.dur === d ? "btn-primary" : ""}" onclick="setMandateField('dur','${d}')">${d} cyc</button>`).join(" ");
    const t = MANDATE_TASKS[f.task];
    const fee = mandateFee(b, f.planet, f.task, f.dur), est = mandateEstCut(b, f.planet, f.task, f.dur);
    const afford = (S.res.credits || 0) >= fee;
    form = `<div class="card"><h4>📜 Commission a mandate</h4>
      <div class="hint">${t.blurb}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="hint">Crew</span><select onchange="setMandateField('band',this.value)">${bandOpts}</select>
        <span class="hint">System</span><select onchange="setMandateField('planet',this.value)">${planetOpts}</select></div>
      <div class="hint" style="margin-top:4px">Pirate activity (❔) shows only for systems you hold current intel on — your current system, or worlds covered by a chart bought in the ⚔️ Raider tab.</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Task</span> ${taskBtns}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Duration</span> ${durBtns}</div>
      <div class="ship-stat" style="margin-top:8px"><span class="k">Fee (upfront)</span><span class="v" style="color:${afford ? "inherit" : "var(--bad)"}">${fmt(fee)} cr</span></div>
      <div class="ship-stat"><span class="k">Your cut</span><span class="v">${Math.round(t.cut * 100)}% of the take · <span class="hint">est. ~${fmt(est)} cr over ${f.dur} cyc</span></span></div>
      ${t.heat
        ? (() => { const fac = (PLANETS.find(p => p.id === f.planet) || {}).faction, sanc = fac && commissionCovers(fac), fn = fac ? FACTIONS[fac].name : "the locals";
            return sanc
              ? `<div class="hint" style="color:var(--good)">⚖️ Sanctioned — your letter of marque against ${fn} makes this legal: <b>no Wanted</b>, though they'll resent it all the same.</div>`
              : `<div class="hint" style="color:var(--bad)">⚠️ Piracy in your name — raises your Wanted and angers ${fn}.${(S.commission ? ` (Your letter of marque is against ${FACTIONS[S.commission.target].name}, not them.)` : " A letter of marque against them would make it legal.")}</div>`;
          })()
        : `<div class="hint" style="color:var(--good)">Lawful work — suppresses pirate activity at the target.</div>`}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" ${afford ? "" : "disabled"} onclick="commissionMandate('${f.band}','${f.planet}','${f.task}',${f.dur})">📜 Commission (${fmt(fee)} cr)</button></div>
    </div>`;
  }
  return `<div class="subtitle">Put a crew to work: send them to a system for a set run to <b>cull pirates</b>, <b>guard the lanes</b> or <b>prey on shipping</b>. You pay an upfront fee and take a cut of what they bring in. Lawful tasks thin out pirate activity there; raiding pays more but is piracy in your name.</div>
    ${active ? `<div class="cards">${active}</div>` : '<div class="card"><div class="hint">No active mandates. Commission one below.</div></div>'}
    ${form}`;
}
/* ---------- Generic in-panel sub-tabs ----------
   A lightweight tab strip inside a panel. View state is UI-only (not saved);
   an unknown/stale view falls back to the first. Used by Ship, Research and
   Industry to break long pages into focused sections. */
const subViews = {};
function subView(panel, views) {
  const cur = subViews[panel];
  return views.some(v => v[0] === cur) ? cur : views[0][0];
}
function subTabBar(panel, views) {
  const cur = subView(panel, views);
  return `<div class="row subtabs" style="margin:6px 0 12px;flex-wrap:wrap">${views.map(([id, lbl]) =>
    `<button class="btn btn-sm ${cur === id ? "btn-primary" : ""}" onclick="setSubView('${panel}','${id}')">${lbl}</button>`).join("")}</div>`;
}
function setSubView(panel, v) {
  subViews[panel] = v;
  ({ ship: renderShipPanel, research: renderResearch, industry: renderIndustry, colonies: renderColonies, bases: renderBases, contacts: renderContacts }[panel] || renderAll)();
}

// Ship outfitting grouped into focused bays
const SHIP_CATEGORIES = [
  ["core",   "🚀 Core",          ["cargo", "fueltank", "engine"]],
  ["gather", "⛏️ Gathering",     ["miner", "hydro", "gasscoop", "salvager", "factory", "reactor", "lab"]],
  ["combat", "⚔️ Combat",        ["shield", "armor", "pointdef", "dronebay", "aimain", "cannons"]],
  ["trade",  "🕴️ Trade & Holds", ["hazmat", "smuggler", "trade", "envoy"]],
];
const SHIP_TAB_VIEWS = SHIP_CATEGORIES.map(c => [c[0], c[1]]);

function shipUpgradeCard(u) {
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
}
function repairBayHTML() {
  const P = S.pirate;
  const hullCol = P.hull >= 60 ? "var(--good)" : P.hull >= 30 ? "var(--warn)" : "var(--bad)";
  const anyDamage = P.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100);
  const hullBtn = P.hull < HULL_MAX
    ? `<button class="btn btn-good btn-sm" onclick="repairShip()">🔧 Repair hull (${fmt(Math.round((HULL_MAX - P.hull) * 30 * repairDiscount()))} 💰${repairDiscount() < 1 ? ", " + Math.round((1 - repairDiscount()) * 100) + "% off" : ""})</button>`
    : "";
  const subRows = SUBSYS.map(k => {
    const c = shipCond(k), col = c >= 60 ? "var(--good)" : c >= 30 ? "var(--warn)" : "var(--bad)", m = SUBSYS_META[k], q = subsysRepairCost(k);
    return `<div class="ship-stat"><span class="k">${m.ico} ${m.name}</span><span class="v" style="color:${col}">${c}%</span></div>
      <div class="bar"><span style="width:${c}%;background:${col}"></span></div>
      ${q ? `<button class="btn btn-sm" style="margin:2px 0 4px" ${(S.res.credits >= q.credits && (S.res[q.mat] || 0) >= q.matQ) ? "" : "disabled"} title="Repair ${m.name}: ${fmt(q.credits)} cr + ${q.matQ} ${COM[q.mat].name}" onclick="repairSubsys('${k}')">🔧 ${m.name} (${fmt(q.credits)}💰+${q.matQ}${COM[q.mat].ico})</button>` : ""}`;
  }).join("");
  return `<div class="card" style="margin-bottom:12px"><h4>🔧 Repair Bay <span class="hint">— docked at ${currentPlanet().name}</span></h4>
    <div class="ship-stat"><span class="k">🛡️ Hull</span><span class="v" style="color:${hullCol}">${P.hull}/${HULL_MAX}</span></div>
    <div class="bar"><span style="width:${P.hull}%;background:${hullCol}"></span></div>
    ${hullBtn}
    <div class="ship-stat" style="margin-top:8px"><span class="k">🛠️ Subsystems</span><span class="v">${SUBSYS.every(k => shipCond(k) >= 100) ? '<span class="pill good">all nominal</span>' : ""}</span></div>
    ${subRows}
    ${anyDamage ? `<button class="btn btn-good" style="margin-top:6px" onclick="repairAll()">🛠️ Full refit (hull + systems)</button>` : '<div class="pill good" style="margin-top:6px">◉ All systems pristine</div>'}
  </div>`;
}
function renderShipPanel() {
  const el = document.getElementById("panel-ship");
  const cur = subView("ship", SHIP_TAB_VIEWS);
  const cat = SHIP_CATEGORIES.find(c => c[0] === cur) || SHIP_CATEGORIES[0];
  const inCat = new Set(SHIP_CATEGORIES.flatMap(c => c[2]));
  const ids = cur === SHIP_CATEGORIES[0][0]
    ? cat[2].concat(UPGRADES.filter(u => !inCat.has(u.id)).map(u => u.id))   // stash any uncategorised module in Core
    : cat[2];
  const cards = ids.map(id => UPGRADES.find(u => u.id === id)).filter(Boolean).map(shipUpgradeCard).join("");
  el.innerHTML = `<h2>Ship Outfitting — S.S. Wanderer</h2>
    <div class="subtitle">Twenty upgrade systems across four bays, three tiers each. Some modules (Gas Scoop, Salvage Rig) unlock new extraction; others (Shielded & Smuggler's Holds) keep contraband out of customs' hands.</div>
    ${repairBayHTML()}
    ${subTabBar("ship", SHIP_TAB_VIEWS)}
    <div class="cards">${cards}</div>`;
}

/* ----- Bases ----- */
// a compact "Travel here" button for outpost/colony cards (or a "here" pill)
function cardTravelBtn(id) {
  if (id === S.location) return '<span class="pill good">◉ here</span>';
  const pl = PLANETS.find(p => p.id === id);
  if (!pl || !isVisible(pl)) return "";
  const fc = fuelCost(id);
  const can = S.res.fuel >= fc && !S.encounter && !S.interdiction && S.jail <= 0;
  return `<button class="btn btn-sm" ${can ? "" : "disabled"} title="Jump to ${pl.name} (⛽ ${fc})" onclick="travel('${id}')">Travel ▸ <span class="hint">⛽${fc}</span></button>`;
}
// what a colony can produce (icons only, deduped) — its built producers + recipe outputs
function colonyOutputs(col, planet) {
  const set = new Set();
  colonyBuildingList(planet).forEach(b => {
    if ((col.buildings[b.id] || 0) <= 0) return;
    if (b.produces) set.add(b.produces);
    if (b.recipe && b.recipe.out) set.add(b.recipe.out);
  });
  return Array.from(set);
}
function ensureTrade(b) { if (!b.trade || typeof b.trade !== "object") b.trade = { on: false, exp: {}, imp: {}, cols: {} }; b.trade.exp = b.trade.exp || {}; b.trade.imp = b.trade.imp || {}; b.trade.cols = b.trade.cols || {}; return b.trade; }
function toggleBaseTrade(pid) {
  const b = S.bases[pid]; if (!b) return;
  if (!(b.modules.warehouse || 0)) return toast("Build a Storage Depot first to run a trade route.", "bad");
  if (!Object.keys(S.colonies || {}).length) return toast("You need at least one colony to trade with.", "bad");
  const t = ensureTrade(b); t.on = !t.on;
  toast(t.on ? "Trade route enabled — pick what to ship per colony below." : "Trade route disabled.", t.on ? "good" : "");
  saveGame(); renderAll();
}
function setBaseTradeGood(pid, dir, c) {
  const b = S.bases[pid]; if (!b) return; const t = ensureTrade(b);
  const isExp = dir === "exp";
  const on = isExp ? baseExporting(b, c) : baseImporting(b, c);   // current EFFECTIVE direction
  if (on) {                                          // turn this direction off — the good is no longer traded that way
    if (isExp) t.exp[c] = false; else t.imp[c] = false;
  } else {                                           // turn it on, and disable the opposite so it can't loop
    if (isExp) { delete t.exp[c]; if (baseImportable(c)) t.imp[c] = false; }
    else       { delete t.imp[c]; t.exp[c] = false; }
  }
  saveGame(); renderBases();
}
function setBaseTradeColony(pid, cid) {
  const b = S.bases[pid]; if (!b) return; const t = ensureTrade(b);
  if (t.cols[cid] === false) delete t.cols[cid]; else t.cols[cid] = false;
  saveGame(); renderBases();
}
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
        <div class="row" style="margin-top:6px">${cardTravelBtn(id)}</div>
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
    // ===== Sub-tabs: Modules / Inventory / Trade =====
    const hasColonies = Object.keys(S.colonies || {}).length > 0;
    const BASE_VIEWS = [["modules", "🛠️ Modules"], ["inventory", "📦 Inventory"]];
    if (hasColonies) BASE_VIEWS.push(["trade", "🔄 Import/Export"]);   // trade routes appear once you have a colony to trade with
    const view = subView("bases", BASE_VIEWS);
    let body;
    if (view === "modules") {
      body = `<div class="cards">${modCards}</div>`;
    } else if (view === "inventory") {
      const ids = STORE_IDS.filter(c => (S.res[c] || 0) > 0 || (b.storage[c] || 0) > 0);
      const rows = ids.length ? ids.map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name} <span class="hint">@ ${fmt(sellPrice(pid, c))}</span></td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td class="num">${fmt(b.storage[c] || 0)}</td>
        <td><div class="trade-controls">
          <input class="qty" id="xfer-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm" onclick="depositQty('${c}')">Store ▸</button>
          <button class="btn btn-sm" onclick="withdrawQty('${c}')">◂ Take</button>
          <button class="btn btn-sm btn-good" title="Buy into the base at market (${fmt(buyPrice(pid, c))}/u)" onclick="baseBuyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-bad" title="Sell from the base at market (${fmt(sellPrice(pid, c))}/u)" onclick="baseSellQty('${c}')">Sell</button>
        </div></td></tr>`).join("")
        : '<tr><td colspan="4" class="hint">Nothing in your hold or this base yet.</td></tr>';
      body = `<div class="section-title">📦 Inventory (${baseStorageUsed(b)}/${baseStorageCap(pid)})</div>
        <div class="hint" style="margin-bottom:8px">Move goods between your ship and this base's stockpile.</div>
        <div class="row" style="margin-bottom:8px"><button class="btn btn-sm" onclick="storeAllCargo()">Store all cargo ▸</button></div>
        <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In base</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      // ----- Import / Export -----
      const hasWarehouse = (b.modules.warehouse || 0) > 0;
      const cols = Object.entries(S.colonies || {});
      const t = (b.trade && typeof b.trade === "object") ? b.trade : { on: false, exp: {}, imp: {}, cols: {} };
      const lc = S.tradeLastCycle;
      const contrabandHeld = CARGO_IDS.filter(c => (b.storage[c] || 0) > 0 && isIllegalAt(c, pid));
      if (!hasWarehouse) {
        body = `<div class="card"><div class="hint">Build a 🏬 <b>Storage Depot</b> (Modules tab) to turn this base into a trade hub.</div></div>`;
      } else if (!cols.length) {
        body = `<div class="card"><div class="hint">Found a colony to trade with — your base will ship it raw materials and import its manufactured goods.</div></div>`;
      } else {
        // eligible commodities to offer as toggles
        const expGoods = STORE_IDS.filter(c => (b.storage[c] || 0) > 0 || cols.some(([, col]) => (col.orders[c] || 0) > 0));
        const impGoods = STORE_IDS.filter(baseImportable).filter(c => (b.storage[c] || 0) > 0 || cols.some(([, col]) => (col.storage[c] || 0) > 0));
        const chip = (dir, c) => {
          const on = dir === "imp" ? baseImporting(b, c) : baseExporting(b, c);
          const otherActive = !on && (dir === "imp" ? baseExporting(b, c) : baseImporting(b, c));   // locked by the opposite direction
          const title = on ? `Trading ${COM[c].name}`
            : otherActive ? `${dir === "imp" ? "Exporting" : "Importing"} ${COM[c].name} instead — click to ${dir === "imp" ? "import" : "export"} it (the other direction turns off)`
            : `Skipping ${COM[c].name}`;
          return `<button class="btn btn-sm ${t.on && on ? "btn-good" : ""}" ${t.on ? "" : "disabled"} title="${title}" onclick="setBaseTradeGood('${pid}','${dir}','${c}')">${COM[c].ico} ${COM[c].name} ${on ? "✓" : otherActive ? "⇄" : "✗"}</button>`;
        };
        const colRows = cols.map(([cid, col]) => {
          const cpl = PLANETS.find(p => p.id === cid), on = tradeColOk(b, cid), dist = worldDist(pid, cid);
          const needs = STORE_IDS.filter(c => (col.orders[c] || 0) > (col.storage[c] || 0)).map(c => COM[c].ico).join("") || "—";
          const offers = STORE_IDS.filter(c => baseImportable(c) && (col.storage[c] || 0) > colonyFinishedReserve(col, c) + (col.orders[c] || 0)).map(c => COM[c].ico).join("") || "—";
          return `<div class="ship-stat" style="align-items:center"><span class="k"><button class="btn btn-sm ${t.on && on ? "btn-good" : ""}" ${t.on ? "" : "disabled"} onclick="setBaseTradeColony('${pid}','${cid}')">${on ? "✓" : "✗"} ${cpl.name}</button> <span class="hint">${dist} ly${col.faction ? " · " + FACTIONS[col.faction].ico + " tariff" : ""}</span></span>
            <span class="v hint">needs ${needs} · offers ${offers}</span></div>`;
        }).join("");
        body = `<div class="card">
          <div class="hint" style="margin-bottom:6px">Each cycle this base ships the <b>raws you select</b> to fill colony orders, and imports the <b>finished goods you select</b> from colonies' surplus. A good flows <b>either in or out, never both</b> — picking one direction locks the other (shown as ⇄; click to flip). Amounts are automatic (colony need / excess) — you just pick what flows and with which colony. Freight scales with distance; aligned colonies add a tariff; contraband risks customs; pirates ambush convoys.</div>
          <button class="btn ${t.on ? "btn-bad" : "btn-primary"} btn-sm" onclick="toggleBaseTrade('${pid}')">${t.on ? "⏹ Disable route" : "🔄 Enable route"}</button>
          <div class="section-title" style="margin-top:10px">⛏️ Export to colonies ${t.on ? "" : '<span class="hint">(route off)</span>'}</div>
          <div class="row" style="flex-wrap:wrap;gap:6px">${expGoods.length ? expGoods.map(c => chip("exp", c)).join("") : '<span class="hint">No raws stocked or ordered yet.</span>'}</div>
          <div class="section-title" style="margin-top:10px">🏭 Import from colonies</div>
          <div class="row" style="flex-wrap:wrap;gap:6px">${impGoods.length ? impGoods.map(c => chip("imp", c)).join("") : '<span class="hint">No finished goods available yet.</span>'}</div>
          <div class="section-title" style="margin-top:10px">🌍 Colonies</div>
          ${colRows}
          ${t.on && lc ? `<div class="ship-stat" style="margin-top:10px"><span class="k">Last cycle net</span><span class="v" style="color:${lc.net >= 0 ? "var(--good)" : "var(--bad)"}">${lc.net >= 0 ? "+" : ""}${fmt(lc.net)} cr</span></div>
            <div class="ship-stat"><span class="k">Freight/tariffs</span><span class="v">${fmt(lc.freight)} cr</span></div>
            ${Object.keys(lc.imp || {}).length ? `<div class="ship-stat"><span class="k">Imported</span><span class="v">${Object.entries(lc.imp).map(([c, q]) => q + COM[c].ico).join(" ")}</span></div>` : ""}
            ${Object.keys(lc.seized || {}).length ? `<div class="ship-stat"><span class="k" style="color:var(--bad)">🚔 Seized</span><span class="v">${Object.entries(lc.seized).map(([c, q]) => q + COM[c].ico).join(" ")}</span></div>` : ""}` : ""}
          ${typeof S.tradeNet === "number" && S.tradeNet !== 0 ? `<div class="ship-stat"><span class="k">Lifetime balance</span><span class="v" style="color:${S.tradeNet >= 0 ? "var(--good)" : "var(--bad)"}">${S.tradeNet >= 0 ? "+" : ""}${fmt(S.tradeNet)} cr</span></div>` : ""}
          ${contrabandHeld.length ? `<div class="hint" style="color:var(--warn);margin-top:6px">⚠️ Contraband in stock (${contrabandHeld.map(c => COM[c].ico).join(" ")}) — routing it risks customs seizure.</div>` : ""}
        </div>`;
      }
    }
    here = `<div class="section-title">📍 ${planet.name}</div>
      ${subTabBar("bases", BASE_VIEWS)}
      ${!hasColonies ? `<div class="hint" style="margin:6px 0">🔄 Found a colony to open <b>Import/Export</b> trade routes from this base.</div>` : ""}
      ${body}`;
  }

  el.innerHTML = `<h2>Bases</h2>
    <div class="subtitle">Build outposts across the galaxy. Their farms, mines and depots produce and store resources automatically every cycle — even while you travel.</div>
    <div class="section-title">🌐 Your Outposts</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

/* ----- Colonies ----- */
/* a building counts as a pausable "process" if it produces or refines anything */
function buildingPausable(b) { return !!(b.recipe || b.produces || ["lab", "datacenter", "scrubber"].includes(b.id)); }
function toggleColonyProcess(bid) {
  const col = S.colonies[S.location]; if (!col) return;
  if (!(col.buildings[bid] > 0)) return toast("That process isn't built here.", "bad");
  if (!col.idle) col.idle = {};
  col.idle[bid] = !col.idle[bid];
  const b = colonyBuildingList(currentPlanet()).find(x => x.id === bid) || { name: bid, ico: "" };
  log(`${col.idle[bid] ? "⏸️ Paused" : "▶️ Resumed"} ${b.ico} ${b.name} on <span class="c">${currentPlanet().name}</span>.`, "");
  toast(`${b.name} ${col.idle[bid] ? "paused" : "resumed"}`, col.idle[bid] ? "" : "good");
  afterAction();
}
/* ---------- Colony interface disclosure ----------
   Building categories reveal as the colony matures, so a fresh colony shows
   only survival/economy basics, industry opens once you've learned to
   manufacture, and civic/logistics arrive as the colony grows. */
const COLONY_BUILD_CAT = {
  habitat: "survival", farm: "survival", solar: "survival", scrubber: "survival",
  biomass_gen: "industry", gas_turbine: "industry", reactor: "industry", smelter: "industry",
  chem_plant: "industry", foundry: "industry", fabricator: "industry", factory: "industry",
  machine_works: "industry", luxury_atelier: "industry", pharma_lab: "industry",
  arms_factory: "industry", drone_works: "industry", antimatter_forge: "industry",
  lab: "civic", datacenter: "civic", spaceport: "civic", garrison: "civic",
};
const COLONY_CATS = [["survival", "🏠 Survival & Economy"], ["industry", "🏭 Industry"], ["civic", "🏛️ Civic & Logistics"]];
function colonyBuildCat(b) { return b.id.indexOf("ext_") === 0 ? "survival" : (COLONY_BUILD_CAT[b.id] || "survival"); }
function colonyCatRevealed(cat, col) {
  if (cat === "survival" || S.showAllTabs) return true;
  if (cat === "industry") return !!(S.disc && S.disc.advMarkets) || col.pop >= 8 || S.turn >= 15;
  if (cat === "civic") return Object.keys(S.colonies || {}).length >= 2 || col.pop >= 10 || S.turn >= 25;
  return true;
}
function colonyCatHint(cat) {
  if (cat === "industry") return "unlocks once you manufacture your first Medicine (or the colony grows to 8k)";
  if (cat === "civic") return "unlocks as the colony grows (10k pop), or once you run a second colony";
  return "";
}
// faction alignment is shown once it's within reach (or already taken)
function colonyFactionRevealed(col) {
  if (col.faction || S.showAllTabs) return true;
  if (Object.keys(S.colonies || {}).length >= 2 || S.turn >= 20) return true;
  return Object.values(FACTIONS).some((_, i) => (S.rep[Object.keys(FACTIONS)[i]] || 0) >= ALIGN_REP_REQ - 5);
}
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
      const outs = colonyOutputs(c, pl);
      return `<div class="card ${id === pid ? "owned" : ""}">
        <h4>${pl.name} ${c.faction ? `<span class="pill" title="${FACTIONS[c.faction].name}">${FACTIONS[c.faction].ico}</span>` : ""} ${id === pid ? '<span class="pill good">here</span>' : ""} ${colonyHealthPill(c)}</h4>
        <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(c.pop)}k</span></div>
        <div class="ship-stat"><span class="k">😊 Happiness</span><span class="v">${c.happiness}%</span></div>
        <div class="ship-stat"><span class="k">🏭/🔬 Dev</span><span class="v">Ind ${effIndustry(pl)} · Tech ${effTech(pl)}</span></div>
        <div class="ship-stat"><span class="k">💰 Tax income</span><span class="v">+${fmt(colonyTaxIncome(c))}/cyc</span></div>
        <div class="ship-stat"><span class="k">🏭 Produces</span><span class="v">${outs.length ? outs.map(x => `<span title="${COM[x].name}">${COM[x].ico}</span>`).join(" ") : "—"}</span></div>
        <div class="row" style="margin-top:6px">${cardTravelBtn(id)}</div>
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
    const buildCard = (b) => {
      const tier = col.buildings[b.id] || 0, maxed = tier >= b.tiers;
      const cost = Math.round(b.baseCost * Math.pow(b.costMul, tier));
      const mats = colonyBuildingMats(b, tier + 1);
      const locked = b.req && !S.techs[b.req];
      const ok = !locked && S.res.credits >= cost && canAfford(mats);
      const dots = Array.from({ length: b.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
      const paused = !!(col.idle && col.idle[b.id]);
      const pauseCtl = (tier > 0 && buildingPausable(b))
        ? `<button class="btn btn-sm ${paused ? "btn-good" : "btn-bad"}" style="margin-top:4px" title="${paused ? "Resume this process — it runs again next cycle" : "Stop this process — it consumes no inputs and produces nothing until resumed (strategy change, no demolition)"}" onclick="toggleColonyProcess('${b.id}')">${paused ? "▶️ Resume" : "⏸️ Pause"}</button>`
        : "";
      return `<div class="card ${paused ? "" : tier > 0 ? (maxed ? "maxed" : "owned") : ""}" ${paused ? 'style="opacity:.7"' : ""}>
        <h4>${b.ico} ${b.name} <span class="tier-dots">${dots}</span> ${paused ? '<span class="pill bad">⏸️ paused</span>' : ""}</h4>
        <div class="desc">${b.desc}</div>
        ${b.recipe ? `<div class="hint">⚙️ ${colonyRecipeStr(b.recipe)}</div>` : ""}
        ${maxed ? '<div class="pill good">◉ Fully built</div>'
          : locked ? `<div class="pill bad">🔒 needs ${(TECHS.find(t => t.id === b.req) || {}).name || b.req}</div>`
          : `<div class="meta"><span class="hint">Tier ${tier + 1}</span><span class="cost">${fmt(cost)} 💰 + ${matsString(mats)}</span></div>
             <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="buildColonyBuilding('${b.id}')">${tier > 0 ? "Upgrade" : "Build"}</button>`}
        ${pauseCtl}
      </div>`;
    };
    const buildCards = COLONY_CATS.map(([cat, label]) => {
      const list = colonyBuildingList(planet).filter(b => colonyBuildCat(b) === cat);
      if (!list.length) return "";
      const revealed = colonyCatRevealed(cat, col);
      const shown = list.filter(b => revealed || (col.buildings[b.id] || 0) > 0);   // always show what's already built
      if (!shown.length) return `<div class="hint" style="grid-column:1/-1">🔒 <b>${label}</b> — ${colonyCatHint(cat)}.</div>`;
      return `<div class="section-title" style="grid-column:1/-1">${label}${!revealed ? ' <span class="hint">(more unlocks later)</span>' : ""}</div>` + shown.map(buildCard).join("");
    }).join("");
    const sids = STORE_IDS.filter(c => (S.res[c] || 0) > 0 || (col.storage[c] || 0) > 0);
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
      // orderable here: the staples, anything stored or already ordered, and the
      // inputs of every industry building standing in this colony — so a factory
      // world can order ore without you ferrying the first batch by hand
      const orderable = (() => {
        const set = new Set(COLONY_SUPPLY);
        Object.entries(col.orders || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
        Object.entries(col.storage || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
        colonyBuildingList(planet).forEach(b => {
          if ((col.buildings[b.id] || 0) > 0 && b.recipe) Object.keys(b.recipe.in).forEach(i => set.add(i));
        });
        return STORE_IDS.filter(c2 => set.has(c2));
      })();
      const orderRows = orderable.map(c => {
        const tgt = (col.orders && col.orders[c]) || 0;
        return `<tr><td>${COM[c].ico} ${COM[c].name}</td><td class="num">${fmt(col.storage[c] || 0)}</td>
          <td><div class="trade-controls"><input class="qty" id="auto-${c}" type="number" min="0" value="${tgt}" />
          <button class="btn btn-sm" onclick="setOrder('${c}')">Set auto</button></div></td></tr>`;
      }).join("");
      logi = `<div class="section-title">🚚 Logistics — Spaceport ${sp} · fee ${fee}% · ${logisticsCap(col)}/cycle</div>
        <div class="hint" style="margin-bottom:8px">Each cycle the network keeps these topped to target: <b>first from surplus on your other spaceport colonies (free)</b> — every spaceport colony donates anything above its own targets automatically — then bought from market at +${fee}%. Set a target to 0 to stop importing it. Rows cover staples plus your industry's inputs.</div>
        <table><thead><tr><th>Commodity</th><th class="num">In colony</th><th>Keep stocked to</th></tr></thead><tbody>${orderRows}</tbody></table>`;
    }
    // ---- faction diplomacy card (Overview tab) ----
    let factionCard;
    if (col.faction) {
      const F = FACTIONS[col.faction];
      factionCard = `<div class="card owned">
        <h4>${F.ico} Aligned — ${F.name}</h4>
        <div class="desc">${planet.name} flies ${F.name} colors: their merchants trade here and their patrols watch the sky.</div>
        <div class="ship-stat"><span class="k">💰 Commerce</span><span class="v">tax +25% · exports +15% · import fee −${col.faction === "frontier" ? 15 : 10}pp</span></div>
        <div class="ship-stat"><span class="k">🛡️ Support</span><span class="v">+${colonyFactionDefenseBonus(col)} defense · +6 happiness</span></div>
        <div class="ship-stat"><span class="k">${F.ico} Perk</span><span class="v">${FACTION_COLONY_PERKS[col.faction]}</span></div>
        <div class="ship-stat"><span class="k">🤝 Standing</span><span class="v">+1 ${F.name} rep / 5 cycles</span></div>
        <button class="btn btn-sm" style="margin-top:8px" onclick="colonyIndependence()">🏳️ Declare independence</button>
        <div class="hint">Leaving costs −10 rep with the ${F.name}, +1 unrest and −8 happiness.</div>
      </div>`;
    } else {
      const fRows = Object.entries(FACTIONS).map(([fid, F]) => {
        const rep = Math.round(S.rep[fid] || 0);
        const ok = rep >= ALIGN_REP_REQ && (S.res.influence || 0) >= ALIGN_COST_INF && col.happiness >= 40;
        const why = rep < ALIGN_REP_REQ ? `rep ${rep}/${ALIGN_REP_REQ}` : (S.res.influence || 0) < ALIGN_COST_INF ? `need ${ALIGN_COST_INF}⚖ influence` : col.happiness < 40 ? "happiness 40+ needed" : `rep ${rep}`;
        return `<div class="meta"><span>${F.ico} <b style="color:${F.color}">${F.name}</b><br><span class="hint">${FACTION_COLONY_PERKS[fid]}</span></span>
          <span style="text-align:right"><span class="hint">${why}</span><br><button class="btn btn-sm" ${ok ? "" : "disabled"} onclick="alignColony('${fid}')">Join</button></span></div>`;
      }).join("");
      factionCard = colonyFactionRevealed(col) ? `<div class="card">
        <h4>🤝 Faction Alignment <span class="pill">independent</span></h4>
        <div class="desc">Petition a great faction to charter ${planet.name}. Their trade network lifts tax income and export prices and cuts import fees; their patrols bolster defense; their backing steadies morale — and each loyal cycle earns their respect. Costs ${ALIGN_COST_INF} ⚖ influence; rival blocs take offense (−3 rep).</div>
        ${fRows}</div>`
        : `<div class="card"><h4>🤝 Faction Alignment</h4><div class="hint">Earn a faction's reputation (≥${ALIGN_REP_REQ}) to petition them to charter this colony for trade & protection.</div></div>`;
    }
    // ---- sub-tabs: Overview / Buildings / Supplies / Spaceport ----
    const views = [["overview", "📊 Overview"], ["buildings", "🏗️ Buildings"], ["supplies", "📦 Supplies"]];
    if (colonyCatRevealed("civic", col) || spaceportTier(col) > 0) views.push(["spaceport", "🛰️ Spaceport"]);
    const colonyView = subView("colonies", views);
    const subBar = subTabBar("colonies", views);
    let body;
    if (colonyView === "buildings") {
      body = `<div class="cards">${buildCards}</div>`;
    } else if (colonyView === "supplies") {
      body = `<div class="section-title">📦 Supplies (${colonyStorageUsed(col)}/${colonyStorageCap(col, planet)}) — feed & develop your colony</div>
        <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In colony</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    } else if (colonyView === "spaceport") {
      const expNote = sp ? `<div class="hint" style="margin-top:8px">🛰️ The spaceport also auto-exports surplus finished goods each cycle (throughput ${sp * 6})${col.faction ? `, and ${FACTIONS[col.faction].name} merchants pay a 15% premium` : ""}.</div>` : "";
      body = `${logi}${expNote}`;
    } else {
      body = `<div class="cards">${govCard}${factionCard}</div>`;
    }
    here = `<div class="section-title">🏛️ Govern — ${planet.name} ${col.faction ? `<span class="pill" title="${FACTIONS[col.faction].name}">${FACTIONS[col.faction].ico} ${FACTIONS[col.faction].name}</span>` : ""}</div>
      ${subBar}${body}`;
  }

  el.innerHTML = `<h2>Colonies</h2>
    <div class="subtitle">Found colonies on frontier worlds and grow them: build housing, farms, factories and labs, feed your people, set taxes, and watch the planet's industry & tech climb. Colonies live and grow every cycle — even while you're away.</div>
    <div class="section-title">🌍 Your Colonies</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

/* ============================================================
   CONVOY ESCORT (expert tab) — command a fleet, pool its firepower,
   split it equally across attackers, and shepherd freighters to port.
   Reuses the raid combat math (estPlayerDPS, ship classes, foe profiles,
   field repair); the player commands a *fleet*, not a single ship.
   ============================================================ */
const ESCORT_FLEET = { escorts: 2, freighters: 2 };
const ESCORT_MAX_HIRED = 5;         // how many pirate bands you can field as hired escorts
const ESCORT_ESCORT_FP = 13;        // base firepower per escort (× ship class)
const ESCORT_FREIGHTER_FP = 3;      // freighters can pop off a few shots
const ESCORT_ESCORT_HULL = 55;      // base hull per escort (× ship class)
const ESCORT_FREIGHTER_HULL = 42;
const ESCORT_FOE_DMG = 9;           // base per-round damage a foe deals a fleet ship
const ESCORT_POSTURES = {
  screen:   { off: 0.85, def: 0.70, label: "🛡️ Screen",  hint: "escorts body-block the freighters — less firepower, far less cargo lost" },
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
function chooseIntent(f, screen) {
  const fleet = escortFleet();
  const alive = fleet.map((s, i) => ({ s, i })).filter(o => escShipAlive(o.s));
  if (!alive.length) return -1;
  const want = escortFoeRole(f).pref;
  let cands;
  if (want === "value") cands = alive.slice().sort((a, b) => escortTargetValue(b.s) - escortTargetValue(a.s)).slice(0, Math.max(1, Math.ceil(alive.length / 2)));
  else { cands = alive.filter(o => o.s.role === want); if (!cands.length) cands = alive; }
  let chosen = want === "escort"
    ? cands.slice().sort((a, b) => escShipFP(b.s) - escShipFP(a.s))[0]   // interceptors hit your biggest guns
    : cands[Math.floor(Math.random() * cands.length)];
  // body-block: under a Screen posture, fire bound for a freighter is intercepted by an escort
  if (screen && chosen.s.role === "freighter") {
    const escorts = alive.filter(o => o.s.role === "escort");
    if (escorts.length && Math.random() < 0.8) chosen = escorts[Math.floor(Math.random() * escorts.length)];
  }
  return chosen.i;
}
function assignIntents() {
  const e = ensureEscort(), w = e.wave; if (!w) return;
  const screen = e.posture === "screen";
  w.foes.forEach(f => { if (f.hp > 0) f.intent = chooseIntent(f, screen); else f.intent = -1; });
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
  return base * (1 + stanceProfile(sh).atk);               // an aggressive/balanced stance adds firepower
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
  const fleet = [{ role: "flagship", name: "Your Flagship", ico: "🚀" }];
  const nEscorts = escortRank().escorts;                  // your guild rank fields a bigger fleet
  for (let i = 0; i < nEscorts; i++) {
    const clsId = pick(["corvette", "frigate", "frigate", "cruiser"]); const cls = SHIP_CLASSES[clsId];
    fleet.push({ role: "escort", cls: clsId, name: `${cls.name} ${String.fromCharCode(65 + i)}`, ico: cls.ico,
      hullMax: Math.round(ESCORT_ESCORT_HULL * cls.hull), str: Math.round(ESCORT_ESCORT_FP * cls.str), alive: true });
  }
  for (let i = 0; i < ESCORT_FLEET.freighters; i++) {
    fleet.push({ role: "freighter", name: `Freighter ${i + 1}`, ico: "📦",
      hullMax: ESCORT_FREIGHTER_HULL, str: ESCORT_FREIGHTER_FP, alive: true });
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
    if (!sh) sh = fleet[chooseIntent(f, e.posture === "screen")];   // intended target gone — re-pick now
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
function renderEscort() {
  const el = document.getElementById("panel-escort"); if (!el) return;
  const e = ensureEscort();
  const hullBar = (h, m) => { const pct = Math.max(0, Math.round(h / m * 100)); const col = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)"; return `<div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`; };
  if (!e.active) {
    if (!e.offers || !e.offers.length) refreshEscortOffers();
    const cards = (e.offers || []).map((m, i) => {
      const dn = PLANETS.find(p => p.id === m.to); const tl = m.threat >= 0.7 ? "🔴 High" : m.threat >= 0.45 ? "🟠 Moderate" : "🟢 Low";
      const oFrom = PLANETS.find(p => p.id === m.from);
      if (m.pirate) {
        const b = bandById(m.pirate);
        return `<div class="card" style="border-color:var(--gold)"><h4>🏴‍☠️ Smuggling run to ${dn ? dn.name : "?"}</h4>
          <div class="hint">${b ? bandTagMark(b) + m.pirateIco + " <b>" + b.name + "</b>" : "A crew"} wants you to run their ${m.contraband.ico} <b>${m.contraband.name}</b> — quietly.</div>
          <div class="ship-stat"><span class="k">Distance</span><span class="v">${m.dist} ly · ${m.legs} legs</span></div>
          <div class="ship-stat"><span class="k">Threat</span><span class="v">${tl} (${Math.round(m.threat * 100)}%) <span class="hint">incl. patrols</span></span></div>
          <div class="ship-stat"><span class="k">Deadline</span><span class="v">${m.cycleBudget} cycles <span class="hint">${escortUrgencyLabel(m.urgency != null ? m.urgency : 4)}</span></span></div>
          <div class="ship-stat"><span class="k">Pay</span><span class="v" style="color:var(--gold)">${fmt(m.reward)} cr<span class="hint"> +${fmt(m.bonus)} flawless</span></span></div>
          <div class="ship-stat"><span class="k">On delivery</span><span class="v">${b ? b.name + " +" + m.repBand : "standing"} · +${m.dread} Dread</span></div>
          <div class="ship-stat"><span class="k">Risk</span><span class="v" style="color:var(--bad)">+${m.heat} Wanted · ${dn ? dn.name + " authorities anger" : "law anger"}</span></div>
          <div class="hint">Illegal cargo: fat pay and deep standing with the crew, but you'll take heat and the destination's law won't forget. Bail and you'll burn the crew's trust.</div>
          <button class="btn btn-primary" onclick="acceptEscort(${i})">Take the job</button></div>`;
      }
      return `<div class="card"><h4>🛡️ Convoy to ${dn ? dn.name : "?"}</h4>
        <div class="ship-stat"><span class="k">Distance</span><span class="v">${m.dist} ly · ${m.legs} legs</span></div>
        <div class="ship-stat"><span class="k">Threat</span><span class="v">${tl} (${Math.round(m.threat * 100)}%)</span></div>
        <div class="ship-stat"><span class="k">Deadline</span><span class="v">${m.cycleBudget} cycles <span class="hint">${escortUrgencyLabel(m.urgency != null ? m.urgency : 4)}</span></span></div>
        <div class="ship-stat"><span class="k">Payload</span><span class="v">${fmt(m.payload)} cr cargo</span></div>
        <div class="ship-stat"><span class="k">Reward</span><span class="v" style="color:var(--gold)">${fmt(m.reward)} cr<span class="hint"> +${fmt(m.bonus)} flawless</span></span></div>
        <div class="hint">Threat tracks pirate activity at ${oFrom ? oFrom.name : "origin"} &amp; ${dn ? dn.name : "dest"} — clear them in the ⚔️ Raider tab before you set out to lower it (but the clock runs).</div>
        <button class="btn btn-primary" onclick="acceptEscort(${i})">Accept escort</button></div>`;
    }).join("");
    const rk = escortRank(), nx = escortNextRank();
    const guild = `<div class="ship-stat"><span class="k">🎖️ Guild rank</span><span class="v"><b>${rk.name}</b> <span class="hint">${Math.round((rk.mult - 1) * 100)}% pay · ${rk.escorts} escorts${nx ? ` · ${Math.max(0, nx.rep - (S.escortRep || 0))} rep to ${nx.name}` : " · top rank"}</span></span></div>`;
    el.innerHTML = `<div class="panel-head"><h2>🛡️ Convoy Escort</h2>
      <div class="subtitle">Take a contract to shepherd a convoy across the lanes. You command the whole fleet — <b>pool every ship's firepower</b> and split it across the attackers you choose. Keep the freighters alive to earn the full fee. Each leg is a cycle on the clock and burns fuel (about a normal one-way jump, +15%, split over the legs).</div></div>
      <div class="card">${guild}</div>
      <div class="row" style="margin:8px 0"><button class="btn btn-sm" onclick="refreshEscortOffers()">↻ New postings</button></div>
      <div class="cards">${cards || '<div class="card"><div class="hint">No convoys need an escort from here right now — try another port.</div></div>'}</div>`;
    return;
  }
  const m = e.mission; const dn = PLANETS.find(p => p.id === m.to);
  const totalFr = e.fleet.filter(s => s.role === "freighter").length;
  const aliveFr = e.fleet.filter(s => s.role === "freighter" && s.alive).length;
  const F = escortFirepower();
  // who is being targeted this round (telegraphed intent)
  const threatenedBy = {};
  if (escortInCombat()) e.wave.foes.forEach(f => { if (f.hp > 0 && f.intent != null && f.intent >= 0) (threatenedBy[f.intent] = threatenedBy[f.intent] || []).push(escortFoeRole(f).ico); });
  // fleet roster
  const roster = e.fleet.map((sh, fi) => {
    const alive = escShipAlive(sh), h = escShipHull(sh), hm = escShipHullMax(sh);
    const fp = Math.round(escShipFP(sh));
    let tag = sh.role === "flagship" ? "flagship" : sh.role === "escort" ? "escort" : "cargo";
    if (sh.role === "flagship" && alive) { const fw = WEAPONS[escortFlagWeapon()]; tag += ` · ${fw.ico}${Object.keys(fw.ammo).length ? " " + matsString(fw.ammo) : ""}`; }
    const inc = threatenedBy[fi];
    const mark = alive && inc ? ` <span title="incoming fire from ${inc.length}" style="color:var(--bad)">⤳${inc.join("")}</span>` : "";
    const _prof = stanceProfile(sh), _st = VESSEL_STANCES[sh.stance || "balanced"], _lv = shipFit(sh)[sh.stance || "balanced"] || 0;
    const obadge = alive ? ` <span class="hint">${_st.ico}${_lv ? " Lv" + _lv : ""}${_prof.atk ? " 🔥+" + Math.round(_prof.atk * 100) + "%" : ""}${_prof.mit ? " 🛡️" + Math.round(_prof.mit * 100) + "%" : ""}</span>` : "";
    return `<div class="ship-stat" style="align-items:center;${alive ? "" : "opacity:.45"}">
      <span class="k">${sh.ico} ${sh.name} <span class="hint">${tag}</span>${mark}${obadge}</span>
      <span class="v" style="min-width:120px">${alive ? hullBar(h, hm) + `<span class="hint">${h}/${hm} · 🔥${fp}</span>` : '<span style="color:var(--bad)">— lost —</span>'}</span></div>`;
  }).join("");
  const postBtns = Object.entries(ESCORT_POSTURES).map(([k, p]) =>
    `<button class="btn btn-sm ${e.posture === k ? "btn-primary" : ""}" title="${p.hint}" onclick="setEscortPosture('${k}')">${p.label}</button>`).join(" ");
  let combat = "";
  if (escortInCombat()) {
    const tgts = (e.targets || []).filter(i => e.wave.foes[i] && e.wave.foes[i].hp > 0);
    const nT = tgts.length || escortAliveFoes().length;
    const per = nT ? Math.round(F / nT) : F;
    const foeCards = e.wave.foes.map((f, i) => {
      if (f.hp <= 0) return `<div class="card" style="opacity:.4"><h4>${f.ico} ${f.name}</h4><div class="hint">destroyed</div></div>`;
      const sel = (e.targets || []).includes(i);
      const role = escortFoeRole(f);
      const aim = (f.intent != null && f.intent >= 0 && e.fleet[f.intent]) ? `${e.fleet[f.intent].ico} ${e.fleet[f.intent].name}` : "—";
      const ab = f.ability && ESCORT_BOSS_ABILITIES[f.ability] ? ` · <span style="color:var(--warn)">${ESCORT_BOSS_ABILITIES[f.ability].ico} ${ESCORT_BOSS_ABILITIES[f.ability].name}</span>` : "";
      const subs = `🚀 ${escortFoeCrippled(f) ? '<span style="color:var(--good)">crippled</span>' : `${f.eng}/${f.engMax}`}`
        + (((f.dmgMul || 1) < 1) ? ` · 🔫 −${Math.round((1 - f.dmgMul) * 100)}%` : "")
        + (((f.vuln || 1) > 1) ? ` · 🛡️ +${Math.round((f.vuln - 1) * 100)}% dmg taken` : "");
      const haul = Object.keys(f.cargo || {}).length ? ` · 📦 ${Object.keys(f.cargo).map(c => COM[c].ico).join("")}` : "";
      return `<div class="card" style="${sel ? "border-color:var(--accent)" : ""}"><h4>${f.ico} ${f.name}</h4>
        <div class="hint">${role.ico} ${role.name} · aiming at <b>${aim}</b>${ab}</div>
        ${hullBar(f.hp, f.maxhp)}<div class="hint">${f.hp}/${f.maxhp} hull · ⚔️ ${Math.round(f.dmg * (f.dmgMul || 1))}/hit · ${subs}</div>
        <div class="hint">bounty ${fmt((f.bounty || 0) + (f.credits || 0))} cr${haul}</div>
        <div class="row"><button class="btn btn-sm ${sel ? "btn-good" : ""}" onclick="escortToggleTarget(${i})">${sel ? "✓ Targeted" : "Target"}</button>
        <button class="btn btn-sm" onclick="escortFocus(${i})">Focus</button></div></div>`;
    }).join("");
    const tgtBtns = Object.entries(COMBAT_TARGETS).map(([k, t]) =>
      `<button class="btn btn-sm ${(e.fireTarget || "hull") === k ? "btn-primary" : ""}" title="${t.hint}" onclick="setEscortTarget('${k}')">${t.ico} ${t.name}</button>`).join(" ");
    const canRun = escortCanBreakOff();
    const fw = WEAPONS[escortFlagWeapon()];
    combat = `<div class="card"><h4>🔥 Fire Control — round ${e.wave.round}</h4>
      <div class="hint">Pooled fleet firepower <b>${fmt(F)}</b> splits equally across your targets: <b>${fmt(per)}</b> each to <b>${nT}</b> ${nT === 1 ? "target" : "targets"}${tgts.length ? "" : " (all, none picked)"}. Pick what to hit on every target — <b>${COMBAT_TARGETS.hull.ico} Hull</b> kills fastest, while <b>${COMBAT_TARGETS.weapons.ico} Weapons</b>/<b>${COMBAT_TARGETS.defense.ico} Defenses</b>/<b>${COMBAT_TARGETS.engines.ico} Engines</b> deal half damage but blunt fire, strip armor, or cripple drives. <b>Cripple every attacker's engines</b> and the convoy can break off and run. Destroyed foes drop their bounty &amp; cargo. Your flagship spends <b>${fw.ico} ${fw.name}</b> ammo per salvo${Object.keys(fw.ammo).length ? ` (${matsString(fw.ammo)})` : " (free)"}.</div>
      <div class="row" style="margin:6px 0"><span class="hint">Target system:</span> ${tgtBtns}</div>
      ${e.pendingRedeploy ? '<div class="hint" style="color:var(--warn)">⚠️ Re-rigging under fire — you must brace this round (the attackers get a free pass).</div>' : ""}
      <div class="row" style="margin:8px 0">
        ${e.pendingRedeploy
          ? `<button class="btn btn-primary" onclick="escortBraceRound()">🛡️ Brace (end round)</button>`
          : `<button class="btn btn-primary" onclick="escortFire()">🔥 Open fire</button>`}
        <button class="btn btn-sm ${canRun ? "btn-good" : ""}" ${canRun ? "" : "disabled"} title="${canRun ? "Every attacker's drive is crippled — slip away and continue" : "Cripple every attacker's 🚀 engines to break off"}" onclick="escortBreakOff()">🚀 Break off &amp; run</button>
        <button class="btn btn-sm" onclick="escortRepair()" title="Patch the flagship (+${FIELD_REPAIR.hull} hull, ${matsString(FIELD_REPAIR.mats)}) — you hold fire this round">🔧 Field repair (flagship)</button>
        ${postBtns}
      </div>
      <div class="cards raid-action-cards">${foeCards}</div></div>`;
  } else {
    const legFuel = m.legFuel || ESCORT_LEG_FUEL;
    const lowFuel = (S.res.fuel || 0) < legFuel;
    const rc = escortRepairCost();
    const notDeparted = m.legsLeft === m.legs;             // still in the prep window — no leg run yet
    const oFrom = PLANETS.find(p => p.id === m.from);
    const prep = notDeparted
      ? `<div class="hint" style="color:var(--accent)">🧹 Prep window: before you set out you can use the <b>⚔️ Raider</b> tab (and any others) to hunt pirates at <b>${oFrom ? oFrom.name : "origin"}</b> and <b>${dn ? dn.name : "dest"}</b> — every kill there lowers this convoy's threat. Each cycle you spend counts against the deadline.</div>`
      : "";
    combat = `<div class="card"><h4>🛰️ ${notDeparted ? "Staging — prep then depart" : "Underway"}</h4>
      <div class="hint">${m.legsLeft > 0 ? `${m.legsLeft} leg(s) to ${dn ? dn.name : "port"}. Each leg is a cycle and burns ${legFuel} ⛽ (you hold ${fmt(S.res.fuel || 0)}); risk of ambush climbs as you near the destination.` : "Final approach — bring them in."}</div>
      ${prep}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" ${m.legsLeft > 0 && lowFuel ? "disabled" : ""} onclick="escortAdvance()">${m.legsLeft > 0 ? `▶ ${notDeparted ? "Set out" : "Advance one leg"} (${legFuel} ⛽)` : "🏁 Deliver convoy"}</button>
        ${rc.miss > 0 ? `<button class="btn btn-sm" onclick="escortFleetRepair()" title="Repair the convoy's escorts & freighters to full">🔧 Repair convoy (${fmt(rc.credits)} cr · ${rc.metals}⛓️ · ${rc.electronics}🖥️)</button>` : ""}
        ${postBtns}</div>
      ${m.legsLeft > 0 && lowFuel ? '<div class="hint" style="color:var(--bad)">Not enough fuel for the next leg — refuel at the Market.</div>' : ""}</div>`;
  }
  // ---- per-vessel combat stance & fit (replaces asset-assignment) ----
  const stanceRows = e.fleet.map((sh, fi) => {
    if (sh.role !== "flagship" && !sh.alive) return "";
    const fit = shipFit(sh), active = sh.stance || "balanced", lvl = fit[active] || 0, max = vesselMaxLevel(sh), prof = stanceProfile(sh);
    const stBtns = Object.keys(VESSEL_STANCES).map(k => { const s = VESSEL_STANCES[k]; return `<button class="btn btn-sm ${active === k ? "btn-primary" : ""}" title="${s.name} — ${s.hint}" onclick="setVesselStance(${fi},'${k}')">${s.ico}</button>`; }).join("");
    const dots = "●".repeat(lvl) + "○".repeat(max - lvl);
    let upg;
    if (lvl >= max) upg = `<span class="hint">max fit</span>`;
    else { const cost = vesselUpgradeCost(sh, active, lvl + 1), ok = Object.keys(cost).every(a => (S.res[a] || 0) >= cost[a]); upg = `<button class="btn btn-sm ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="Upgrade ${VESSEL_STANCES[active].name} to Lv${lvl + 1} — costs ${costAssetString(cost)} from your hold${ok ? "" : " (buy more at the Market)"}" onclick="upgradeVessel(${fi})">⬆ Lv${lvl + 1} · ${costAssetString(cost)}</button>`; }
    const eff = (prof.atk ? `🔥+${Math.round(prof.atk * 100)}%` : "") + (prof.mit ? ` 🛡️${Math.round(prof.mit * 100)}%` : "") || "no bonus yet";
    const vtype = sh.role === "flagship" ? "flagship" : sh.role === "freighter" ? "freighter · caps Lv2" : (sh.cls || "escort");
    return `<div class="ship-stat" style="flex-wrap:wrap;gap:6px;align-items:center">
      <span class="k">${sh.ico} ${sh.name} <span class="hint">${vtype}</span></span>
      <span class="v" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
        ${stBtns} <span class="hint" title="${VESSEL_STANCES[active].name} fit level">${VESSEL_STANCES[active].ico}${dots}</span> ${upg} <span class="hint">→ ${eff}</span></span></div>`;
  }).join("");
  const outfit = `<div class="card"><h4>⚔️ Combat stance &amp; fit</h4>
    <div class="hint">Set each vessel's <b>stance</b> — ${VESSEL_STANCES.aggressive.ico} Aggressive (more 🔥), ${VESSEL_STANCES.balanced.ico} Balanced, ${VESSEL_STANCES.defensive.ico} Defensive (soak 🛡️) — then buy up to 3 <b>levels of fit</b> for it. Each level is paid from your hold (🔫 weapons · 🛸 drones · 🧠 AI cores) and costs more for bigger vessels; freighters cap at Lv2. Switching stance is free; fit is <b>consumed</b> for the run.${escortInCombat() ? " Re-rigging mid-ambush forfeits the round (you brace)." : ""}</div>
    <div class="hint" style="margin:4px 0">In hold: 🔫${fmt(S.res.weapons || 0)} 🛸${fmt(S.res.drones || 0)} 🧠${fmt(S.res.ai || 0)} — buy more at the 💱 Market.</div>
    ${stanceRows}</div>`;
  // ---- recruit friendly pirate bands as extra escorts (out of combat) ----
  let recruit = "";
  const hiredN = e.fleet.filter(s => s.hired && s.alive).length;
  if (!escortInCombat()) {
    const hiredRows = e.fleet.filter(s => s.hired && s.alive).map(s =>
      `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(bandById(s.bandId))}${s.ico} ${s.name} <span class="hint">${s.support ? "volunteer" : "hired"}</span></span>
        <span class="v"><button class="btn btn-sm btn-bad" title="Release this crew to free a slot (no refund)" onclick="escortDismissBand('${s.bandId}')">✖ Dismiss</button></span></div>`).join("");
    // on-call brotherhood standing by — bring them in free
    const onCallRows = bandsOnCall().filter(b => !e.fleet.some(s => s.hired && s.alive && s.bandId === b.id)).map(b =>
      `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(b)}${b.ico} ${b.name} <span class="hint">standing by · L${b.level}</span></span>
        <span class="v"><button class="btn btn-sm btn-good" onclick="escortRallyOnCall('${b.id}')">🤝 Rally (free)</button></span></div>`).join("");
    // your own warships — loyal, free convoy escorts
    const fleetRows = fleetRaidable().filter(s => !e.fleet.some(sh => sh.fleetId === s.id)).map(s =>
      `<div class="ship-stat" style="align-items:center"><span class="k">✦ ${FLEET_SHIPS[s.key].ico} ${s.name} <span class="hint">your ${SHIP_CLASSES[FLEET_SHIPS[s.key].cls].name} · 🔥${fleetShipStr(FLEET_SHIPS[s.key])}</span></span>
        <span class="v"><button class="btn btn-sm btn-good" onclick="escortRallyFleet('${s.id}')">✦ Assign (free)</button></span></div>`).join("");
    const avail = escortRecruitableBands()
      .filter(b => !e.fleet.some(s => s.hired && s.alive && s.bandId === b.id))
      .filter(b => bandBetrayChance(b) < 0.05)            // only trustworthy crews (desert risk < 5%)
      .sort((a, b) => bandBetrayChance(a) - bandBetrayChance(b));   // most reliable first
    const rows = avail.map(b => {
      const fee = escortRecruitFee(b), risk = Math.round(bandBetrayChance(b) * 100), rival = bandFoe(b);
      const blocked = rival && e.fleet.some(s => s.hired && s.alive && s.bandId === rival.id);
      return `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(b)}${b.ico} ${b.name} <span class="hint">${bandPers(b).ico}${bandPers(b).name} · ${bandTier(b).label} · L${b.level} · desert risk ${risk}%${blocked ? ` · ⚔️ rivals ${rival.name}` : ""}</span></span>
        <span class="v"><button class="btn btn-sm" ${hiredN < ESCORT_MAX_HIRED && S.res.credits >= fee && !blocked ? "" : "disabled"} title="${blocked ? "Won't fly with their rival aboard" : ""}" onclick="escortRecruitBand('${b.id}')">Hire (${fmt(fee)} cr)</button></span></div>`;
    }).join("");
    recruit = `<div class="card"><h4>🤝 Hire pirate escorts <span class="hint">${hiredN}/${ESCORT_MAX_HIRED} hired</span></h4>
      <div class="hint">Trustworthy crews (desert risk under 5%) from your 🏴‍☠️ Pirate Contacts will fly escort for a fee — higher standing &amp; your Dread make a crew cheaper and more loyal; flightier bands won't sign on. Listed most reliable first. Crews you've <b>📣 called for support</b> (Contacts tab) stand by to join free. Dismiss a crew to free a slot for another.</div>
      ${fleetRows ? `<div class="hint" style="margin:2px 0">✦ Your own warships will escort the convoy for free — loyal, and they take any damage back to your fleet:</div>${fleetRows}` : ""}
      ${onCallRows}${hiredRows}${rows || (onCallRows || hiredRows || fleetRows ? "" : '<div class="hint">No dependable bands will sign on right now — raise standing (and Dread), or call for support, in the Raider/Contacts tabs.</div>')}</div>`;
  }
  const liveThreat = Math.round(escortLiveThreat(m) * 100);
  const cyclesLeft = m.deadline != null ? Math.max(0, m.deadline - S.turn) : null;
  el.innerHTML = `<div class="panel-head"><h2>${m.pirate ? "🏴‍☠️ Smuggling run" : "🛡️ Escort — convoy"} to ${dn ? dn.name : "?"}</h2>
    <div class="subtitle">${m.pirate ? `Running ${m.contraband.ico} ${m.contraband.name} for the ${m.pirateName} · ` : ""}Leg ${m.legs - m.legsLeft}/${m.legs} · threat ${liveThreat}%${cyclesLeft != null ? ` · <span style="color:${cyclesLeft <= 1 ? "var(--bad)" : cyclesLeft <= 3 ? "var(--warn)" : "inherit"}">⏳ ${cyclesLeft} cycle${cyclesLeft === 1 ? "" : "s"} left</span>` : ""} · freighters ${aliveFr}/${totalFr} intact · reward ${fmt(m.reward)} cr${m.losses === 0 ? ` <span class="hint">(+${fmt(m.bonus)} flawless)</span>` : ""}</div></div>
    ${combat}
    <div class="card"><h4>🚢 Fleet — pooled firepower 🔥 ${fmt(F)}</h4>${roster}</div>
    ${outfit}
    ${recruit}
    <div class="row" style="margin-top:8px">${escortInCombat() ? '<span class="hint">Drive off the attackers to continue.</span>' : `<button class="btn btn-sm btn-bad" onclick="abortEscort()">🚪 Abandon escort (−20% fee)</button>`}</div>`;
}
function renderAll() {
  if (typeof document === "undefined") return;
  checkUnlocks(); checkDisclosure(); applyTabVisibility();
  renderResources(); renderShip(); renderGalaxy(); renderMarket();
  renderIndustry(); renderResearch(); renderMissions(); renderPolitics(); renderBases(); renderColonies(); renderRaid(); renderEscort(); renderContacts(); renderShipPanel(); renderFortunesPanel(); renderFleet(); renderOps(); renderLog();
  const tn = document.getElementById("turn"); if (tn) tn.textContent = S.turn;
}

/* ============================================================
   TABS / PERSISTENCE / INIT
   ============================================================ */
/* ============================================================
   PROGRESSIVE DISCLOSURE — reveal features as the captain grows, so a new
   player meets three tabs, not ten. Unlocks are action-driven (what you hold,
   research, earn) with cycle-count fallbacks so nothing hides forever. The
   next 1-2 locked tabs show as 🔒 teasers; the rest stay hidden until near.
   ============================================================ */
const ALWAYS_TABS = ["galaxy", "market", "ship"];
const TAB_LADDER = [
  { id: "missions",  blurb: "contracts, missions & your legacy goals",
    hint: "Unlocks with your first contract", test: s => s.contracts.length > 0 || s.turn >= 2 },
  { id: "research",  blurb: "spend tech points to unlock technologies",
    hint: "Unlocks once you earn tech points", test: s => (s.res.tech || 0) > 0 || s.turn >= 3 },
  { id: "fortunes",  blurb: "track temporary boons & banes and the signals you hunt",
    hint: "Unlocks once a Fortune or a signal turns up", test: s => (Array.isArray(s.fx) && s.fx.length > 0) || (Array.isArray(s.signals) && s.signals.length > 0) || (s.fxSeen && Object.keys(s.fxSeen).length > 0) || s.turn >= 6 },
  { id: "industry",  blurb: "refine raw materials into finished goods",
    hint: "Unlocks when you carry raw materials", test: s => RAW_IDS.some(c => (s.res[c] || 0) > 0) || s.turn >= 4 },
  { id: "raid",      blurb: "hunt pirates or prey on shipping",
    hint: "Unlocks as your trade empire grows (35,000 cr in sales) — or the moment you arm up or get attacked", test: s => (s.upgrades.cannons || 0) > 0 || s.prey || s.encounter || s.interdiction || (s.stats && s.stats.sales >= 35000) || s.turn >= 70 },
  { id: "escort",    blurb: "command a fleet and escort convoys for hire",
    hint: "An expert posting — prove yourself in combat first (12 kills/raids, or earn a Letter of Marque)", test: s => !!(s.unlocked && s.unlocked.raid) && !!s.pirate && (((s.pirate.bountyKills || 0) + (s.pirate.raids || 0)) >= 12 || (s.pirate.commissionsDone || 0) > 0) },
  { id: "contacts",  blurb: "manage your relationships with pirate bands",
    hint: "Unlocks once you've crossed paths with a pirate band", test: s => Object.keys(s.pirateBands || {}).length > 0 },
  { id: "bases",     blurb: "automated off-world production",
    hint: "Unlocks once you can afford a base (~5,000 cr)", test: s => (s.res.credits || 0) >= 5000 || Object.keys(s.bases || {}).length > 0 || s.turn >= 7 },
  { id: "politics",  blurb: "factions, influence, office & law",
    hint: "Unlocks once you're an established trader (50,000 cr in sales) — or you gain influence/office", test: s => (s.res.influence || 0) > 0 || s.office > 0 || (s.orgs && s.orgs.party) || (s.stats && s.stats.sales >= 50000) || s.turn >= 85 },
  { id: "colonies",  blurb: "found and grow your own worlds",
    hint: "Unlocks with the Colonial Charter (Research)", test: s => !!s.techs.colonial || currentPlanet().colonizable || Object.keys(s.colonies || {}).length > 0 },
  { id: "fleet",     blurb: "build your own ships at colony shipyards",
    hint: "Unlocks once you have a colony (build a Shipyard there)", test: s => Object.keys(s.colonies || {}).length > 0 || (Array.isArray(s.fleet) && s.fleet.length > 0) },
];
const RAW_IDS = ["ore", "crystals", "radioactives", "ice", "biomass", "spice", "gas", "relics"];
function tabUnlocked(id) { return S.showAllTabs || ALWAYS_TABS.includes(id) || !!(S.unlocked && S.unlocked[id]); }
function tabHint(id) { const g = TAB_LADDER.find(t => t.id === id); return g ? g.hint : ""; }
function unlock(id, announceIt) {
  if (!S.unlocked) S.unlocked = {};
  if (S.unlocked[id] || ALWAYS_TABS.includes(id)) return;
  S.unlocked[id] = true;
  const g = TAB_LADDER.find(t => t.id === id);
  if (g && announceIt !== false) {
    const lbl = tabLabel(id);
    log(`🔓 New feature unlocked: <b>${lbl}</b> — ${g.blurb}.`, "event");
    if (typeof toast === "function") toast(`🔓 Unlocked: ${lbl}`, "good");
  }
}
/* ---------- Feature disclosure (level-dependent UI) ----------
   Beyond tab unlocks, whole swathes of UI stay hidden until the player reaches
   the milestone that makes them relevant — each paired with a guiding objective
   (shown under Missions → Next Steps) and a cycle fallback so nothing hides
   forever. Phase 1: the market opens up once you manufacture your first Medicine. */
const DISCLOSURE_GATES = [
  { id: "advMarkets", icon: "🧪", goal: "Manufacture your first Medicine",
    reward: "Opens the full market — components, finished goods, luxuries & strategics",
    done: s => !!(s.made && s.made.medicine), fallbackTurn: 15 },
];
function checkDisclosure(silent) {
  if (!S.disc) S.disc = {};
  DISCLOSURE_GATES.forEach(g => {
    if (S.disc[g.id]) return;
    if (g.done(S) || (g.fallbackTurn && S.turn >= g.fallbackTurn)) {
      S.disc[g.id] = true;
      if (!silent) { log(`🔓 ${g.reward}.`, "event"); if (typeof toast === "function") toast("🔓 " + g.reward, "good"); }
    }
  });
}
// which market tiers are visible — Raw & Refined always; the rest after first Medicine
function tierRevealed(tier) {
  if (tier === "Raw" || tier === "Refined") return true;
  if (S.showAllTabs) return true;
  return !!(S.disc && S.disc.advMarkets);
}
function checkUnlocks(silent) {
  if (!S.unlocked) S.unlocked = {};
  TAB_LADDER.forEach(g => { if (!S.unlocked[g.id] && g.test(S)) unlock(g.id, !silent); });
}
function tabLabel(id) {
  const el = typeof document !== "undefined" && document.querySelector(`.tab[data-tab="${id}"]`);
  return (el && (el.dataset.label || el.textContent)) || id;
}
function applyTabVisibility() {
  if (typeof document === "undefined") return;
  const btns = Array.from(document.querySelectorAll(".tab"));
  // how many locked ladder tabs to tease (next 2 in ladder order)
  const lockedLadder = TAB_LADDER.filter(g => !tabUnlocked(g.id));
  const teasers = new Set(lockedLadder.slice(0, 2).map(g => g.id));
  btns.forEach(btn => {
    const id = btn.dataset.tab;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    const base = btn.dataset.label;
    if (tabUnlocked(id)) {
      btn.style.display = ""; btn.textContent = base; btn.classList.remove("locked");
      if (inCombat() && id !== combatHomeTab()) { btn.style.opacity = "0.4"; btn.title = "⚔️ Resolve the current engagement first"; btn.classList.add("combat-lock"); }
      else { btn.style.opacity = ""; btn.title = ""; btn.classList.remove("combat-lock"); }
    }
    else if (teasers.has(id)) { btn.style.display = ""; btn.style.opacity = "0.45"; btn.title = "🔒 " + tabHint(id); btn.textContent = "🔒 " + base; btn.classList.add("locked"); }
    else { btn.style.display = "none"; }
  });
}
function toggleShowAllTabs() {
  S.showAllTabs = !S.showAllTabs;
  if (typeof toast === "function") toast(S.showAllTabs ? "Everything revealed — all features shown." : "Guided mode on — features unlock as you progress.", "good");
  applyTabVisibility(); saveGame();
}
function setTab(name) {
  // surface the combat lock early: while engaged you can't leave the active battle tab
  if (typeof document !== "undefined" && name !== combatHomeTab() && combatLocked()) return;
  if (typeof document !== "undefined" && !tabUnlocked(name)) {
    if (typeof toast === "function") toast("🔒 " + (tabHint(name) || "Not available yet."), "bad");
    return;
  }
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("panel-" + name).classList.remove("hidden");
}
/* ============================================================
   VERSION CHECK — poll the server for a newer build and tell the player
   whether refreshing will keep their saved game (credits, colonies, …).
   On each release, bump APP_VERSION here AND version.json to match — AND the
   ?v= query on game.js / style.css in index.html, so browsers fetch the new
   build instead of a cached copy. Bump SAVE_VERSION (and the SAVE_KEY suffix)
   ONLY when a release breaks old saves.
   ============================================================ */
const APP_VERSION = "2.40.0";
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
      <li>💱 <b>Market</b> — trade goods; black market for contraband; aid or profiteer during crises. Quantity boxes remember what you last typed for each good; a 💡 hint flags the best <b>known</b> world to flip a commodity you buy here (profit per light-year), and <b>Sort: Best margin</b> ranks each tier by that same opportunity. <b>💰 Sell entire hold</b> unloads every legal good you're carrying at today's prices in one click (contraband here is held back — sell that individually if you'll risk the customs check).</li>
      <li>🏭 <b>Industry</b> — refine raw materials into finished goods.</li>
      <li>🔬 <b>Research</b> — unlock technologies.</li>
      <li>✨ <b>Fortunes</b> — temporary <b>boons &amp; banes</b> you pick up by exploring new worlds, sweeping the lanes and plain luck — extra actions, weapon surges, trade winds, research sparks, and rarer grand effects… balanced by reactor leaks, customs crackdowns and the like. This tab tracks your active effects (with time left and 🧹 clear buttons for banes), the <b>📡 signals</b> on your scope, and an <b>almanac</b> of every effect you've discovered. Chase a signal and <b>🔍 Investigate</b> it for a roll — stronger effects are briefer, and the rare, powerful ones are the prize of a hunted signal. Short on leads? The <b>🛰️ Sensor Office</b> sells scans that flush fresh signals onto your scope. Catalogue <b>every</b> effect in a domain to earn a 🏅 <b>Mastery</b> — a permanent passive edge. Unlocks once a Fortune or signal turns up.</li>
      <li>🎯 <b>Missions</b> — time-bound contracts, long-term career missions, and your legacy goals.</li>
      <li>🏛️ <b>Politics</b> — factions, influence, elections, the Senate and trade law. A <b>🌐 Sector Relations</b> card tracks how the five great powers stand with <i>each other</i> — Alliance/Peace/Cold War/War — independent of your own reputation. It drifts on its own each cycle (rivals trend toward war, others settle toward peace) and occasional named incidents can tip a pair into a new state; your own active letters of marque stoke the rivalry you're fighting for. Notable shifts appear in the log and the 📋 cycle recap.</li>
      <li>🏗️ <b>Bases</b> — automated off-world production. Build a <b>⛽ Fuel Refinery</b> (any base, 5 tiers) to crack stored 🧊 ice into fuel each cycle, and route fuel through the base↔colony trade network (import/export it like any good).</li>
      <li>🌍 <b>Colonies</b> — found and grow worlds: population, power and full industry chains, including a <b>⛽ Fuel Refinery</b> (ice + energy → fuel) and a <b>🏗️ Shipyard</b> (needs Metallurgy) that lets you build your own ships. Order in ice, export the fuel — fuel is now a tradeable part of the economy: buy/sell it at ports, stock it in bases &amp; colonies, and ship it across your network.</li>
      <li>✦ <b>Fleet</b> — build and run your own ships at colony <b>🏗️ Shipyards</b>: <b>freighters</b> (light → bulk hauler) to carry your goods and <b>warships</b> (corvette → battleship) to fight for you. A shipyard's tier sets the biggest hull it can lay down and how many slipways build at once; construction costs credits &amp; materials and takes several cycles, and ships draw upkeep each cycle (shown in the 💰 Cycle accounts log). Repair or scrap them at their home shipyard. <b>Dispatch a warship on a mission</b> (🎯 cull / 🛡️ guard / 🏴 raid a system) and — unlike hired pirates — <b>you keep 100%</b> of the bounty/loot, paying no fee; the risk is combat wear (a fragile hull in an infested system can be lost) and ongoing upkeep. You can also <b>call idle warships into your own raids</b> (loyal allies that take <b>no loot cut</b>) and <b>assign them to escort your convoys</b> for free — they never desert, and any damage they take comes back to your fleet. <b>Station freighters at a colony</b> on logistics duty to haul its goods — cutting its market import fee and base↔colony freight — and <b>station a warship there to guard them</b>, since unguarded convoys in pirate-active systems get ambushed (damage &amp; lost goods, and a fragile hauler can be sunk). Loyal and fully yours. In a raid, you can also <b>✦ Deploy Battle Fleet</b> — your <b>whole idle warship fleet at once</b> (not the 2-ally cap) fights as a formation with an escort-style posture (screen/balanced/press). Positioning matters: assign ships to <b>🛡️ Vanguard</b> (tanks — soaks nearly all incoming fire while it holds), <b>⚔️ Line</b> (your best damage dealers, protected behind the Vanguard), or <b>🌌 Reserve</b> (safest, weakest). Lose the Vanguard and the Line is exposed next — the formation collapses tier by tier — and keeping a Vanguard alive screens you personally too. Real stakes: ships take real damage and can be lost in a hard fight. Recall the fleet any time.</li>
      <li>⚔️ <b>Raider</b> — prey on shipping (Wanted/Dread, havens, marques) or hunt pirates for lawful bounties; resolve ambushes & interdictions. You build lasting history with named <b>pirate bands</b> (🏴‍☠️ Pirate Contacts): ally with them, spare them, pay tributes or gift valued cargo to raise their collaboration — friendlier crews take a smaller loot cut, rally readily, and hire on cheaper (and more loyally) for 🛡️ Escort runs. Your Dread earns their respect; killing them earns their hatred.</li>
      <li>🛡️ <b>Escort</b> (expert) — take a convoy contract and command a whole fleet: <b>pool every ship's firepower</b> and split it equally across the attackers you target. Each attacker telegraphs who it's <b>aiming at</b> (raiders hunt freighters, interceptors your biggest guns, gunships your flagship, and a ☠️ leader anchors tough waves) — kill the one about to hit cargo first, and use the <b>🛡️ Screen</b> stance to have escorts body-block the freighters. Each leg is a cycle on the clock and burns fuel, and the lanes grow more dangerous as you near port. Keep the freighters alive for the full fee; only your flagship can field-repair. Set each vessel's <b>combat stance</b> — ⚔️ Aggressive (more firepower), ⚖️ Balanced, or 🛡️ Defensive (soak hits) — and buy up to <b>3 levels of fit</b> for it, paid from your hold (🔫 weapons · 🛸 drones · 🧠 AI cores); bigger vessels cost more, freighters cap at Lv2, and switching stance is free. After accepting, you get a <b>prep window</b>: hunt pirates at the route's ends in the ⚔️ Raider tab to lower the convoy's threat (the fee stays the same) — but a contract <b>deadline</b> in cycles limits how long you can prepare. Completed runs raise your <b>Escort Guild</b> rank — better pay and a larger fleet. Friendly pirate bands may also post <b>🏴‍☠️ smuggling runs</b> here — carry their contraband for fat pay and deep crew standing, but you'll pick up Wanted heat, anger the destination's authorities, and earn no guild credit (bail and you'll burn the crew). Unlocks once you've proven yourself in combat.</li>
      <li>🏴‍☠️ <b>Contacts</b> — manage your loose <b>brotherhood</b> of pirate bands: see each crew's standing, personality, feuds, location and history; <b>tag</b> them (⭐ Brotherhood, 🟢 Ally, 👁️ Watch, 🔴 Rival) and the mark follows their name everywhere; pay tributes or gift cargo to win them over. <b>📣 Call for support</b> to summon a crew — those in your system fall in at once, distant ones travel in over a cycle and then stand by to join a raid (as an ally) or an escort (as a free volunteer). Tell a standing-by crew to <b>🛰️ Follow</b> and they'll jump where you jump for a stretch, or <b>✖ Stand down</b> to send them home early. The tab has three sub-views: <b>🤝 All contacts</b>, <b>📍 Around here</b> (crews based in this system and how lawless it is), and <b>📜 Mandates</b> — commission a crew to work a system for a set run: <b>🎯 cull pirates</b> or <b>🛡️ guard the lanes</b> (lawful — thins out pirate activity there) or <b>🏴 prey on shipping</b> (piracy in your name — fattest cut, but Wanted climbs and the locals seethe, <i>unless you hold a 📜 letter of marque against that faction, which makes it sanctioned — no Wanted</i>). You pay a fee up front and bank a cut of the take when the run ends. Some crews hold <b>blood feuds</b> and won't serve alongside their rival — you can settle it: a cheap <b>🕊️ Truce</b> sets the feud aside for a few cycles so they'll serve together for now, or a full <b>🤝 Broker peace</b> ends it for good (the fee scales with the feud's depth and eases with your standing &amp; Dread). Friendlier bands take a smaller loot cut, hire cheaper, and answer calls readily. Appears once you've crossed a pirate band.</li>
      <li>🚀 <b>Ship</b> — outfit your ship with upgrade modules.</li>
      <li>📋 <b>Operations</b> (sidebar) — a live board of everything running in the background: fleet missions, convoys &amp; construction, pirate mandates, your active escort/smuggling run, a letter of marque, crews standing by / inbound / following, plus your active ✨ Fortunes (with clear buttons) and 📡 signals. Each row shows a cycle countdown and clicks through to the relevant tab, so nothing you set in motion gets forgotten.</li>
    </ul>

    <h4>Header buttons</h4>
    <p style="margin:0 0 6px 0">⟲ <b>New</b> / 🌍 <b>Colonize</b> start fresh runs · 📖 <b>Log</b> downloads your captain's log (a dossier you can hand to an AI to write your biography or a novel).</p>

    <h4>Links</h4>
    <p style="margin:0">
      <a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📦 GitHub repository</a> ·
      <a href="${REPO_URL}/issues" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">🐞 Report a bug / request a feature</a> ·
      <a href="${REPO_URL}#readme" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📖 README</a>
    </p>
    <h4>Save &amp; Load</h4>
    <p style="margin:0 0 6px">Your game autosaves in this browser. Use <b>💾 Save</b> (top bar) to download a save file you own — a backup, or to carry your run to another browser or machine — and <b>📂 Load</b> to restore one.</p>
    <h4>Sound</h4>
    <p style="margin:0 0 6px">Procedural sound effects play on trades, combat, travel and big moments. Toggle them with <b>🔊 Sound</b> in the Captain's Console (bottom-left).</p>
    <h4>E-ink mode</h4>
    <p style="margin:0 0 6px">Reading on a Kindle Scribe or other e-reader? Tap <b>📖 E-ink mode</b> in the Captain's Console for a high-contrast black-on-white display — gradients, glows and animations are stripped for crisp grayscale legibility. Tap <b>🌙 Color mode</b> to switch back. Your choice is remembered.</p>
    <h4>Progression &amp; Guided Mode</h4>
    <p style="margin:0 0 6px">To avoid overload, features reveal as you grow: the market starts with raw &amp; refined goods (the rest opens when you first manufacture <b>Medicine</b>); the galaxy shows worlds within sensor range and widens as you travel; tabs like <b>Raider</b> and <b>Politics</b> arrive as your trade empire matures; and colony build options stage in by tier. The <b>🧭 Next Steps</b> panel in 🎯 Missions always shows what unlocks next and how. Veteran saves keep everything they've already earned.</p>
    <p style="margin:0"><button class="btn btn-sm" onclick="toggleShowAllTabs();toggleHelp();toggleHelp()">${typeof S!=="undefined"&&S.showAllTabs?"↩️ Switch to Guided mode (hide features until earned)":"👁️ Show everything now (reveal all features)"}</button></p>
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
/* ============================================================
   SAVE / LOAD TO DISK — the autosave lives in localStorage (one slot, tied to
   this browser). These let a captain export the run to a .json file they own:
   a backup, a way to move between machines/browsers, or to keep many saves.
   Importing replaces the autosave and reloads so init() normalises cleanly.
   ============================================================ */
const SAVE_FILE_TAG = "stellar-frontier-save";
function buildSaveText() {
  // a small envelope so the file is self-describing and future-proof
  return JSON.stringify({
    game: SAVE_FILE_TAG,
    version: SAVE_VERSION,
    exported: new Date().toISOString(),
    cycle: S.turn,
    credits: S.res && S.res.credits,
    state: S,
  }, null, 2);
}
function looksLikeState(o) {
  return !!o && typeof o === "object" && o.res && typeof o.res === "object"
    && o.location !== undefined && o.upgrades && typeof o.upgrades === "object";
}
function parseSaveText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Not a valid save file (could not read JSON)." }; }
  // accept our envelope, or a bare state object (forgiving)
  const state = data && data.state !== undefined ? data.state : data;
  if (data && data.game && data.game !== SAVE_FILE_TAG) return { ok: false, error: "This file is not a Stellar Frontier save." };
  if (!looksLikeState(state)) return { ok: false, error: "This file doesn't contain a valid Stellar Frontier save." };
  return { ok: true, state: state };
}
function exportSave() {
  if (typeof saveGame === "function") saveGame();   // capture the very latest state
  const text = buildSaveText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Save export unavailable here.", "bad");
    return text;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${SAVE_FILE_TAG}-cycle-${S.turn}-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Game saved to disk.", "good");
  return text;
}
// testable core: validate text, persist to the autosave slot. Returns {ok,error}.
function importSaveText(text) {
  const res = parseSaveText(text);
  if (!res.ok) return res;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(res.state)); }
  catch (e) { return { ok: false, error: "Could not write the save to this browser." }; }
  return { ok: true, state: res.state };
}
function importSave() {
  if (typeof document === "undefined" || !document.createElement || typeof FileReader === "undefined") {
    if (typeof toast === "function") toast("Save import unavailable here.", "bad");
    return;
  }
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json"; input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importSaveText(String(reader.result || ""));
      if (!res.ok) { if (typeof toast === "function") toast(res.error || "Import failed.", "bad"); input.remove(); return; }
      if (typeof confirm === "function" && !confirm("Load this save? It will replace your current game (cycle " + (res.state.turn != null ? res.state.turn : "?") + "). The page will reload.")) { input.remove(); return; }
      if (typeof toast === "function") toast("Save loaded — reloading…", "good");
      if (typeof location !== "undefined" && location.reload) location.reload();
    };
    reader.onerror = () => { if (typeof toast === "function") toast("Could not read that file.", "bad"); };
    reader.readAsText(file);
  });
  if (document.body) document.body.appendChild(input);
  input.click();
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
  if (colony) unlock("colonies", false); if (politics) unlock("politics", false);
  checkUnlocks(true);
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
  Object.values(S.bases).forEach(b => {
    if (b.trade === true) b.trade = { on: true, exp: {}, imp: {}, cols: {} };
    else if (!b.trade || typeof b.trade !== "object") b.trade = { on: false, exp: {}, imp: {}, cols: {} };
    else { b.trade.exp = b.trade.exp || {}; b.trade.imp = b.trade.imp || {}; b.trade.cols = b.trade.cols || {}; }
  });
  if (!Array.isArray(S.fx)) S.fx = [];   // backfill Fortunes (temporary boons/banes)
  if (!Array.isArray(S.signals)) S.signals = [];   // backfill discoverable signals
  if (!S.fxSeen) S.fxSeen = {};                     // backfill Fortunes almanac
  if (!S.fxMastery) S.fxMastery = {};               // backfill almanac mastery
  if (!Array.isArray(S.mandates)) S.mandates = [];   // backfill pirate mandates
  if (!Array.isArray(S.fleet)) S.fleet = [];         // backfill player fleet
  if (!S.battleGroupPosture) S.battleGroupPosture = "balanced";
  if (!S.factionRel) S.factionRel = {};
  ensureFactionRel();   // backfill any pairs missing from an older save
  if (S.escort && Array.isArray(S.escort.fleet)) S.escort.fleet.forEach(sh => { if (!sh.fit) sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; if (!sh.stance) sh.stance = "balanced"; });   // migrate old outfit fleets to stance/fit
  if (!S.colonies) S.colonies = {};
  Object.values(S.colonies).forEach(c => { if (!c.orders) c.orders = {}; if (c.unrest == null) c.unrest = 0; if (c.faction === undefined) c.faction = null; if (!c.idle) c.idle = {}; });
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
  if (!S.unlocked) { S.unlocked = {}; checkUnlocks(true); }   // veterans keep everything they've earned, silently
  if (S.showAllTabs == null) S.showAllTabs = false;
  if (S.sound == null) S.sound = true;
  if (S.eink == null) S.eink = false;
  if (S.pirateIntel === undefined) S.pirateIntel = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  if (S.res && S.res.drones == null) S.res.drones = 0;
  if (S.res && S.res.ai == null) S.res.ai = 0;
  if (!S.pollution) S.pollution = {};
  if (S.climate == null) S.climate = 0;
  if (!S.pirate) S.pirate = { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0 };
  if (S.pirate.commissionsDone == null) S.pirate.commissionsDone = 0;
  initSubsys();
  if (!S.pirate.wuse) S.pirate.wuse = {};
  if (!S.combat) S.combat = { posture: "balanced", offense: 50, target: "hull", advanced: false };
  if (S.prey === undefined) S.prey = null;
  if (S.preyChoices === undefined) S.preyChoices = null;
  if (S.allies === undefined) S.allies = null;
  if (S.interdiction === undefined) S.interdiction = null;
  if (S.haven === undefined) S.haven = null;
  if (S.escort === undefined) S.escort = null;
  if (S.escortRep == null) S.escortRep = 0;
  if (!S.pirateBands) S.pirateBands = {};
  if (S.commission === undefined) S.commission = null;
  UPGRADES.forEach(u => { if (S.upgrades[u.id] == null) S.upgrades[u.id] = 0; });  // backfill new upgrades (cannons)
  syncObjectives();
  if (!S.disc) S.disc = {}; if (!S.made) S.made = {}; if (S.stats && S.stats.sales == null) S.stats.sales = 0; checkUnlocks(true); checkDisclosure(true); applyTabVisibility();
  applyEink();
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());
  // Captain's Console — game actions live in the sidebar, keeping the top bar
  // to just resources and the cycle button.
  const menu = document.getElementById("gameMenu") || document.querySelector(".brand");
  [
    { label: "⟲ New",      title: "New game (trading start)",                                                                            fn: () => newGame() },
    { label: "🌍 Colonize", title: "New game — skip trading, start ready to colonize",                                                    fn: () => newGame("colony") },
    { label: "📖 Log",      title: "Download your captain's log — a narrative dossier you can hand to an AI to write your biography or a novel", fn: () => downloadJournal() },
    { label: "💾 Save",     title: "Save this game to a file on your disk (backup, or move between browsers/machines)",                     fn: () => exportSave() },
    { label: "📂 Load",     title: "Load a game from a save file on your disk (replaces the current game)",                                fn: () => importSave() },
    { label: soundLabel(), title: "Toggle sound effects", fn: () => toggleSound(), id: "soundToggleBtn" },
    { label: einkLabel(), title: "High-contrast black-on-white mode for e-ink readers (Kindle Scribe etc.)", fn: () => toggleEink(), id: "einkToggleBtn" },
    { label: "❓ Help",     title: "How to play, and links to the project",                                                                fn: () => toggleHelp() },
  ].forEach(b => {
    const el = document.createElement("button");
    el.className = "btn btn-sm"; el.textContent = b.label; el.title = b.title;
    if (b.id) el.id = b.id;
    el.addEventListener("click", b.fn); menu.appendChild(el);
  });
  // (No console button for a politics start — careers switch freely in-game; the
  //  Politics tab offers an "Enter Public Life" kickstart instead.)
  renderAll(); setTab("galaxy");
  startVersionWatch();
}
window.addEventListener("DOMContentLoaded", init);

Object.assign(window, {
  travel, buyQty, sellQty, buyMax, sellAll, setMarketSort, sellEntireHold, extract, salvage, produce,
  research, researchTech, doPolitics, doMission, buyUpgrade, setDecree,
  buildBase, buildModule, depositQty, withdrawQty, storeAllCargo, fulfilContract,
  colonize, buildColonyBuilding, setTax, colonyDeposit, colonyWithdraw, setOrder, explore, newGame,
  foundOrg, upgradeOrg, runOrgAbility,
  proposeBill, lobbyFaction, bribeFaction, callVote, repealPolicy,
  investLawyer, investBribe, investSpin, investBury, investStrongarm, investScapegoat, faceTrial,
  runForElection, seekAppointment, stageCoup, lobbyLaw, enterPublicLife,
  donateRelief, donateReliefQty, gougeSell, gougeSellQty, lootCrisis, downloadJournal,
  prowl, raidAttack, raidNoQuarter, raidExtort, raidDisengage, raidVolley, raidCallAllies, raidSpareRecruit, raidSummonOnCall, repairShip,
  clearFx, investigateSignal, buySignalScan,
  setBandTag, callBandSupport, bandFollow, bandStandDown, escortRallyOnCall,
  commissionMandate, cancelMandate, setMandateField, reconcileBands, brokerTruce,
  orderShip, scrapShip, repairFleetShip, assignFleetMission, recallFleetMission, setFleetMissionField, raidSummonFleet, escortRallyFleet,
  assignLogistics, recallLogistics, setFleetLogiField,
  deployBattleGroup, recallBattleGroup, setBattleGroupPosture, setBattleGroupFormation,
  acceptEscort, refreshEscortOffers, escortAdvance, escortFire, escortRepair, escortFleetRepair, escortToggleTarget, escortFocus, setEscortPosture, setEscortTarget, escortBreakOff, abortEscort, setVesselStance, upgradeVessel, escortBraceRound, escortRecruitBand, escortDismissBand,
  giftBandCredits, giftBandCargo,
  navyBribe, navyFight, navySurrender, settleWarrants,
  fence, fenceAll, fenceQty, fenceAllPlunder,
  establishHaven, upgradeHaven, layLow, havenStashAll, havenTakeAll,
  acceptCommission, pirateLegacy, marshalLegacy, checkVersion, toggleHelp, toggleShowAllTabs, toggleEink,
  exportSave, importSave, importSaveText, parseSaveText, buildSaveText, toggleBaseTrade, setBaseTradeGood, setBaseTradeColony, baseMarketBuy, baseMarketSell, baseBuyQty, baseSellQty,
  sfx, toggleSound,
  alignColony, colonyIndependence, toggleColonyProcess,
  setSubView,
  huntPirates, engageTarget, standDown, encounterPay, encounterFlee, encounterFight, deepScan, repairSubsys, repairAll, buyPirateMap,
  setCombatPosture, setCombatOffense, setCombatTarget, fieldRepair,
});

/* ============================================================
   STELLAR FRONTIER — content catalogs
   The static content tables for every progression/politics/building system:
   ship Upgrades, the Technology tree, faction Missions, the public Office
   ladder, political Organizations, Senate Bills & policies, player-base
   modules, and colony buildings. A second "static tables" file alongside
   data.js — this one for the systems built ON TOP of the core economy
   rather than the economy itself. Most entries also carry a small amount of
   directly-coupled logic (officeName/currentOffice, policyActive/lawStatus/
   priceShock, baseModuleList/moduleOutput/moduleMats,
   colonyBuildingList/colonyBuildingMats/effIndustry/effTech) — kept beside
   the tables they read, same pattern as RECIPES' recipeAvailable() in
   data.js.

   Loaded after data.js and galaxygen.js, before game.js. S, toast, log,
   fmt and applyPolDelta still live in state.js/feedback.js/resources.js/
   game.js at this point in the split — safe, since every function here is
   only CALLED later (or, for the data tables' embedded closures like ORGS'
   `effect`/`passive` and BILLS' `oneShot`, only invoked on a player action
   long after every script has finished loading), same pattern as every
   prior slice.
   ============================================================ */

"use strict";

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
    { id: "shipyard_small", name: "Small Shipyard", ico: "🏗️", tiers: 2, baseCost: 2600, costMul: 1.7, shipyard: true,
      desc: "Lay down light hulls right here — a Light Freighter/Corvette at Tier 1, a Medium Freighter/Frigate at Tier 2. Caps there; a full-range Shipyard is a colony building. Adds a slipway per tier for parallel builds. Tier 2 also boosts scrap salvage to 60% of a hull's metals (up from the usual 40%)." },
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
const ADVANCED_MODULES = ["solar", "ext_gas", "ext_relics", "ext_radioactives", "ext_crystals", "shipyard_small"];
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


/* ============================================================
   STELLAR FRONTIER — game state
   The mutable state singleton (S), freshState() (what a brand-new game
   starts with — trading, colony, or politics opening), and the small
   resource/action accessors nearly everything else in the game calls.

   Loaded after data.js, galaxygen.js and crises.js, before game.js.
   freshState() references UPGRADES, OFFICES and the colony-start constants
   (COLONY_START_TECHS/CREDITS/KIT) which still live in game.js at this
   point in the split — safe, since freshState() is only ever CALLED later,
   from init()/newGame(), long after every script has finished loading.
   ============================================================ */

"use strict";

let S;
const ACTIONS_PER_CYCLE = 4;
const BASE_CARGO = 120;
const BASE_FUEL = 100;

function freshState(opts = {}) {
  const res = { credits: 3000, fuel: 100, tech: 0, influence: 0 };
  CARGO_IDS.forEach(id => res[id] = 0);
  const active = chooseActivePlanets();
  const freshFrontierSeed = opts.seed || Math.floor(Math.random() * 2**31);   // a specific Sector Code, or a fresh random roll
  const freshCoreSeed = deriveCoreSeed(freshFrontierSeed);
  applyCoreVariance(freshCoreSeed);   // vary the charted 20's deposits/industry/tech/enforce before pickStart reads them
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
    ironman: !!opts.ironman,        // optional hardcore toggle: disables Load for this run — live with your choices
    lengthMult: opts.lengthMult || 1,   // scales the scalar legacy goals (net worth, colony pop) for a shorter/longer campaign
    active,              // which planets feature in this playthrough
    frontierSeed: freshFrontierSeed,                   // seeds the procedural frontier ring — different every new game
    laneSeed: deriveLaneSeed(freshFrontierSeed),        // derived, not rolled independently — one Sector Code reproduces both
    coreSeed: freshCoreSeed,                            // derived too — varies the charted 20's stats, same Sector Code reproduces it
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
    territoryControl: {},        // active territory contests: pid -> { owner, challenger, meter }
    territoryFlips: {},          // permanent record of world seizures: pid -> new faction id (replayed onto PLANETS on load)
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
    eink: false,               // high-contrast e-ink display mode
    pirateIntel: null,         // bought pirate-activity chart { worlds, until, scope }
    achieved: {},
    won: false,
  };
}

function cargoCap()  { return Math.max(20, BASE_CARGO + S.upgrades.cargo * 150 + (typeof fxAdd === "function" ? fxAdd("cargoBonus") : 0) + (typeof convoyCargoBonus === "function" ? convoyCargoBonus() : 0)); }
function fuelCap()   { return BASE_FUEL + S.upgrades.fueltank * 40; }
function cargoUsed() { return CARGO_IDS.reduce((s, id) => s + (S.res[id] || 0), 0); }
function cargoFree() { return cargoCap() - cargoUsed(); }
function currentPlanet() { return PLANETS.find(p => p.id === S.location); }
function actionsMax() { return Math.max(1, ACTIONS_PER_CYCLE + (typeof fxAdd === "function" ? fxAdd("actions") : 0)); }   // Fortunes can grant/sap actions
function actionsLeft() { return (S.jail > 0) ? 0 : actionsMax() - S.actionsUsed; }
function useAction() { S.actionsUsed++; }

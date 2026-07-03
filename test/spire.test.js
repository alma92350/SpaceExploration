"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* The Concordat Spire — a late-game mega-project unlocked once Terraforming
   is researched (the tech tree's dead end otherwise leaves S.res.tech with
   nowhere to go). Funded by material contributions from any colony's own
   storage plus a global tech pool, tracked toward SPIRE_TARGETS; which
   factions' worlds supply it emergently drifts S.factionRel toward peace
   (spread) or tension (one faction dominating), with no explicit dedication
   choice. Completion opens a third capstone legacy alongside Pirate Lord/
   Sector Marshal (outlaw.js). */

test("spireUnlocked is false without Terraforming and true once researched", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`spireUnlocked()`), false);
  run(`S.techs.terraform = true;`);
  assert.equal(run(`spireUnlocked()`), true);
});

test("launchSpireProject refuses before Terraforming is researched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  assert.equal(run(`S.spire`), null);
});

test("launchSpireProject refuses without a valid colony at the target id", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`launchSpireProject("nonexistent-colony");`);
  assert.equal(run(`S.spire`), null);
});

test("launchSpireProject refuses without enough credits or metals, leaving state untouched", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`S.res.credits = 100; S.res.metals = 5;`);
  run(`launchSpireProject(S.location);`);
  assert.equal(run(`S.spire`), null);
  assert.equal(run(`S.res.credits`), 100);
});

test("launchSpireProject succeeds, deducts cost, and seeds a zeroed contribution tally", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  assert.equal(run(`S.spire.site`), run(`S.location`));
  assert.equal(run(`S.spire.complete`), false);
  assert.equal(run(`S.spire.contributed.tech`), 0);
  assert.equal(run(`S.res.credits`), 100000 - run(`SPIRE_SITE_COST.credits`));
  assert.equal(run(`S.res.metals`), 1000 - run(`SPIRE_SITE_COST.metals`));
});

test("a second launchSpireProject call is refused once a site is already chosen", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  const firstSite = run(`S.spire.site`);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0];
       S.colonies[otherPid] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       launchSpireProject(otherPid);`);
  assert.equal(run(`S.spire.site`), firstSite, "the chosen site must not be replaced");
});

test("contributeToSpire pulls from the DOCKED colony's own storage, capped by stock and remaining need", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: { alloys: 200 }, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`const _orig72 = document.getElementById.bind(document); document.getElementById = (id) => id === "spire-alloys" ? { value: 150 } : _orig72(id);`);
  run(`contributeToSpire("alloys");`);
  assert.equal(run(`S.spire.contributed.alloys`), 150);
  assert.equal(run(`S.colonies[S.location].storage.alloys`), 50);
});

test("contributeToSpire refuses when the player isn't docked at a colony", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: { alloys: 200 }, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`const otherPid = Object.keys(currentPlanet().distances)[0]; S.location = otherPid;`);
  run(`const _orig83 = document.getElementById.bind(document); document.getElementById = (id) => id === "spire-alloys" ? { value: 100 } : _orig83(id);`);
  run(`contributeToSpire("alloys");`);
  assert.equal(run(`S.spire.contributed.alloys`), 0, "no colony here — nothing should move");
});

test("contributeSpireTech deducts from the global S.res.tech pool, capped by stock and need", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000; S.res.tech = 500;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`contributeSpireTech(300);`);
  assert.equal(run(`S.spire.contributed.tech`), 300);
  assert.equal(run(`S.res.tech`), 200);
});

test("contributeToSpire/contributeSpireTech refuse once the Spire is already complete", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000; S.res.tech = 500;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: { }, storage: { alloys: 100 }, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`S.spire.complete = true;`);
  run(`document.getElementById = () => ({ value: 50 });`);
  run(`contributeSpireTech(50); contributeToSpire("alloys");`);
  assert.equal(run(`S.spire.contributed.tech`), 0);
  assert.equal(run(`S.spire.contributed.alloys`), 0);
});

test("checkSpireCompletion flips complete only once every target is met, and only once", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`S.spire.contributed.tech = SPIRE_TARGETS.tech; S.spire.contributed.alloys = SPIRE_TARGETS.alloys; S.spire.contributed.electronics = SPIRE_TARGETS.electronics;`);
  run(`checkSpireCompletion();`);
  assert.equal(run(`S.spire.complete`), false, "antimatter is still short — not complete yet");
  run(`S.spire.contributed.antimatter = SPIRE_TARGETS.antimatter;`);
  run(`checkSpireCompletion();`);
  assert.equal(run(`S.spire.complete`), true);
});

test("spireDominantFaction reads null below the threshold and below the spread share, and the right faction once dominant", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.techs.terraform = true;`);
  run(`S.spire = { site: S.location, contributed: { tech: 0, alloys: 0, electronics: 0, antimatter: 0 }, byFaction: Object.fromEntries(FACTION_KEYS.map(f => [f, 0])), complete: false };`);
  assert.equal(run(`spireDominantFaction()`), null, "nothing contributed yet");
  run(`S.spire.byFaction.core = 200; S.spire.byFaction.miners = 200;`);
  assert.equal(run(`spireDominantFaction()`), null, "below SPIRE_READ_THRESHOLD");
  run(`S.spire.byFaction.core = 400; S.spire.byFaction.miners = 400; S.spire.byFaction.agri = 200;`);
  assert.equal(run(`spireDominantFaction()`), null, "evenly spread above the threshold — no single faction dominates");
  run(`S.spire.byFaction = { core: 900, miners: 100, agri: 0, syndicate: 0, frontier: 0 };`);
  assert.equal(run(`spireDominantFaction()`), "core", "core holds a clear majority share");
});

test("processSpire nudges a dominant faction's rivals down, and does nothing below the read threshold", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.techs.terraform = true; ensureFactionRel();`);
  run(`S.spire = { site: S.location, contributed: { tech: 0, alloys: 0, electronics: 0, antimatter: 0 }, byFaction: Object.fromEntries(FACTION_KEYS.map(f => [f, 0])), complete: false };`);
  const before = run(`S.factionRel[factionPairKey("core", "frontier")]`);
  run(`processSpire();`);
  assert.equal(run(`S.factionRel[factionPairKey("core", "frontier")]`), before, "nothing contributed yet — no drift");
  run(`S.spire.byFaction = { core: 900, miners: 0, agri: 0, syndicate: 0, frontier: 100 };`);
  run(`processSpire();`);
  assert.ok(run(`S.factionRel[factionPairKey("core", "frontier")]`) < before, "core's rival (frontier) should grow tenser under core's dominance");
});

test("processSpire nudges every relation toward peace when contributions are broadly shared", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.techs.terraform = true; ensureFactionRel(); S.factionRel[factionPairKey("core","frontier")] = -50;`);
  run(`S.spire = { site: S.location, contributed: { tech: 0, alloys: 0, electronics: 0, antimatter: 0 }, byFaction: { core: 250, miners: 250, agri: 200, syndicate: 150, frontier: 150 }, complete: false };`);
  const before = run(`S.factionRel[factionPairKey("core", "frontier")]`);
  run(`processSpire();`);
  assert.ok(run(`S.factionRel[factionPairKey("core", "frontier")]`) > before, "a shared common cause should ease even a tense pair");
});

test("checkSpireCompletion applies a permanent effect once: +rep with a dominant patron, or a relations floor if shared", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;`);
  run(`S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };`);
  run(`launchSpireProject(S.location);`);
  run(`Object.keys(SPIRE_TARGETS).forEach(c => S.spire.contributed[c] = SPIRE_TARGETS[c]);`);
  run(`S.spire.byFaction = { core: 900, miners: 0, agri: 0, syndicate: 0, frontier: 0 };`);
  const repBefore = run(`S.rep.core || 0`);
  run(`checkSpireCompletion();`);
  assert.ok(run(`S.rep.core`) > repBefore, "the dominant patron should gain a permanent rep bump");
});

test("spireCriteria/spireReady/spireLegacy follow the same guard shape as the Pirate Lord and Sector Marshal capstones", () => {
  const { run } = createSandbox();
  // fireworks()'s canvas stub only no-ops its FIRST call per sandbox (no real <canvas>
  // to bail out on) — checkSpireCompletion() then spireLegacy() both fire it, so the
  // second call falls through to the real requestAnimationFrame, absent in Node.
  run(`globalThis.requestAnimationFrame = () => 0;`);
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true };`);
  assert.equal(run(`spireReady()`), false, "not researched, no site, not complete");
  run(`S.techs.terraform = true;`);
  run(`spireLegacy();`);
  assert.equal(run(`S.legacyTitle`), null, "refused before the Spire is even founded");
  run(`S.res.credits = 100000; S.res.metals = 1000;
       S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       launchSpireProject(S.location);
       Object.keys(SPIRE_TARGETS).forEach(c => S.spire.contributed[c] = SPIRE_TARGETS[c]);
       checkSpireCompletion();`);
  assert.equal(run(`spireReady()`), true);
  run(`spireLegacy();`);
  assert.ok(run(`S.legacyTitle`), "a title should now be sealed");
  assert.equal(run(`S.won`), true);
});

test("spireLegacy refuses once a legacy title is already sealed, mirroring the pirate/marshal guard", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.legacyTitle = "The Dread Lord";`);
  run(`S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;
       S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       launchSpireProject(S.location);
       Object.keys(SPIRE_TARGETS).forEach(c => S.spire.contributed[c] = SPIRE_TARGETS[c]);
       checkSpireCompletion();`);
  run(`spireLegacy();`);
  assert.equal(run(`S.legacyTitle`), "The Dread Lord", "an already-sealed legacy must not be overwritten");
});

test("spireLegacy titles branch on a dominant patron vs. a shared, unifying outcome", () => {
  const { run } = createSandbox();
  run(`globalThis.requestAnimationFrame = () => 0;`);   // see note above — checkSpireCompletion + spireLegacy both fire fireworks()
  run(`S = freshState(); rollPrices(); S.achieved = { worth: true, terraform: true, governor: true, explored: true, colony: true }; S.techs.terraform = true; S.res.credits = 100000; S.res.metals = 1000;
       S.colonies[S.location] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
       launchSpireProject(S.location);
       Object.keys(SPIRE_TARGETS).forEach(c => S.spire.contributed[c] = SPIRE_TARGETS[c]);
       S.spire.byFaction = { core: 900, miners: 0, agri: 0, syndicate: 0, frontier: 0 };
       checkSpireCompletion(); spireLegacy();`);
  assert.equal(run(`S.legacyTitle`), "Patron of the Core Authority");
});

test("DISCLOSURE_GATES fires the Spire reveal exactly once Terraforming is researched, not before", () => {
  const { run } = createSandbox();
  run(`S = freshState(); checkDisclosure(true);`);
  assert.equal(run(`!!S.disc.spire`), false);
  run(`S.techs.terraform = true; checkDisclosure(true);`);
  assert.equal(run(`!!S.disc.spire`), true);
});

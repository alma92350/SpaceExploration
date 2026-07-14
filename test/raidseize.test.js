"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Boarding and seizing a beaten hull — an alternative to destroying it in combatStrike's kill
   branch (raidWinPirate/raidWinMerchant/raidWinPatrol/raidWinPlanet, raiding.js). Two paths to
   eligibility: pinned (no engines) AND crippled to 35% hp (same threshold raidCanSpare uses),
   OR ground down to 15% hp regardless of engine status — requiring BOTH pinned AND crippled
   made this unreachable against the default Hull combat target, since only the dedicated
   Engines target ever zeroes engines. The prize joins S.fleet as a real warship, class-matched
   off SHIP_CLASSES, at the same beaten-down hull fraction it surrendered at. Consequences
   otherwise mirror a normal (non-No-Quarter) kill of the same prey type, minus bounty/full
   plunder. */

function foe(overrides) {
  return Object.assign({
    type: "hauler", name: "Hauler", ico: "🚚", faction: "core", cargo: {}, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5,
    isPirate: false, cls: "corvette", engines: 0, enginesMax: 2, hp: 100, maxhp: 1000, _engaged: true,
  }, overrides || {});
}
function setupEngagement(run, overrides) {
  run(`S = freshState(); rollPrices();
    S.prey = ${JSON.stringify(foe(overrides))};
    S.allies = null;`);
}

test("raidCanSeize requires an engaged, crippled, non-ground target, pinned OR critically low", () => {
  const { run } = createSandbox();
  setupEngagement(run, {});
  assert.equal(run(`raidCanSeize()`), true, "engines dead + hp at 10% (well under the 35% pinned threshold) should be seizable");

  setupEngagement(run, { _engaged: false });
  assert.equal(run(`raidCanSeize()`), false, "an unengaged target shouldn't be seizable");

  setupEngagement(run, { hp: 900 });
  assert.equal(run(`raidCanSeize()`), false, "a barely-scratched hull won't surrender even pinned");

  setupEngagement(run, { ground: true, isPlanetRaid: true, engines: 0 });
  assert.equal(run(`raidCanSeize()`), false, "a planetary garrison is a fortress, not a hull — never seizable even though its engines read 0");
});

test("raidCanSeize's two paths: pinned only needs 35% hp, a live drive needs grinding down to 15%", () => {
  const { run } = createSandbox();
  // still-mobile (engines alive) but only moderately hurt (25% hp) -> neither path qualifies
  setupEngagement(run, { engines: 2, hp: 250, maxhp: 1000 });
  assert.equal(run(`raidCanSeize()`), false, "25% hp with a live drive is under the pinned 35% bar but the drive isn't pinned, and 25% isn't below the unpinned 15% bar either");

  // still-mobile but critically wrecked (10% hp) -> the "too far gone to run" path kicks in
  setupEngagement(run, { engines: 2, hp: 100, maxhp: 1000 });
  assert.equal(run(`raidCanSeize()`), true, "a live drive doesn't matter once the hull is this far gone — this is the bug fix: normal Hull-target damage alone should be able to unlock seizing");

  // pinned and moderately hurt (25% hp) -> the pinned path's looser 35% bar covers it
  setupEngagement(run, { engines: 0, hp: 250, maxhp: 1000 });
  assert.equal(run(`raidCanSeize()`), true, "pinned drops the bar to 35% — no need to grind all the way to 15%");
});

test("raidCanSeize is false with no active engagement", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices(); S.prey = null;`);
  assert.equal(run(`raidCanSeize()`), false);
});

test("raidSeizeHull refuses when the target isn't seizable yet", () => {
  const { run } = createSandbox();
  setupEngagement(run, { engines: 2, hp: 250, maxhp: 1000 });
  const fleetBefore = run(`JSON.stringify(S.fleet)`);
  run(`raidSeizeHull();`);
  assert.equal(run(`JSON.stringify(S.fleet)`), fleetBefore, "no ship should be added if the target isn't seizable");
});

test("raidSeizeHull adds a warship class-matched to the hostile's SHIP_CLASSES tag", () => {
  const { run } = createSandbox();
  setupEngagement(run, { cls: "cruiser" });
  run(`raidSeizeHull();`);
  assert.equal(run(`S.fleet.length`), 1);
  assert.equal(run(`S.fleet[0].key`), "cruiser");
  assert.equal(run(`FLEET_SHIPS[S.fleet[0].key].role`), "warship");
  assert.equal(run(`S.fleet[0].status`), "idle");
  assert.equal(run(`S.fleet[0].home`), run(`S.location`));
});

test("raidSeizeHull clamps scout and dreadnought hostiles to the nearest hull FLEET_SHIPS stocks", () => {
  const { run } = createSandbox();
  setupEngagement(run, { cls: "scout" });
  run(`raidSeizeHull();`);
  assert.equal(run(`S.fleet[0].key`), "corvette", "no scout-class warship exists in FLEET_SHIPS — clamps up to corvette");

  setupEngagement(run, { cls: "dreadnought" });
  run(`raidSeizeHull();`);
  assert.equal(run(`S.fleet[0].key`), "battleship", "no dreadnought-class warship exists in FLEET_SHIPS — clamps down to battleship");
});

test("raidSeizeHull's prize arrives battle-damaged, between 25% and 50% of its new hull max", () => {
  const { run } = createSandbox();
  setupEngagement(run, { cls: "corvette", hp: 100, maxhp: 1000 });   // 10% remaining hp -> clamped to the 25% floor
  run(`raidSeizeHull();`);
  const hullMax = run(`S.fleet[0].hullMax`), hull = run(`S.fleet[0].hull`);
  const pct = hull / hullMax;
  assert.ok(pct >= 0.25 - 1e-6 && pct <= 0.5 + 1e-6, `expected hull between 25%-50% of hullMax, got ${Math.round(pct * 100)}%`);
  assert.ok(hull >= 1, "hull should never be seized at 0");
});

test("raidSeizeHull ends the engagement and clears S.prey when there's no pack", () => {
  const { run } = createSandbox();
  setupEngagement(run, {});
  run(`raidSeizeHull();`);
  assert.equal(run(`S.prey`), null, "with no consorts left, seizing should end the engagement");
});

test("raidSeizeHull promotes a surviving pack member instead of ending the fight", () => {
  const { run } = createSandbox();
  setupEngagement(run, {});
  run(`S.prey.pack = [${JSON.stringify(foe({ name: "Survivor", hp: 1000, maxhp: 1000 }))}]; S.prey._others = [];`);
  run(`raidSeizeHull();`);
  assert.ok(run(`!!S.prey`), "the engagement should continue with the promoted survivor");
  assert.equal(run(`S.prey.name`), "Survivor");
});

test("seizing a pirate hull gives no bounty, but costs the band's standing and a little Dread", () => {
  const { run } = createSandbox();
  setupEngagement(run, { isPirate: true, bounty: 5000, bandId: "b1" });
  run(`S.pirateBands = { b1: { id: "b1", name: "Test Band", status: "active", rep: 40 } };`);
  const creditsBefore = run(`S.res.credits`), dreadBefore = run(`S.pirate.dread`);
  run(`raidSeizeHull();`);
  assert.equal(run(`S.res.credits`), creditsBefore, "no bounty credited — the hull itself is the prize, not a payout");
  assert.equal(run(`S.pirate.dread`), dreadBefore + 2, "a modest Dread bump, less than a confirmed kill's +3");
  assert.equal(run(`S.pirate.wanted`), 0, "seizing a pirate hull is still a lawful act — no Wanted");
  assert.equal(run(`S.pirateBands.b1.rep`), 40 - 15, "the band resents losing a ship even without blood spilled");
});

test("seizing a planetary picket loots its hold and costs Wanted, but less than a merchant seizure", () => {
  const { run } = createSandbox();
  setupEngagement(run, { isPlanetPatrol: true, faction: "core", wantedGain: 12, cargo: { fuel: 3 }, credits: 200 });
  const wantedBefore = run(`S.pirate.wanted`), dreadBefore = run(`S.pirate.dread`), fuelBefore = run(`S.res.fuel`);
  run(`raidSeizeHull();`);
  assert.equal(run(`S.pirate.wanted`), wantedBefore + 12, "the same wantedGain a non-No-Quarter kill would add");
  assert.equal(run(`S.pirate.dread`), dreadBefore + 2);
  assert.ok(run(`S.res.fuel`) > fuelBefore, "cargo should still be plundered from a boarded hull");
});

test("seizing generic coalition shipping loots it, costs Wanted/Dread/rep, and respects an active commission", () => {
  const { run } = createSandbox();
  setupEngagement(run, { faction: "core", wantedGain: 5, cargo: { fuel: 2 }, credits: 300 });
  run(`S.commission = { patron: "frontier", target: "core", expires: 999, quota: 5, done: 0, bounty: 800, reward: 4000 };`);
  const creditsBefore = run(`S.res.credits`), doneBefore = run(`S.commission.done`);
  run(`raidSeizeHull();`);
  assert.equal(run(`S.pirate.wanted`), 0, "a sanctioned seizure waives the Wanted a normal raid would earn");
  assert.equal(run(`S.commission.done`), doneBefore + 1, "the seizure should still count toward the commission's quota");
  assert.ok(run(`S.res.credits`) > creditsBefore, "the commission bounty and plundered credits should still be paid out");
});

test("preyCombatCard renders a Seize hull button only once the target is seizable", () => {
  const { run } = createSandbox();
  setupEngagement(run, { engines: 2, hp: 250, maxhp: 1000 });
  let html = run(`preyCombatCard(S.prey, actionsLeft())`);
  assert.doesNotMatch(html, /raidSeizeHull/, "an unpinned target only moderately hurt shouldn't offer a Seize button");

  setupEngagement(run, { engines: 2, hp: 100, maxhp: 1000 });
  html = run(`preyCombatCard(S.prey, actionsLeft())`);
  assert.match(html, /onclick="raidSeizeHull\(\)"/, "an unpinned but critically wrecked (10% hp) target should offer a Seize button");

  setupEngagement(run, {});
  html = run(`preyCombatCard(S.prey, actionsLeft())`);
  assert.match(html, /onclick="raidSeizeHull\(\)"/, "a pinned, crippled target should offer a Seize button");
});

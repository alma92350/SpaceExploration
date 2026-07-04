"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function lawlessWorlds(run) { return run(`PLANETS.filter(p => canHaven(p) && !p.colonizable).map(p => p.id)`); }
function unlawfulWorld(run) { return run(`PLANETS.find(p => !canHaven(p) && !p.colonizable).id`); }

test("relocateHaven refuses when the player has no haven at all", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  const [a] = lawlessWorlds(run);
  run(`S.location = "${a}";`);
  run(`relocateHaven();`);
  assert.equal(run(`S.haven`), null);
});

test("relocateHaven refuses when already standing at the haven's own world", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.res.credits = 1000000;`);
  const [a] = lawlessWorlds(run);
  run(`S.location = "${a}"; S.haven = { planet: "${a}", tier: 1, stash: {} };`);
  run(`relocateHaven();`);
  assert.equal(run(`S.haven.planet`), a, "the haven shouldn't move — the player never left it");
});

test("relocateHaven refuses at a world that isn't lawless enough", () => {
  const { run } = createSandbox();
  run(`S = freshState(); S.res.credits = 1000000;`);
  const [a] = lawlessWorlds(run);
  const civilized = unlawfulWorld(run);
  run(`S.haven = { planet: "${a}", tier: 1, stash: {} }; S.location = "${civilized}";`);
  run(`relocateHaven();`);
  assert.equal(run(`S.haven.planet`), a, "too exposed a world should refuse the relocation");
});

test("relocateHaven refuses without enough credits, leaving the haven and credits untouched", () => {
  const { run } = createSandbox();
  const [a, b] = lawlessWorlds(run);
  run(`S = freshState(); S.res.credits = 1;`);
  run(`S.haven = { planet: "${a}", tier: 1, stash: { metals: 40 } }; S.location = "${b}";`);
  run(`relocateHaven();`);
  assert.equal(run(`S.haven.planet`), a, "can't afford it — the haven stays put");
  assert.equal(run(`S.res.credits`), 1, "the refused relocation shouldn't touch credits");
});

test("relocateHaven moves the haven, deducts the cost, and preserves tier + stash", () => {
  const { run } = createSandbox();
  const [a, b] = lawlessWorlds(run);
  run(`S = freshState(); rollPrices(); S.res.credits = 1000000;`);
  run(`S.haven = { planet: "${a}", tier: 2, stash: { metals: 40, electronics: 5 } }; S.location = "${b}";`);
  const cost = run(`havenRelocateCost()`);
  run(`relocateHaven();`);
  assert.equal(run(`S.haven.planet`), b, "the haven should now be at the new world");
  assert.equal(run(`S.haven.tier`), 2, "tier should carry over unchanged");
  assert.equal(run(`S.haven.stash.metals`), 40, "the stash should carry over unchanged");
  assert.equal(run(`S.haven.stash.electronics`), 5);
  assert.equal(run(`S.res.credits`), 1000000 - cost, "the relocation fee should be deducted");
});

test("havenRelocateCost scales with the haven's tier", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  run(`S.haven = { planet: S.location, tier: 1, stash: {} };`);
  const t1 = run(`havenRelocateCost()`);
  run(`S.haven.tier = 3;`);
  const t3 = run(`havenRelocateCost()`);
  assert.equal(t3, t1 * 3, "cost should scale linearly with tier");
});

"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("a Sector Code round-trips back to the same seed", () => {
  const { run } = createSandbox();
  for (const seed of [42, 12345, 999999, 2147483647, 1]) {
    const code = run(`seedCodeFor(${seed})`);
    const back = run(`seedFromCode(${JSON.stringify(code)})`);
    assert.equal(back, seed, `seed ${seed} -> code ${code} -> ${back}`);
  }
});

test("seedFromCode rejects garbage input instead of throwing", () => {
  const { run } = createSandbox();
  assert.equal(run(`seedFromCode(null)`), null);
  assert.equal(run(`seedFromCode("")`), null);
  assert.equal(run(`seedFromCode("!!!")`), null);
});

test("deriveLaneSeed and deriveCoreSeed are deterministic functions of the frontier seed", () => {
  const { run } = createSandbox();
  const lane1 = run("deriveLaneSeed(12345)");
  const lane2 = run("deriveLaneSeed(12345)");
  const core1 = run("deriveCoreSeed(12345)");
  const core2 = run("deriveCoreSeed(12345)");
  assert.equal(lane1, lane2, "the same frontier seed must derive the same lane seed every time");
  assert.equal(core1, core2, "the same frontier seed must derive the same core-variance seed every time");
  assert.notEqual(lane1, core1, "lane and core seeds should be derived independently, not identical");
});

test("two games started from the same Sector Code produce the same frontier ring", () => {
  const a = createSandbox();
  const b = createSandbox();
  a.run("S = freshState({ seed: 777777 }); generateFrontierRing();");
  b.run("S = freshState({ seed: 777777 }); generateFrontierRing();");
  const namesA = a.run("PLANETS.filter(p => p.frontier).map(p => p.name).join(',')");
  const namesB = b.run("PLANETS.filter(p => p.frontier).map(p => p.name).join(',')");
  assert.equal(namesA, namesB, "same seed should reproduce the identical frontier ring");
  assert.ok(namesA.length > 0, "expected the frontier ring to actually generate some worlds");
});

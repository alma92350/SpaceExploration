"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("freshState defaults to a standard, non-Ironman run", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  assert.equal(run("S.turn"), 1);
  assert.equal(run("S.res.credits"), 3000);
  assert.equal(run("S.ironman"), false);
  assert.equal(run("S.lengthMult"), 1);
});

test("freshState carries Ironman and length-multiplier options through", () => {
  const { run } = createSandbox();
  run("S = freshState({ ironman: true, lengthMult: 0.6 });");
  assert.equal(run("S.ironman"), true);
  assert.equal(run("S.lengthMult"), 0.6);
});

test("winProgress scales the net-worth and colony-population legacy goals by lengthMult", () => {
  const { run } = createSandbox();

  run("S = freshState({ lengthMult: 1 });");
  assert.match(run("winProgress().worth.label"), /75,000/);
  assert.match(run("winProgress().colony.label"), /25k/);

  run("S = freshState({ lengthMult: 0.6 });");
  assert.match(run("winProgress().worth.label"), /45,000/);
  assert.match(run("winProgress().colony.label"), /15k/);

  run("S = freshState({ lengthMult: 1.6 });");
  assert.match(run("winProgress().worth.label"), /120,000/);
  assert.match(run("winProgress().colony.label"), /40k/);
});

test("winProgress does NOT scale the fixed, non-numeric legacy goals", () => {
  const { run } = createSandbox();
  run("S = freshState({ lengthMult: 1.6 });");
  const wp = run("JSON.stringify({t: winProgress().terraform.label, g: winProgress().governor.label})");
  const { t, g } = JSON.parse(wp);
  assert.equal(t, "Research Terraforming");
  assert.equal(g, "Become Sector Governor");
});

test("colonyStart and politicsStart grant their expected starting kits", () => {
  const { run } = createSandbox();
  run("S = freshState({ colonyStart: true });");
  assert.ok(run("S.res.credits") > 0, "colony start should grant starting capital");

  run("S = freshState({ politicsStart: true });");
  assert.equal(run("S.office"), 1, "politics start should begin as a Councillor");
  assert.ok(run("S.orgs.party"), "politics start should found a starting party");
});

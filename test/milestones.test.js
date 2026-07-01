"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("a fresh game has earned no milestones yet", () => {
  const { run } = createSandbox();
  run("S = freshState(); checkMilestones(true);");
  assert.equal(run("Object.keys(S.milestones || {}).length"), 0);
});

test("checkMilestones marks a milestone earned once its condition is met", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  run("S.stats.trades = 1;");
  run("checkMilestones(true);");
  assert.ok(run("!!S.milestones.firsttrade"), "First Trade should be earned once a trade has happened");
});

test("an earned milestone is never un-earned, even if the stat regresses", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  run(`S.res.credits = 20000; S.stats.jumps = 1; S.stats.trades = 1; checkMilestones(true);`);
  assert.ok(run("!!S.milestones.smallfortune"), "expected Small Fortune (net worth >= 10000) to be earned");
  run(`S.res.credits = 0; checkMilestones(true);`);
  assert.ok(run("!!S.milestones.smallfortune"), "earning a milestone should be permanent even if net worth drops back down");
});

test("checkMilestones(true) is silent: it never writes to the ship log", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.stats.trades = 1;");
  const logLengthBefore = run("S.log.length");
  run("checkMilestones(true);");
  const logLengthAfter = run("S.log.length");
  assert.equal(logLengthAfter, logLengthBefore, "silent milestone checks (used for veteran-save backfill) must not spam the log");
});

test("checkMilestones() without silent announces newly-earned milestones in the log", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.stats.trades = 1;");
  run("checkMilestones();");
  assert.ok(run("S.log.some(l => l.msg.includes('First Trade'))"), "a loudly-checked new milestone should be logged");
});

test("every milestone id is unique", () => {
  const { run } = createSandbox();
  const ids = run("MILESTONES.map(m => m.id)");
  assert.equal(new Set(ids).size, ids.length, "duplicate milestone ids found");
});

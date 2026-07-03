"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* The Survey Expedition — the single, multi-cycle exploration lever that
   replaced the old instant-roll pair (Deep-Space Survey / Probe the Frontier).
   Launch costs an action + fuel; the trip takes real cycles (longer into the
   deep frontier, shorter with a Research Lab); completion ALWAYS charts the
   target — the risk lives in en-route ambushes now, not in a die roll. */

function setup(run) {
  run(`S = freshState(); generateFrontierRing(); rollPrices(); S.techs.colonial = true; S.res.fuel = 500;`);
}

test("launchExpedition refuses without the Colonial Charter", () => {
  const { run } = createSandbox();
  run(`S = freshState(); generateFrontierRing(); rollPrices(); S.res.fuel = 500;`);
  run(`launchExpedition();`);
  assert.equal(run(`S.expedition`), null);
  assert.equal(run(`S.res.fuel`), 500, "no fuel should be spent on a refused launch");
});

test("launchExpedition targets the nearest uncharted signature and pays action + fuel", () => {
  const { run } = createSandbox();
  setup(run);
  const nearest = run(`undiscoveredHidden()[0].id`);
  const actionsBefore = run(`actionsLeft()`);
  run(`launchExpedition();`);
  assert.equal(run(`S.expedition.target`), nearest);
  assert.equal(run(`S.res.fuel`), 500 - run(`EXPEDITION_FUEL_COST`));
  assert.equal(run(`actionsLeft()`), actionsBefore - 1, "outfitting the expedition costs an action");
  assert.ok(run(`S.expedition.cyclesLeft`) >= 2, "the trip must take multiple cycles");
});

test("a second launch is refused while an expedition is already out", () => {
  const { run } = createSandbox();
  setup(run);
  run(`launchExpedition();`);
  const fuelAfterFirst = run(`S.res.fuel`), firstTarget = run(`S.expedition.target`);
  run(`launchExpedition();`);
  assert.equal(run(`S.expedition.target`), firstTarget, "the running expedition must not be replaced");
  assert.equal(run(`S.res.fuel`), fuelAfterFirst, "no double fuel spend");
});

test("processExpedition ticks down and always charts the target on completion", () => {
  const { run } = createSandbox();
  setup(run);
  run(`launchExpedition();`);
  const target = run(`S.expedition.target`);
  run(`Math.random = () => 0.99;`);   // no en-route ambush — isolate the timing behavior
  const cycles = run(`S.expedition.cyclesLeft`);
  for (let i = 0; i < cycles - 1; i++) {
    run(`processExpedition();`);
    assert.equal(run(`S.discovered["${target}"] || false`), false, `still en route after tick ${i + 1}`);
  }
  run(`processExpedition();`);
  assert.equal(run(`S.discovered["${target}"]`), true, "a completed expedition always charts its world — no die roll");
  assert.equal(run(`S.expedition`), null, "the expedition stands down after returning");
});

test("a deep-frontier target takes longer than a charted-sector hidden world", () => {
  const { run } = createSandbox();
  setup(run);
  const legacyCycles = run(`expeditionCycles(PLANETS.find(p => p.hidden && !p.frontier))`);
  const frontierCycles = run(`expeditionCycles(PLANETS.find(p => p.frontier))`);
  assert.equal(frontierCycles - legacyCycles, run(`EXPEDITION_FRONTIER_EXTRA`), "the deep frontier is farther out");
});

test("a Research Lab shortens the trip, floored at 2 cycles", () => {
  const { run } = createSandbox();
  setup(run);
  const base = run(`expeditionCycles(PLANETS.find(p => p.frontier))`);
  run(`S.upgrades.lab = 3;`);
  const withLab = run(`expeditionCycles(PLANETS.find(p => p.frontier))`);
  assert.ok(withLab < base, "better sensors should shorten the journey");
  run(`S.upgrades.lab = 30;`);
  assert.equal(run(`expeditionCycles(PLANETS.find(p => !p.frontier && p.hidden))`), 2, "no expedition resolves in under 2 cycles");
});

test("an en-route ambush interrupts the captain but the expedition presses on", () => {
  const { run } = createSandbox();
  setup(run);
  run(`launchExpedition();`);
  const cyclesBefore = run(`S.expedition.cyclesLeft`);
  run(`Math.random = () => 0.0;`);   // force the ambush branch
  run(`processExpedition();`);
  assert.notEqual(run(`S.encounter`), null, "survey activity in lawless space should be able to draw raiders");
  assert.equal(run(`S.expedition.cyclesLeft`), cyclesBefore - 1, "the expedition itself keeps moving through the ambush");
});

test("an expedition stands down gracefully if its target gets charted some other way", () => {
  const { run } = createSandbox();
  setup(run);
  run(`launchExpedition();`);
  run(`S.discovered[S.expedition.target] = true;`);   // e.g. a signal investigation found it first
  run(`processExpedition();`);
  assert.equal(run(`S.expedition`), null, "no ghost expedition against an already-charted world");
});

test("the old one-click explore()/probeFrontier() levers are gone", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run(`typeof explore`), "undefined", "explore() should be fully replaced by launchExpedition()");
  assert.equal(run(`typeof probeFrontier`), "undefined", "probeFrontier() should be fully replaced by launchExpedition()");
});

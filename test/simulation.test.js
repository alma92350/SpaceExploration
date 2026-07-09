"use strict";
/* A seeded, long-horizon smoke test. endTurn() chains ~35 process*() phases
   and nothing else exercises them together, cycle after cycle, with player
   actions mixed in. This drives a full game loop for 120 cycles with the
   sandbox's Math.random swapped for the game's own mulberry32 (inside the vm
   only), so a failure reproduces exactly. It asserts the run keeps moving and
   that core invariants hold after every cycle: no NaN/negative resources, no
   non-positive prices, the turn counter advances. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("a seeded 120-cycle run of random actions keeps every core invariant intact", () => {
  const { run } = createSandbox();
  const report = run(`
    Math.random = mulberry32(20260707);   // deterministic: same seed, same run
    S = freshState();
    generateFrontierRing();
    rollPrices();
    (() => {
      const pick = arr => arr[Math.floor(Math.random() * arr.length)];
      const problems = [];
      const check = () => {
        const bad = [];
        ["credits", "fuel", "tech", "influence"].forEach(k => { if (!Number.isFinite(S.res[k])) bad.push(k + "=" + S.res[k]); });
        if (S.res.fuel < 0) bad.push("fuel<0");
        CARGO_IDS.forEach(c => { const v = S.res[c]; if (!Number.isFinite(v) || v < 0) bad.push(c + "=" + v); });
        activePlanets().forEach(p => COM_IDS.forEach(c => {
          const v = S.prices[p.id] && S.prices[p.id][c];
          if (!Number.isFinite(v) || v <= 0) bad.push("price." + p.id + "." + c + "=" + v);
        }));
        if (!Number.isFinite(S.pirate.hull)) bad.push("hull=" + S.pirate.hull);
        if (bad.length) problems.push("cycle " + S.turn + ": " + bad.join(", "));
      };
      let guard = 0;
      while (S.turn < 120 && guard++ < 800 && !problems.length) {
        // resolve anything that locks the cycle before acting
        if (S.encounter) { encounterFlee(); if (S.encounter) encounterPay(); if (S.encounter) S.encounter = null; }
        if (S.interdiction) { navySurrender(); if (S.interdiction) S.interdiction = null; }
        if (S.prey) raidDisengage();
        const acts = Math.floor(Math.random() * 3);
        for (let a = 0; a < acts && !inCombat(); a++) {
          const roll = Math.random();
          if (roll < 0.35) { const dep = Object.keys(currentPlanet().deposits || {}); if (dep.length) extract(pick(dep)); }
          else if (roll < 0.55) buy(pick(CARGO_IDS), 1 + Math.floor(Math.random() * 5));
          else if (roll < 0.75) { const held = CARGO_IDS.filter(c => S.res[c] > 0); if (held.length) sell(pick(held), 1); }
          else { const opts = activePlanets().filter(p => p.id !== S.location && isVisible(p)); if (opts.length) travel(pick(opts).id); }
        }
        const before = S.turn;
        endTurn();
        if (S.turn === before && !inCombat()) { problems.push("cycle stuck at " + S.turn); break; }
        check();
      }
      if (S.turn < 120 && !problems.length) problems.push("run stalled at cycle " + S.turn + " after " + guard + " iterations");
      return problems.join(" | ");
    })();
  `);
  assert.equal(report, "", report);
});

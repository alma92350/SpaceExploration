"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

/* Bloodying a coalition's shipping is a real, Wanted-earning risk that faction's own
   rivals notice and reward — even with no letter of marque naming that specific target.
   raidWinMerchant (raiding.js) already hits the victim's own rep and (if unsanctioned)
   core's, and always nudges frontier; this adds a flat rep bump to every faction that
   FACTION_RIVAL/factionsAreRivals (sector4x.js) considers a rival of the victim. */

function makePrey(run, faction, overrides) {
  run(`S.prey = Object.assign({ type: "hauler", name: "Test Hauler", ico: "🛻", faction: ${JSON.stringify(faction)}, cargo: {},
    credits: 0, wantedGain: 5, bounty: 0, isPirate: false, hp: 10, maxhp: 10, pack: [], _others: [] }, ${JSON.stringify(overrides || {})});`);
}
function zeroRep(run) { run(`S.rep = { core: 0, miners: 0, agri: 0, syndicate: 0, frontier: 0 };`); }

test("raiding a faction's shipping grants rep to every faction that considers it a rival", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  zeroRep(run);
  makePrey(run, "core");
  run(`raidWinMerchant(S.prey, false);`);
  // core's own static rival is frontier, but syndicate's static rival is core too (a one-way
  // entry) -- factionsAreRivals checks both directions, so raiding core should reward both.
  assert.equal(run(`S.rep.syndicate`), 2, "syndicate considers core a rival (one-way FACTION_RIVAL entry)");
  assert.equal(run(`S.rep.frontier`), 5, "frontier considers core a rival (+2) on top of the unconditional outlaw-sympathy +3");
  assert.equal(run(`S.rep.miners`), 0, "unrelated factions should be untouched");
  assert.equal(run(`S.rep.agri`), 0, "unrelated factions should be untouched");
});

test("raiding a faction with a single static rival rewards only that rival", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  zeroRep(run);
  makePrey(run, "miners");
  run(`raidWinMerchant(S.prey, false);`);
  assert.equal(run(`S.rep.agri`), 2, "agri is miners' static rival");
  assert.equal(run(`S.rep.syndicate`), 0);
  assert.equal(run(`S.rep.core`), -5, "unsanctioned raiding still docks core rep as before");
});

test("the rival-rep bonus applies with no letter of marque at all", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  zeroRep(run);
  assert.equal(run(`S.commission`), null, "no commission held");
  makePrey(run, "agri");
  run(`raidWinMerchant(S.prey, false);`);
  assert.equal(run(`S.rep.miners`), 2, "agri's rival gains rep purely from the risk taken, no marque needed");
});

test("the rival-rep bonus stacks with an active matching commission's own patron reward", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  zeroRep(run);
  // frontier's commission against core: the patron (frontier) IS core's rival, so both
  // applyCommissionRaid's own +2-to-patron and the new rival-rep +2 should land on frontier.
  run(`S.commission = { patron: "frontier", target: "core", expires: 999, quota: 5, done: 0, bounty: 800, reward: 4000 };`);
  makePrey(run, "core");
  run(`raidWinMerchant(S.prey, false);`);
  assert.equal(run(`S.rep.frontier`), 2 + 2 + 3, "commission patron reward (+2) + rival-rep bonus (+2) + unconditional outlaw sympathy (+3)");
  assert.equal(run(`S.commission.done`), 1, "the raid should still count toward the commission's quota");
});

test("a faction-less (independent) target grants no rival-rep bonus and doesn't crash", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  zeroRep(run);
  makePrey(run, null);
  run(`raidWinMerchant(S.prey, false);`);
  assert.equal(run(`S.rep.core`), -5, "still docks core rep for an unsanctioned raid, as before");
  assert.equal(run(`S.rep.miners`), 0);
  assert.equal(run(`S.rep.agri`), 0);
  assert.equal(run(`S.rep.syndicate`), 0);
});

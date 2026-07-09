"use strict";
/* Model Arena (docs/MODEL_EVAL.md, phase 1) — coverage for everything the
   runner (tools/modelArena.mjs) drives that doesn't need a network: the
   deterministic reply checkers, the scenario builder (which loads the real
   game through this suite's own sandbox), and the result aggregation. The
   runner itself is only an I/O shell around these and stays untested here,
   same stance as pirateChat.js's streaming path. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");
const checks = require("../tools/arenaChecks.js");
const { buildScenarios, BAND_SPECS } = require("../tools/arenaScenarios.js");
const { summarizeCalls, renderLeaderboard, median } = require("../tools/arenaReport.js");

/* ---- checkers ---- */

test("extractNumbers normalizes thousands separators and reads figures out of prose", () => {
  assert.deepEqual(checks.extractNumbers("I'll take 1,200 cr — not 800, and that's 15% off"), [1200, 800, 15]);
  assert.deepEqual(checks.extractNumbers("standing 34/100"), [34, 100]);
  assert.deepEqual(checks.extractNumbers("250000cr"), [250000]);
  assert.deepEqual(checks.extractNumbers("no figures here"), []);
});

test("ungroundedNumbers flags invented figures but ignores small natural-speech counts", () => {
  assert.deepEqual(checks.ungroundedNumbers("give me 2 cycles and 5000 credits", [1500]), [5000]);
  assert.deepEqual(checks.ungroundedNumbers("that's 1,500 credits", [1500]), []);
});

test("findBannedPhrase catches meta-speak but never the in-game 'AI cores' cargo", () => {
  assert.ok(checks.findBannedPhrase("As an AI language model I cannot say"));
  assert.ok(checks.findBannedPhrase("my system prompt forbids that"));
  assert.equal(checks.findBannedPhrase("A crate of AI cores would buy your safety, captain."), null);
  assert.equal(checks.findBannedPhrase("Hallmark of a coward, running like that."), null, "bare 'llm' needs a word boundary");
  assert.ok(checks.findBannedPhrase("this is just an llm talking"));
});

test("findRefusalPhrase catches assistant refusals but not in-character ones", () => {
  assert.ok(checks.findRefusalPhrase("I can't help with that request."));
  assert.equal(checks.findRefusalPhrase("I can't let you board us for that price."), null);
});

test("hasRepetitionLoop spots degenerate loops but allows pirate emphasis", () => {
  assert.equal(checks.hasRepetitionLoop("No, no, no — not for that price."), false);
  assert.equal(checks.hasRepetitionLoop("pay pay pay pay pay pay pay up"), true);
  assert.equal(checks.hasRepetitionLoop("give me the credits now " .repeat(4)), true, "a 4-gram repeated 3+ times running is a loop");
  assert.equal(checks.hasRepetitionLoop("A fine offer. A fine ship. A fine day to sail."), false);
});

test("arena stripThinkTags stays byte-identical with pirateChat.js's own", () => {
  const { run } = createSandbox();
  ["<think>plan</think>Aye, captain.", "Aye <think>dangling to the end", "plain prose, no tags", ""]
    .forEach(input => {
      assert.equal(checks.stripThinkTags(input), run(`stripThinkTags(${JSON.stringify(input)})`),
        `arena copy must match the game's for: ${JSON.stringify(input)}`);
    });
});

test("checkBanterReply passes a short grounded in-character line and fails each defect distinctly", () => {
  const scen = { allowedNumbers: [1500, 25, 34, 100], mustQuote: 1500 };
  const good = checks.checkBanterReply("Har! 1,500 credits and me guns are yours, captain.", scen);
  assert.equal(good.pass, true, `unexpected failures: ${good.failures}`);
  assert.equal(checks.checkBanterReply("As an AI language model, hiring costs 1500 credits.", scen).checks.inCharacter, false);
  assert.equal(checks.checkBanterReply("For you? A mere 5000 credits.", scen).checks.grounded, false);
  assert.equal(checks.checkBanterReply("Cheap enough for a friend, captain.", scen).checks.quotesFee, false, "an unquoted fee is a guess, not an answer");
  assert.equal(checks.checkBanterReply("x".repeat(700), { allowedNumbers: [] }).checks.brief, false);
  const leak = checks.checkBanterReply("<think>they want the fee</think>1500 cr, take it.", scen);
  assert.equal(leak.checks.noThinkLeak, false, "an inlined <think> block is a leak even though scoring strips it");
  assert.equal(leak.stripped, "1500 cr, take it.");
  assert.equal(checks.checkBanterReply("", scen).checks.nonEmpty, false);
});

test("checkNegotiationReply enforces each status's figure contract", () => {
  const accept = { offer: 2000, decision: { status: "accept", amount: 2000 } };
  assert.equal(checks.checkNegotiationReply("Done — 2,000 credits and we ride with ye.", accept).pass, true);
  assert.equal(checks.checkNegotiationReply("Done, a fair price, captain.", accept).checks.namesAmount, false);

  const counter = { offer: 1500, decision: { status: "counter", amount: 2200 } };
  const goodCounter = checks.checkNegotiationReply("Make it 2200 credits and ye have a deal.", counter);
  assert.equal(goodCounter.pass, true, `unexpected failures: ${goodCounter.failures}`);
  const echo = checks.checkNegotiationReply("1500? Fine, 1500 credits it is.", counter);
  assert.equal(echo.checks.noOfferEcho, false, "echoing the player's offer as if accepted is THE classic failure");
  assert.equal(echo.checks.noStrayFigures, false);
  assert.equal(echo.checks.namesAmount, false);
  const stray = checks.checkNegotiationReply("2200 credits — that's 40% more than your insult.", counter);
  assert.equal(stray.checks.noStrayFigures, false, "40 is a figure the prompt never asked it to name");
  assert.equal(stray.checks.namesAmount, true);

  const reject = { offer: 900, decision: { status: "reject", amount: null } };
  assert.equal(checks.checkNegotiationReply("Keep yer credits, captain. Not interested.", reject).pass, true);
  assert.equal(checks.checkNegotiationReply("Not for 900, not for 9000.", reject).checks.noFigures, false);
});

/* ---- scenario builder ---- */

test("buildScenarios covers every personality, all three decision statuses, and only real game prompts", () => {
  const scen = buildScenarios();
  assert.equal(scen.bands.length, BAND_SPECS.length);
  const perses = new Set(scen.bands.map(b => b.pers));
  ["greedy", "loyal", "bold", "cunning", "honorable"].forEach(p => assert.ok(perses.has(p), `personality ${p} must be covered`));

  // 4 probes on every band + the feud probe on exactly the one feuding band
  assert.equal(scen.banter.length, BAND_SPECS.length * 4 + 1);
  const rivalProbes = scen.banter.filter(s => s.probeKey === "rival");
  assert.equal(rivalProbes.length, 1);
  assert.equal(rivalProbes[0].band.key, "cunning-wary");
  assert.ok(rivalProbes[0].userText.includes(rivalProbes[0].band.rival), "the feud probe must name the actual rival band");
  assert.ok(rivalProbes[0].messages[0].content.includes(rivalProbes[0].band.rival), "the shipped persona prompt itself must carry the feud line");

  assert.equal(scen.negotiation.length, BAND_SPECS.length * 3);
  scen.bands.forEach(b => {
    const statuses = scen.negotiation.filter(s => s.band.key === b.key).map(s => s.decision.status).sort();
    assert.deepEqual(statuses, ["accept", "counter", "reject"], `band ${b.key} must pin all three outcomes`);
  });

  scen.banter.concat(scen.negotiation).forEach(s => {
    assert.equal(s.messages.length, 2, `${s.id}: system + user, nothing else (empty history)`);
    assert.equal(s.messages[0].role, "system");
    assert.equal(s.messages[1].role, "user");
    assert.ok(s.messages[0].content.includes(s.band.name), `${s.id}: persona must name the band`);
    assert.equal(s.messages[1].content, s.userText);
  });
});

test("banter scenarios ground their number checks in the actual prompt text", () => {
  const scen = buildScenarios();
  scen.banter.forEach(s => {
    assert.ok(s.allowedNumbers.includes(s.band.fee), `${s.id}: the hire fee is in the persona prompt, so it must be an allowed number`);
    if (s.probeKey === "hire") assert.equal(s.mustQuote, s.band.fee);
    else assert.equal(s.mustQuote, null);
  });
  const bribe = scen.banter.find(s => s.probeKey === "bribe" && s.band.key === "bold-neutral");
  assert.ok(bribe.allowedNumbers.includes(250000), "the bribe figure comes from the user line and must be fair game to echo");
});

test("negotiation scenarios carry decisions consistent with the game's own bounds", () => {
  const scen = buildScenarios();
  scen.negotiation.forEach(s => {
    const lo = Math.round(s.band.fee * 0.4), hi = Math.round(s.band.fee * 1.5);   // bandNegotiationBounds on the base fee
    assert.ok(s.offer >= lo && s.offer <= hi, `${s.id}: offer ${s.offer} must sit inside [${lo}, ${hi}]`);
    if (s.decision.status === "accept") assert.equal(s.decision.amount, s.offer, `${s.id}: an accept is at exactly the offer`);
    if (s.decision.status === "counter") {
      assert.ok(s.decision.amount >= lo && s.decision.amount <= hi, `${s.id}: counter ${s.decision.amount} must sit inside [${lo}, ${hi}]`);
      assert.notEqual(s.decision.amount, s.offer, `${s.id}: a counter at the offer would make noOfferEcho meaningless`);
    }
    if (s.decision.status === "reject") assert.equal(s.decision.amount, null);
    assert.ok(s.messages[0].content.includes(`${s.offer} credits`), `${s.id}: the narration prompt states the offer`);
    if (s.decision.amount != null) assert.ok(s.messages[0].content.includes(`${s.decision.amount} credits`), `${s.id}: the narration prompt states the decided figure`);
  });
});

test("buildScenarios is deterministic — two independent builds are byte-identical", () => {
  // nothing random may leak into a scenario (newBand's ids/locations/feud
  // rolls are all overwritten or unexposed), or run-to-run scores would
  // stop being comparable
  assert.equal(JSON.stringify(buildScenarios()), JSON.stringify(buildScenarios()));
});

/* ---- aggregation + leaderboard ---- */

test("median handles odd, even and empty inputs", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
});

test("summarizeCalls folds calls into per-model rates and sorts the best model first", () => {
  const calls = [
    { model: "good", battery: "banter", pass: true, checks: { brief: true, grounded: true }, ttftMs: 100, tokPerSec: 40 },
    { model: "good", battery: "banter", pass: false, checks: { brief: true, grounded: false }, ttftMs: 200, tokPerSec: 50 },
    { model: "good", battery: "negotiation", pass: true, checks: { namesAmount: true }, ttftMs: 300, tokPerSec: 60 },
    { model: "bad", battery: "banter", pass: false, checks: { brief: false, grounded: false }, ttftMs: 900, tokPerSec: 5 },
    { model: "bad", battery: "negotiation", error: "went quiet", pass: false, checks: {} },
  ];
  const summary = summarizeCalls(calls);
  assert.deepEqual(summary.map(m => m.model), ["good", "bad"], "higher combined pass rate must rank first");
  const good = summary[0];
  assert.equal(good.batteries.banter.rate, 0.5);
  assert.equal(good.batteries.negotiation.rate, 1);
  assert.equal(good.batteries.banter.checkRates.grounded.rate, 0.5);
  assert.equal(good.medianTtftMs, 200);
  assert.equal(good.errors, 0);
  const bad = summary[1];
  assert.equal(bad.errors, 1);
  assert.equal(bad.batteries.negotiation.rate, 0, "an errored call counts against the battery, not as a skip");
});

test("renderLeaderboard produces a readable table with per-check breakdowns and skip reasons", () => {
  const summary = summarizeCalls([
    { model: "m1", battery: "banter", pass: true, checks: { brief: true }, ttftMs: 120, tokPerSec: 33.3 },
  ]);
  const md = renderLeaderboard(summary, {
    date: "2026-07-09T12:00:00Z", endpoint: "http://localhost:11434", ollamaVersion: "0.9.9",
    think: false, samples: 5, scenarioCounts: { banter: 21, negotiation: 15 },
    skipped: [{ model: "ghost:1b", reason: "model not found" }],
  });
  assert.ok(md.includes("| m1 | 100% (1/1) |"), "main table row");
  assert.ok(md.includes("Banter — per-check pass rates"));
  assert.ok(md.includes("| brief |") || md.includes("| m1 | 100% |"), "per-check table");
  assert.ok(md.includes("**ghost:1b** — model not found"));
  assert.ok(md.includes("21 banter, 15 negotiation"));
});

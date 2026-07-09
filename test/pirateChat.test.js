"use strict";
/* Pirate chat (pirateChat.js) is a local-only Ollama integration: the sandbox
   stubs fetch as undefined, so these tests cover everything reachable without
   a real network call — persona/message building, history capping, stream-line
   parsing, HTML escaping, settings defaults, and the save-sanitizer's handling
   of chat transcripts (mirrors test/sanitize.test.js's log/journal coverage). */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("ensureOllamaSettings seeds sane defaults and setOllamaSetting persists trimmed values", () => {
  const { run } = createSandbox();
  run(`S = freshState();`);
  assert.equal(run("ensureOllamaSettings().endpoint"), "http://localhost:11434");
  assert.equal(run("ensureOllamaSettings().model"), "llama3.2:1b");
  run(`setOllamaSetting("model", "  llama3.2:3b  ")`);
  assert.equal(run("S.ollama.model"), "llama3.2:3b");
});

test("pushChatMessage records turn-stamped entries and caps history at CHAT_HISTORY_CAP", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(1); S.pirateBands[b.id] = b;
    globalThis.__band = b.id;
    for (let i = 0; i < CHAT_HISTORY_CAP + 10; i++) pushChatMessage(__band, i % 2 ? "pirate" : "you", "line " + i);
  `);
  const hist = JSON.parse(run("JSON.stringify(pirateChatHistory(__band))"));
  const cap = run("CHAT_HISTORY_CAP");
  assert.equal(hist.length, cap);
  assert.equal(hist[0].text, "line 10", "the oldest 10 lines beyond the cap must have been dropped");
  assert.equal(hist[hist.length - 1].text, "line " + (cap + 9));
  assert.equal(hist[0].who, "you", "who alternation (line 10, even -> i%2 falsy -> 'you') must be preserved through the trim");
});

test("buildOllamaMessages: role mapping and trimming, checked structurally", () => {
  const { run } = createSandbox();
  const msgs = JSON.parse(run(`
    S = freshState();
    const hist = [
      { who: "you", text: "old line 1" },
      { who: "pirate", text: "old reply 1" },
      { who: "you", text: "recent line" },
      { who: "pirate", text: "recent reply" },
    ];
    JSON.stringify(buildOllamaMessages("SYS", hist, "new question", 2));
  `));
  assert.deepEqual(msgs, [
    { role: "system", content: "SYS" },
    { role: "user", content: "recent line" },
    { role: "assistant", content: "recent reply" },
    { role: "user", content: "new question" },
  ]);
});

test("trimChatHistory keeps only the most recent `cap` entries, in order", () => {
  const { run } = createSandbox();
  const arr = JSON.parse(run(`JSON.stringify(trimChatHistory([1,2,3,4,5], 2))`));
  assert.deepEqual(arr, [4, 5]);
  const untouched = JSON.parse(run(`JSON.stringify(trimChatHistory([1,2], 5))`));
  assert.deepEqual(untouched, [1, 2]);
});

test("buildPirateSystemPrompt is deterministic, grounds tone in the band's real numbers, and never breaks character", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {};
    globalThis.__b = { id: "b1", name: "Crimson Wake", ico: "🏴", level: 3, rep: 55, pers: "greedy", status: "active" };
    S.pirateBands.b1 = __b;
  `);
  const p1 = run("buildPirateSystemPrompt(__b)");
  const p2 = run("buildPirateSystemPrompt(__b)");
  assert.equal(p1, p2, "must be a pure function of the band's state");
  assert.ok(p1.includes("Crimson Wake"), "persona must name the band");
  assert.ok(p1.includes(run("escortRecruitFee(__b)").toString()), "persona must quote the real hire fee");
  assert.ok(/never mention being an AI/i.test(p1), "must instruct the model to stay in character");
  assert.doesNotThrow(() => run(`
    [-100,-50,-10,0,41,76,100].forEach(r => { __b.rep = r; buildPirateSystemPrompt(__b); });
    ["greedy","loyal","bold","cunning","honorable","made-up"].forEach(p => { __b.pers = p; buildPirateSystemPrompt(__b); });
  `));
});

test("buildPirateSystemPrompt mentions an active blood feud by the rival's name", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {};
    const a = newBand(2), c = newBand(2);
    a.feudWith = c.id; c.feudWith = a.id;
    S.pirateBands[a.id] = a; S.pirateBands[c.id] = c;
    globalThis.__a = a; globalThis.__rivalName = c.name;
  `);
  const prompt = run("buildPirateSystemPrompt(__a)");
  assert.ok(prompt.includes(run("__rivalName")), "prompt should name the feuding rival");
});

test("parseOllamaStreamLine reads content/thinking deltas, surfaces a server error, and ignores garbage lines", () => {
  const { run } = createSandbox();
  const good = JSON.parse(run(`JSON.stringify(parseOllamaStreamLine('{"message":{"role":"assistant","content":"ahoy"},"done":false}'))`));
  assert.deepEqual(good, { delta: "ahoy", thinkDelta: "", done: false });
  const thinking = JSON.parse(run(`JSON.stringify(parseOllamaStreamLine('{"message":{"role":"assistant","content":"","thinking":"pondering the offer"},"done":false}'))`));
  assert.deepEqual(thinking, { delta: "", thinkDelta: "pondering the offer", done: false });
  const errLine = JSON.parse(run(`JSON.stringify(parseOllamaStreamLine('{"error":"model not found"}'))`));
  assert.deepEqual(errLine, { error: "model not found" });
  assert.equal(run(`parseOllamaStreamLine("not json at all")`), null);
  assert.equal(run(`parseOllamaStreamLine("")`), null);
  assert.equal(run(`parseOllamaStreamLine("   ")`), null);
});

test("stripThinkTags drops closed and unclosed <think> blocks, leaves plain prose untouched", () => {
  const { run } = createSandbox();
  assert.equal(run(`stripThinkTags("<think>hmm, a greedy pirate would ask for more</think>Ahoy, 900 cr and we've got a deal.")`), "Ahoy, 900 cr and we've got a deal.");
  assert.equal(run(`stripThinkTags("Ahoy, 900 cr and we've got a deal.<think>never actually closed")`), "Ahoy, 900 cr and we've got a deal.");
  assert.equal(run(`stripThinkTags("plain reply, no thinking tags at all")`), "plain reply, no thinking tags at all");
  assert.equal(run(`stripThinkTags(null)`), "");
});

test("ollamaChat sends S.ollama.think in the request body, and defensively strips inline <think> tags from the reply", async () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(1); S.pirateBands[b.id] = b; globalThis.__bandId = b.id;
    ensureOllamaSettings().think = true;
    globalThis.fetch = async (url, opts) => {
      globalThis.__lastBody = JSON.parse(opts.body);
      return { ok: true, body: null, json: async () => ({ message: { content: "<think>a greedy pirate would ask for more</think>Ahoy, matey!" } }) };
    };
  `);
  const out = JSON.parse(await run(`
    (async () => {
      const results = [];
      const text = await ollamaChat(__bandId, "hello", { onDone: full => results.push(full) });
      return JSON.stringify({ text, results, think: __lastBody.think });
    })()
  `));
  assert.equal(out.think, true, "the request body must carry the current S.ollama.think setting");
  assert.equal(out.text, "Ahoy, matey!", "an inline <think> block must be stripped even when Ollama doesn't separate it out");
  assert.deepEqual(out.results, ["Ahoy, matey!"], "onDone must receive the already-cleaned text");
});

test("a timed-out (idle) request gets a distinct, actionable message instead of the generic CORS/connection copy", async () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(1); S.pirateBands[b.id] = b; globalThis.__bandId = b.id;
    globalThis.fetch = async () => {
      const e = new Error("The operation was aborted.");
      e.name = "AbortError";
      throw e;
    };
  `);
  const errors = await run(`
    (async () => {
      const errors = [];
      await ollamaChat(__bandId, "hello", { onError: m => errors.push(m) });
      return errors;
    })()
  `);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /went quiet for too long/i);
  assert.doesNotMatch(errors[0], /OLLAMA_ORIGINS/, "a timeout is not a CORS problem — it shouldn't suggest the CORS fix");
});

test("a genuine connection failure still gets the CORS/OLLAMA_ORIGINS hint, unchanged", async () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(1); S.pirateBands[b.id] = b; globalThis.__bandId = b.id;
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  `);
  const errors = await run(`
    (async () => {
      const errors = [];
      await ollamaChat(__bandId, "hello", { onError: m => errors.push(m) });
      return errors;
    })()
  `);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /OLLAMA_ORIGINS/);
  assert.doesNotMatch(errors[0], /went quiet/i);
});

test("createIdleAbort degrades to a harmless no-op when AbortController is unavailable (as in this sandbox)", () => {
  const { run } = createSandbox();
  assert.equal(run(`typeof AbortController`), "undefined", "sanity: this sandbox has no AbortController, same as abortSignalWithTimeout's own fallback path");
  const idle = run(`createIdleAbort(1000)`);
  assert.equal(idle.signal, undefined);
  assert.doesNotThrow(() => run(`const i = createIdleAbort(1000); i.poke(); i.poke(); i.cancel();`));
});

test("escapeChatHtml neutralizes markup and attribute-breakout characters, plain text passes through readably", () => {
  const { run } = createSandbox();
  assert.equal(run(`escapeChatHtml('<img src=x onerror=alert(1)>')`), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(run(`escapeChatHtml("it's a deal, \\"friend\\"")`), "it&#39;s a deal, &quot;friend&quot;");
  assert.equal(run(`escapeChatHtml(null)`), "");
});

test("chat transcripts round-trip a save: apostrophes/quotes survive, markup is stripped, a hostile band-id key is dropped", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateChat = {
      b1: [
        { who: "you", text: "Let's talk terms, \\"captain\\"." },
        { who: "pirate", text: "pwn <script>evil()</script> your credits or your hull" },
        { who: "not-a-role", text: "sneaky", turn: "nope" },
      ],
      "b2'); evil('": [{ who: "you", text: "hi" }],
    };
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    S = undefined;
  `);
  assert.equal(run("loadGame()"), true);
  assert.equal(run("S.pirateChat.b1[0].text"), 'Let\'s talk terms, "captain".');
  assert.ok(!/[<>]/.test(run("S.pirateChat.b1[1].text")), "markup must be stripped from a pirate reply");
  assert.equal(run("S.pirateChat.b1[2].who"), "you", "an unrecognized `who` falls back to the safe default");
  assert.equal(run("S.pirateChat.b1[2].turn"), 0, "a non-finite turn falls back to 0");
  assert.equal(run(`Object.keys(S.pirateChat).some(k => /['"<>]/.test(k))`), false, "a hostile band-id key must be dropped");
});

test("a save predating this feature (no S.pirateChat key) sanitizes as a byte-identical no-op", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    delete S.pirateChat;
    saveGame();
  `);
  const before = run("localStorage.getItem(SAVE_KEY)");
  assert.equal(run("loadGame()"), true);
  run("saveGame();");
  assert.equal(run("localStorage.getItem(SAVE_KEY)"), before);
});

test("renderContacts renders the Talk sub-view without a real Ollama connection (fetch is stubbed undefined)", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(2); S.pirateBands[b.id] = b;
    setSubView("contacts", "chat");
  `);
  assert.doesNotThrow(() => run("renderContacts()"));
  assert.doesNotThrow(() => run("openBandChat(Object.keys(S.pirateBands)[0]); renderContacts();"));
});

test("bandNegotiationAcceptChance climbs toward the going rate, and standing/personality shift it further", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; b.pers = "bold"; S.pirateBands[b.id] = b;
    globalThis.__b = b;
  `);
  const base = run("escortRecruitBaseFee(__b)");
  const low = run(`bandNegotiationAcceptChance(__b, ${Math.round(base * 0.45)})`);
  const mid = run(`bandNegotiationAcceptChance(__b, ${Math.round(base * 0.75)})`);
  const atRate = run(`bandNegotiationAcceptChance(__b, ${base})`);
  assert.ok(low < mid && mid < atRate, "acceptance odds must climb as the offer nears the going rate");
  assert.ok(atRate >= 0.85, "an offer at or above the going rate should almost always be accepted");

  run(`__b.rep = 80;`);
  const midHighRep = run(`bandNegotiationAcceptChance(__b, ${Math.round(base * 0.75)})`);
  assert.ok(midHighRep > mid, "a friendlier band should accept a given offer more readily");

  run(`__b.rep = 0; __b.pers = "greedy";`);
  const greedy = run(`bandNegotiationAcceptChance(__b, ${Math.round(base * 0.75)})`);
  run(`__b.pers = "loyal";`);
  const loyal = run(`bandNegotiationAcceptChance(__b, ${Math.round(base * 0.75)})`);
  assert.ok(greedy < loyal, "a greedy crew should accept a given offer less readily than a loyal one");
});

test("bandNegotiationRejectChance is zero for a reasonable offer, and only rises for a real lowball", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; S.pirateBands[b.id] = b; globalThis.__b = b;
  `);
  const base = run("escortRecruitBaseFee(__b)");
  assert.equal(run(`bandNegotiationRejectChance(__b, ${base})`), 0);
  assert.equal(run(`bandNegotiationRejectChance(__b, ${Math.round(base * 0.75)})`), 0);
  const lowballReject = run(`bandNegotiationRejectChance(__b, ${Math.round(base * 0.4)})`);
  assert.ok(lowballReject > 0, "a genuine lowball must carry a real chance of outright refusal");
});

test("bandNegotiationCounterPrice always lands within bandNegotiationBounds, and pushes higher for a greedier crew", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; S.pirateBands[b.id] = b; globalThis.__b = b;
  `);
  const bounds = JSON.parse(run("JSON.stringify(bandNegotiationBounds(__b))"));
  const offer = bounds.lo;
  run(`__b.pers = "greedy";`);
  const greedyCounter = run(`bandNegotiationCounterPrice(__b, ${offer})`);
  run(`__b.pers = "loyal";`);
  const loyalCounter = run(`bandNegotiationCounterPrice(__b, ${offer})`);
  assert.ok(greedyCounter >= bounds.lo && greedyCounter <= bounds.hi);
  assert.ok(loyalCounter >= bounds.lo && loyalCounter <= bounds.hi);
  assert.ok(greedyCounter > loyalCounter, "a greedier crew should counter higher than a more generous one, from the same lowball");
});

test("decideNegotiation is deterministic given rand, and rolls ACCEPT/COUNTER/REJECT from the expected bands", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; b.pers = "bold"; S.pirateBands[b.id] = b; globalThis.__b = b;
  `);
  const base = run("escortRecruitBaseFee(__b)");
  const accept = JSON.parse(run(`JSON.stringify(decideNegotiation(__b, ${base}, 0))`));
  assert.deepEqual(accept, { status: "accept", amount: base }, "rand=0 must always fall inside the accept band at the going rate");

  const lowball = Math.round(base * 0.4);
  const reject = JSON.parse(run(`JSON.stringify(decideNegotiation(__b, ${lowball}, 0.999))`));
  assert.equal(reject.status, "reject");
  assert.equal(reject.amount, null);

  const mid = Math.round(base * 0.75);
  const counter = JSON.parse(run(`JSON.stringify(decideNegotiation(__b, ${mid}, 0.999))`));
  assert.equal(counter.status, "counter");
  assert.ok(Number.isInteger(counter.amount));
});

test("buildNegotiationNarration states the offer and gives decision-specific instructions with no ambiguity about the actual number", () => {
  const { run } = createSandbox();
  const accept = run(`buildNegotiationNarration(500, { status: "accept", amount: 500 })`);
  assert.ok(accept.includes("500") && /\bACCEPT\b/.test(accept));
  const counter = run(`buildNegotiationNarration(500, { status: "counter", amount: 700 })`);
  assert.ok(counter.includes("500") && counter.includes("700") && /\bCOUNTER\b/.test(counter));
  const reject = run(`buildNegotiationNarration(500, { status: "reject", amount: null })`);
  assert.ok(reject.includes("500") && /\bREJECT\b/.test(reject));
});

test("fallbackNegotiationLine gives a sensible line for each outcome, naming the band and the amount", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.pirateBands = {}; const b = newBand(1); S.pirateBands[b.id] = b; globalThis.__b = b;
  `);
  const name = run("__b.name");
  const accept = run(`fallbackNegotiationLine(__b, { status: "accept", amount: 900 })`);
  assert.ok(accept.includes("900") && accept.includes(name));
  const counter = run(`fallbackNegotiationLine(__b, { status: "counter", amount: 1200 })`);
  assert.ok(counter.includes(run("fmt(1200)")), "must show the amount formatted the same way as everywhere else (fmt)");
  const reject = run(`fallbackNegotiationLine(__b, { status: "reject", amount: null })`);
  assert.ok(reject.length > 0);
});

test("bandNegotiationBounds brackets 40%-150% of the BASE fee, unaffected by any already-struck deal", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    S.pirateBands = {}; const b = newBand(2); S.pirateBands[b.id] = b;
    globalThis.__b = b;
  `);
  const base = run("escortRecruitBaseFee(__b)");
  const bounds1 = JSON.parse(run("JSON.stringify(bandNegotiationBounds(__b))"));
  assert.equal(bounds1.lo, Math.round(base * 0.4));
  assert.equal(bounds1.hi, Math.round(base * 1.5));
  // striking a cheap deal must not shrink the bounds for the *next* round of haggling
  run(`setBandNegotiatedFee(__b.id, 1)`);
  const bounds2 = JSON.parse(run("JSON.stringify(bandNegotiationBounds(__b))"));
  assert.deepEqual(bounds2, bounds1, "bounds are always against the base fee, not a prior negotiated one");
});

test("setBandNegotiatedFee clamps into bounds, and escortRecruitFee/bandNegotiatedFee reflect it until it lapses", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    S.pirateBands = {}; const b = newBand(2); S.pirateBands[b.id] = b;
    globalThis.__b = b;
  `);
  const bounds = JSON.parse(run("JSON.stringify(bandNegotiationBounds(__b))"));
  const struck = run(`setBandNegotiatedFee(__b.id, ${bounds.hi + 999999})`);   // an absurd ask must clamp down
  assert.equal(struck, bounds.hi);
  assert.equal(run("bandNegotiatedFee(__b)"), bounds.hi);
  assert.equal(run("escortRecruitFee(__b)"), bounds.hi, "escortRecruitFee must honor the struck deal over the base formula");
  assert.equal(run("__b.negotiatedUntil"), run(`S.turn + NEGOTIATED_DEAL_DURATION`));

  // advance past the deal window and it must lapse back to the base fee, same pattern as a truce
  run(`S.turn += NEGOTIATED_DEAL_DURATION + 1`);
  assert.equal(run("bandNegotiatedFee(__b)"), null);
  assert.equal(run("escortRecruitFee(__b)"), run("escortRecruitBaseFee(__b)"));
});

test("escortRecruitBand charges the negotiated fee (not the base one) and consumes the deal on use", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    refreshEscortOffers(); acceptEscort(0);
    S.pirateBands = {}; const b = newBand(1); b.rep = 50; S.pirateBands[b.id] = b;
    globalThis.__b = b;
    S.res.credits = 100000;
  `);
  const base = run("escortRecruitBaseFee(__b)");
  const negotiated = Math.round(base * 0.5);
  run(`setBandNegotiatedFee(__b.id, ${negotiated})`);
  const creditsBefore = run("S.res.credits");
  run(`escortRecruitBand(__b.id)`);
  const creditsAfter = run("S.res.credits");
  assert.equal(creditsBefore - creditsAfter, negotiated, "must charge the struck price, not escortRecruitBaseFee");
  assert.equal(run("__b.negotiatedFee"), null, "the deal is spent once used");
  assert.equal(run("__b.negotiatedUntil"), 0);
  assert.equal(run("S.escort.fleet.some(s => s.hired && s.bandId === __b.id)"), true, "the band must actually join the escort roster");
});

test("renderEscort's hire list excludes a flighty band normally, but includes it once you've struck a deal", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  run(`const _c = {}; const _o = document.getElementById.bind(document);
       document.getElementById = id => _c[id] || (_c[id] = _o(id));`);
  run(`
    S.pirateBands = {};
    const b = newBand(1); b.rep = -10; b.pers = "greedy"; S.pirateBands[b.id] = b;   // neutral tier (still recruitable) but greedy + low rep -> desert risk well over 5%
    globalThis.__b = b;
    refreshEscortOffers(); acceptEscort(0);
  `);
  assert.ok(run("bandBetrayChance(__b) >= 0.05"), "test band must actually be above the normal cutoff");
  const before = run(`document.getElementById("panel-escort").innerHTML`);
  assert.doesNotMatch(before, new RegExp(`escortRecruitBand\\('${run("__b.id")}'\\)`), "a flighty, un-negotiated band must not appear in the hire list");

  // No explicit renderEscort() here — the Escort tab is "already open" (its DOM was drawn
  // above) when the deal is struck elsewhere. setTab() only toggles panel visibility on
  // switch, it never re-renders, so setBandNegotiatedFee itself must refresh every panel
  // (renderAll(), not just renderContacts()) or this tab would show the stale, pre-deal price.
  run(`setBandNegotiatedFee(__b.id, escortRecruitBaseFee(__b));`);
  const after = run(`document.getElementById("panel-escort").innerHTML`);
  const feeStr = run("fmt(escortRecruitFee(__b))");
  assert.match(after, new RegExp(`escortRecruitBand\\('${run("__b.id")}'\\)`), "a band you've struck a deal with must appear regardless of desert risk, with no explicit re-render needed");
  assert.ok(after.includes(`Hire (${feeStr} cr)`), "the button must show the negotiated fee");
});

test("ollamaNegotiate resolves via onDone with the model's own words when Ollama is reachable", async () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; b.pers = "bold"; S.pirateBands[b.id] = b; globalThis.__bandId = b.id;
    globalThis.fetch = async () => ({ ok: true, body: null, json: async () => ({ message: { content: "Ye drive a hard bargain, but it's a deal!" } }) });
    Math.random = () => 0;   // force the ACCEPT band
  `);
  const base = run("escortRecruitBaseFee(S.pirateBands[__bandId])");
  const out = JSON.parse(await run(`
    (async () => {
      let result = null;
      await ollamaNegotiate(__bandId, ${base}, { onDone: r => { result = r; } });
      return JSON.stringify(result);
    })()
  `));
  assert.equal(out.status, "accept");
  assert.equal(out.amount, base, "the price is the app's own decision, never something parsed out of the model's text");
  assert.equal(out.offline, false);
  assert.equal(out.clean, "Ye drive a hard bargain, but it's a deal!", "the model's own words are used verbatim as flavor when available");
});

test("ollamaNegotiate still resolves the app's decision via onDone (never onError, no throw) when fetch is unavailable — the outcome doesn't depend on the model", async () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    S.pirateBands = {}; const b = newBand(2); b.rep = 0; b.pers = "bold"; S.pirateBands[b.id] = b; globalThis.__bandId = b.id;
    Math.random = () => 0;   // force the ACCEPT band; fetch stays undefined (this sandbox's default)
  `);
  const base = run("escortRecruitBaseFee(S.pirateBands[__bandId])");
  const out = JSON.parse(await run(`
    (async () => {
      let result = null;
      await ollamaNegotiate(__bandId, ${base}, { onDone: r => { result = r; } });
      return JSON.stringify(result);
    })()
  `));
  assert.equal(out.status, "accept");
  assert.equal(out.amount, base);
  assert.equal(out.offline, true, "a connection failure must still resolve the decision, flagged offline");
  assert.ok(out.clean && out.clean.length, "a fallback narration line must stand in for the missing AI reply");
});

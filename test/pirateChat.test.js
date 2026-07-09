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

test("parseOllamaStreamLine reads a delta, surfaces a server error, and ignores garbage lines", () => {
  const { run } = createSandbox();
  const good = JSON.parse(run(`JSON.stringify(parseOllamaStreamLine('{"message":{"role":"assistant","content":"ahoy"},"done":false}'))`));
  assert.deepEqual(good, { delta: "ahoy", done: false });
  const errLine = JSON.parse(run(`JSON.stringify(parseOllamaStreamLine('{"error":"model not found"}'))`));
  assert.deepEqual(errLine, { error: "model not found" });
  assert.equal(run(`parseOllamaStreamLine("not json at all")`), null);
  assert.equal(run(`parseOllamaStreamLine("")`), null);
  assert.equal(run(`parseOllamaStreamLine("   ")`), null);
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

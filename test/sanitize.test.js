"use strict";
/* The save file is the one outside input the game accepts, and log messages /
   names / ids from it flow into innerHTML and onclick="fn('${id}')" handler
   strings. sanitizeLoadedState() runs on every load (and on import) — these
   tests pin down both halves of its contract: hostile content is neutralized,
   and a healthy save passes through byte-identical. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("a crafted save's markup and handler-breakout payloads are neutralized on load", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.log.unshift({ msg: 'pwn <img src=x onerror=alert(1)> <SCRIPT>evil()</SCRIPT> — <span class="c">kept</span> <b>bold</b> <span class="c" onmouseover="evil()">attrs stripped</span>', type: 'bad"><script>x</script>', turn: 3 });
    S.journal.push({ turn: 3, cat: "x<y>", text: "hello <script>evil()</script> world" });
    S.pirateBands = {};
    S.pirateBands["band'); evil('"] = { id: "band'); evil('", name: "<script>alert(1)</script>Corsairs", rel: 0 };
    S.fleet.push({ id: "sh1'); evil('", key: "corvette", name: "Cor<vette>", home: "terra", status: "idle", hull: 10, hullMax: 10 });
    S.fx.push({ key: "boon'); evil('", cyclesLeft: 3 });
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    S = undefined;
  `);
  assert.equal(run("loadGame()"), true);

  const msg = run("S.log[0].msg");
  assert.ok(!/onerror|<img|<script|onmouseover/i.test(msg), `hostile markup survived: ${msg}`);
  assert.ok(msg.includes('<span class="c">kept</span>'), "the game's own span markup must survive");
  assert.ok(msg.includes("<b>bold</b>"), "the game's own <b> markup must survive");
  assert.equal(run("S.log[0].type"), "", "an unknown log type must fall back to the default class");

  assert.ok(!/[<>]/.test(run("S.journal[S.journal.length - 1].text")), "journal text must be tag-free");
  assert.equal(run(`Object.keys(S.pirateBands).some(k => /['"<>]/.test(k))`), false, "a hostile band key must drop its entry");
  assert.equal(run(`S.fleet.some(s => /['"<>\`]/.test(s.id) || /[<>]/.test(s.name))`), false, "ship ids/names must lose breakout characters");
  assert.equal(run(`S.fx.some(f => /['"<>\`]/.test(f.key))`), false, "fx keys are onclick('\${key}') arguments and must be clean");
});

test("importSaveText stores the sanitized state, not the raw file", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.log.unshift({ msg: "x <img src=x onerror=alert(1)>", type: "good", turn: 1 });
    const file = JSON.stringify({ game: "stellar-frontier-save", version: "v2", state: S });
    importSaveText(file);
  `);
  assert.ok(!/onerror/.test(run("localStorage.getItem(SAVE_KEY)")));
});

test("sanitizing a healthy save is a byte-identical no-op", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    log('Jumped to <span class="c">Terra Nova</span> (−8 ⛽).', "event");
    log("Installed 🕳️ Smuggler's Hold (Tier 1).", "good");   // apostrophes in prose must survive
    log("🔓 New feature unlocked: <b>Missions</b> — contracts & legacy goals.", "event");
    saveGame();
  `);
  const before = run("localStorage.getItem(SAVE_KEY)");
  assert.equal(run("loadGame()"), true);
  run("saveGame();");
  assert.equal(run("localStorage.getItem(SAVE_KEY)"), before);
});

test("a save with non-array log/journal loads with them reset instead of crashing the renderer", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    S.log = { evil: true };
    S.journal = "nope";
    localStorage.setItem(SAVE_KEY, JSON.stringify(S));
    S = undefined;
  `);
  assert.equal(run("loadGame()"), true);
  assert.equal(run("Array.isArray(S.log) && S.log.length"), 0);
  assert.equal(run("Array.isArray(S.journal) && S.journal.length"), 0);
  run("renderLog()");   // must not throw on the stub DOM
});

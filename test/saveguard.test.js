"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("loadGame preserves an unreadable autosave under the recovery key instead of losing it", () => {
  const { run } = createSandbox();
  run(`localStorage.setItem(SAVE_KEY, "{corrupt json");`);
  assert.equal(run("loadGame()"), false);
  assert.equal(run("localStorage.getItem(RECOVERY_KEY)"), "{corrupt json");
});

test("loadGame treats valid JSON that isn't a game state as unreadable (recovered, not loaded)", () => {
  const { run } = createSandbox();
  run(`localStorage.setItem(SAVE_KEY, JSON.stringify({ hello: "world" }));`);
  assert.equal(run("loadGame()"), false);
  assert.ok(run("localStorage.getItem(RECOVERY_KEY)").includes("world"));
});

test("loadGame still loads a healthy autosave and leaves no recovery copy", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.res.credits = 4321; saveGame(); S = undefined;");
  assert.equal(run("loadGame()"), true);
  assert.equal(run("S.res.credits"), 4321);
  assert.equal(run("localStorage.getItem(RECOVERY_KEY)"), null);
});

test("saveGame survives a storage failure without throwing, and recovers when storage returns", () => {
  const { run } = createSandbox();
  run(`
    S = freshState();
    const _realSetItem = localStorage.setItem;
    localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
    saveGame();   // must not throw
    saveGame();   // repeat failures must stay quiet too
    localStorage.setItem = _realSetItem;
    saveGame();   // storage is back — this one must land
  `);
  assert.equal(run("JSON.parse(localStorage.getItem(SAVE_KEY)).turn"), 1);
});

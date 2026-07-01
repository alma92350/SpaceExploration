"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

// Helper: call a sandboxed function with a JS-string argument and bring the
// result back across the vm boundary as plain JSON (avoids cross-realm
// object surprises — everything is serialized to a string and re-parsed).
function callWithString(run, fnName, arg) {
  const json = run(`JSON.stringify(${fnName}(${JSON.stringify(arg)}))`);
  return JSON.parse(json);
}

test("a save built with buildSaveText parses back to an equivalent state", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.turn = 17; S.res.credits = 54321;");
  const text = run("buildSaveText()");
  assert.equal(typeof text, "string");

  const result = callWithString(run, "parseSaveText", text);
  assert.equal(result.ok, true);
  assert.equal(result.state.turn, 17);
  assert.equal(result.state.res.credits, 54321);
});

test("parseSaveText also accepts a bare state object (no envelope)", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.turn = 3;");
  const bareState = run("JSON.stringify(S)");

  const result = callWithString(run, "parseSaveText", bareState);
  assert.equal(result.ok, true);
  assert.equal(result.state.turn, 3);
});

test("parseSaveText rejects invalid JSON and non-save data instead of throwing", () => {
  const { run } = createSandbox();
  run("S = freshState();");

  const badJson = callWithString(run, "parseSaveText", "not json at all");
  assert.equal(badJson.ok, false);

  const notASave = callWithString(run, "parseSaveText", JSON.stringify({ hello: "world" }));
  assert.equal(notASave.ok, false);
});

test("importSaveText writes a parsed save straight to localStorage", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.turn = 9;");
  const text = run("buildSaveText()");

  const result = callWithString(run, "importSaveText", text);
  assert.equal(result.ok, true);

  const stored = JSON.parse(run("localStorage.getItem(SAVE_KEY)"));
  assert.equal(stored.turn, 9);
});

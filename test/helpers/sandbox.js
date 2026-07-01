"use strict";
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const DATA_JS_PATH = path.join(__dirname, "..", "..", "data.js");
const GALAXYGEN_JS_PATH = path.join(__dirname, "..", "..", "galaxygen.js");
const GAME_JS_PATH = path.join(__dirname, "..", "..", "game.js");
const DATA_SOURCE = fs.readFileSync(DATA_JS_PATH, "utf8");
const GALAXYGEN_SOURCE = fs.readFileSync(GALAXYGEN_JS_PATH, "utf8");
const GAME_SOURCE = fs.readFileSync(GAME_JS_PATH, "utf8");

// data.js + galaxygen.js + game.js are classic (non-module) browser scripts,
// loaded here in the same order and the same shared realm index.html loads
// them in. Their top-level `let`/`const` bindings (S, MILESTONES,
// winProgress, PLANETS, ...) live in the vm context's shared lexical scope,
// not as properties of the sandbox object — same reason `window.S` doesn't
// exist in a real browser. `run()` below executes a snippet in that same
// shared scope, which is how tests reach in to set up state and call
// functions.
function makeElement(id) {
  return {
    id: typeof id === "string" ? id : "",
    className: "", textContent: "", innerHTML: "", title: "", value: "",
    disabled: false, style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, removeChild() {}, remove() {},
    addEventListener() {}, removeEventListener() {},
    querySelectorAll() { return []; }, querySelector() { return null; },
  };
}

function createSandbox() {
  const state = { confirmResult: true, confirmCalls: [], promptResult: null, alerts: [] };

  const documentStub = {
    getElementById: (id) => makeElement(id),
    querySelectorAll: () => [],
    querySelector: () => null,
    createElement: () => makeElement(null),
    addEventListener() {},
    body: makeElement("body"),
  };

  const windowStub = {
    _listeners: {},
    addEventListener(name, fn) { windowStub._listeners[name] = fn; },
    removeEventListener() {},
    AudioContext: undefined,
    webkitAudioContext: undefined,
    innerWidth: 1024,
    innerHeight: 768,
  };

  const localStorageStub = (() => {
    const store = new Map();
    return {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
      clear: () => store.clear(),
    };
  })();

  const sandbox = {
    window: windowStub,
    document: documentStub,
    localStorage: localStorageStub,
    performance: { now: () => Date.now() },
    console,
    confirm: (msg) => { state.confirmCalls.push(msg); return state.confirmResult; },
    prompt: () => state.promptResult,
    alert: (msg) => { state.alerts.push(msg); },
    fetch: undefined,
    // no-op timers: tests run synchronously and shouldn't leak real timers
    setTimeout: () => 0,
    clearTimeout() {},
    setInterval: () => 0,
    clearInterval() {},
  };

  const context = vm.createContext(sandbox);
  new vm.Script(DATA_SOURCE, { filename: "data.js" }).runInContext(context);
  new vm.Script(GALAXYGEN_SOURCE, { filename: "galaxygen.js" }).runInContext(context);
  new vm.Script(GAME_SOURCE, { filename: "game.js" }).runInContext(context);

  function run(code) {
    return new vm.Script(code, { filename: "test-snippet.js" }).runInContext(context);
  }

  return { context, run, state };
}

module.exports = { createSandbox };

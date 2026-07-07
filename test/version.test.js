"use strict";
/* A release touches four places that must agree — APP_VERSION (game.js),
   version.json (the live update banner), the newest CHANGELOG entry, and the
   ?v= cache-buster on every <script>/<link> tag in index.html (game.js:~276
   documents the ritual). A missed spot means players' browsers mix cached old
   scripts with new ones, or the update banner lies about the running build.
   This test turns that from a silent production failure into a red CI check. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");

test("APP_VERSION, version.json, the changelog and every index.html cache-buster agree", () => {
  const gameSrc = read("game.js");
  const appVersion = gameSrc.match(/const APP_VERSION = "([^"]+)"/)[1];
  const saveVersion = gameSrc.match(/const SAVE_VERSION = "([^"]+)"/)[1];

  const manifest = JSON.parse(read("version.json"));
  assert.equal(manifest.version, appVersion, "version.json must match APP_VERSION");
  assert.equal(manifest.saveVersion, saveVersion, "version.json saveVersion must match SAVE_VERSION");
  assert.ok(manifest.notes && manifest.notes.length, "version.json needs release notes for the update banner");

  const newestChangelog = gameSrc.match(/const CHANGELOG = \[\s*\{ version: "([^"]+)"/)[1];
  assert.equal(newestChangelog, appVersion, "the newest CHANGELOG entry must be the running version");

  // the autosave key's suffix is the save-format version (see persistence.js)
  const saveKey = read("persistence.js").match(/const SAVE_KEY = "([^"]+)"/)[1];
  assert.ok(saveKey.endsWith("-" + saveVersion), `SAVE_KEY (${saveKey}) must end with -${saveVersion}`);

  // every script/stylesheet tag carries a cache-buster, and they all match
  const html = read("index.html");
  const tags = [...html.matchAll(/(?:src|href)="([^"]+?\.(?:js|css))(\?v=([^"]*))?"/g)];
  assert.ok(tags.length >= 29, `expected ~29 asset tags in index.html, found ${tags.length}`);
  tags.forEach(([, file, q, v]) => {
    assert.ok(q, `${file} is missing its ?v= cache-buster`);
    assert.equal(v, appVersion, `${file} pins ?v=${v}, expected ${appVersion}`);
  });
});

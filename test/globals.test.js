"use strict";
/* All 28 game scripts share one global scope (classic <script> tags, no
   modules), which makes two mistakes silent at runtime:
   - the same `function` (or `var`) declared twice — the later one wins with
     no error (this shipped once: the duplicate huntPirates() removed in
     v2.78.1);
   - the same top-level name declared in TWO DIFFERENT files — function/var
     overwrite silently, and a later `const`/`let` silently shadows an earlier
     function from another file.
   `const`/`let` duplicates WITHIN one file already throw at load, so the
   within-file check only needs function/var. This test scans every script
   index.html actually loads and fails on either collision. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scriptFiles = [...html.matchAll(/<script src="([^"?]+)/g)].map(m => m[1]);

// top-level = column 0, matching the codebase's 2-space indent style
function topLevelDecls(src) {
  const names = [];
  src.split("\n").forEach((line, i) => {
    let m = /^function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) { names.push({ name: m[1], kind: "function", line: i + 1 }); return; }
    m = /^(const|let|var)\s+(.+)$/.exec(line);
    if (m) {
      // first declarator plus any further comma-separated ones on the same line
      const re = /(?:^|,)\s*([A-Za-z_$][\w$]*)\s*(?==|,|;|$)/g;
      let d;
      while ((d = re.exec(m[2]))) names.push({ name: d[1], kind: m[1], line: i + 1 });
      return;
    }
    m = /^class\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (m) names.push({ name: m[1], kind: "class", line: i + 1 });
  });
  return names;
}

test("index.html loads every game script exactly once", () => {
  assert.ok(scriptFiles.length >= 28, `expected the full script list, found ${scriptFiles.length}`);
  const dupes = scriptFiles.filter((f, i) => scriptFiles.indexOf(f) !== i);
  assert.deepEqual(dupes, []);
  scriptFiles.forEach(f => assert.ok(fs.existsSync(path.join(root, f)), `${f} is referenced by index.html but missing`));
});

test("no top-level name is declared twice within one file (function/var overwrite silently)", () => {
  const problems = [];
  scriptFiles.forEach(f => {
    const seen = new Map();
    topLevelDecls(fs.readFileSync(path.join(root, f), "utf8")).forEach(d => {
      if (d.kind !== "function" && d.kind !== "var") return;
      if (seen.has(d.name)) problems.push(`${f}: ${d.kind} ${d.name} declared on lines ${seen.get(d.name)} and ${d.line}`);
      else seen.set(d.name, d.line);
    });
  });
  assert.deepEqual(problems, []);
});

test("no top-level name is declared in two different files (later scripts win silently)", () => {
  const byName = new Map();   // name -> first "file:line (kind)"
  const problems = [];
  scriptFiles.forEach(f => {
    const inThisFile = new Set();
    topLevelDecls(fs.readFileSync(path.join(root, f), "utf8")).forEach(d => {
      if (inThisFile.has(d.name)) return;   // within-file dupes are the previous test's job
      inThisFile.add(d.name);
      const prior = byName.get(d.name);
      if (prior) problems.push(`${d.name}: declared in ${prior} and ${f}:${d.line} (${d.kind})`);
      else byName.set(d.name, `${f}:${d.line} (${d.kind})`);
    });
  });
  assert.deepEqual(problems, []);
});

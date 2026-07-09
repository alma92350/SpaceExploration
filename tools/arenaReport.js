/* ============================================================
   MODEL ARENA — result aggregation + leaderboard rendering (phase 1)
   Pure functions over the runner's call records, kept out of
   modelArena.mjs so `node --test` can pin them down without any network:
   summarizeCalls() folds raw per-call results into per-model stats,
   renderLeaderboard() turns that into the markdown the runner writes and
   prints. A call "passes" its battery only if every applicable check
   passed; per-check rates are kept too, so the leaderboard can say WHY a
   model loses, not just that it does.
   ============================================================ */

"use strict";

// stable column order for the per-check breakdown tables
const CHECK_ORDER = [
  "nonEmpty", "brief", "inCharacter", "noRefusal", "grounded", "quotesFee",
  "namesAmount", "noStrayFigures", "noOfferEcho", "noFigures",
  "noThinkLeak", "noLoop",
];

function median(xs) {
  if (!xs || !xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// calls: [{ model, battery, pass, checks, error, ttftMs, tokPerSec }]
// -> per-model rollup, sorted best combined battery pass-rate first
function summarizeCalls(calls) {
  const byModel = new Map();
  calls.forEach(c => {
    if (!byModel.has(c.model)) byModel.set(c.model, { model: c.model, batteries: {}, errors: 0, ttft: [], tok: [] });
    const m = byModel.get(c.model);
    if (c.error) { m.errors++; }
    if (c.ttftMs != null) m.ttft.push(c.ttftMs);
    if (c.tokPerSec != null) m.tok.push(c.tokPerSec);
    if (!m.batteries[c.battery]) m.batteries[c.battery] = { total: 0, passed: 0, checkRates: {} };
    const b = m.batteries[c.battery];
    b.total++;
    if (!c.error && c.pass) b.passed++;
    Object.entries(c.checks || {}).forEach(([name, ok]) => {
      if (!b.checkRates[name]) b.checkRates[name] = { passed: 0, total: 0 };
      b.checkRates[name].total++;
      if (ok) b.checkRates[name].passed++;
    });
  });
  const models = [...byModel.values()].map(m => ({
    model: m.model,
    batteries: Object.fromEntries(Object.entries(m.batteries).map(([k, b]) => [k, {
      total: b.total, passed: b.passed, rate: b.total ? b.passed / b.total : null,
      checkRates: Object.fromEntries(Object.entries(b.checkRates).map(([n, r]) => [n, { passed: r.passed, total: r.total, rate: r.total ? r.passed / r.total : null }])),
    }])),
    errors: m.errors,
    medianTtftMs: median(m.ttft),
    medianTokPerSec: median(m.tok),
  }));
  models.sort((a, b) => combinedRate(b) - combinedRate(a));
  return models;
}
function combinedRate(m) {
  const rates = Object.values(m.batteries).map(b => b.rate).filter(r => r != null);
  return rates.length ? rates.reduce((s, r) => s + r, 0) / rates.length : 0;
}

const pct = r => (r == null ? "—" : Math.round(r * 100) + "%");
const ms = v => (v == null ? "—" : Math.round(v) + "ms");
const tps = v => (v == null ? "—" : (Math.round(v * 10) / 10) + " tok/s");

// meta: { date, endpoint, ollamaVersion, think, samples, scenarioCounts, skipped: [{model, reason}] }
function renderLeaderboard(models, meta) {
  const batteryNames = [...new Set(models.flatMap(m => Object.keys(m.batteries)))];
  const L = [];
  L.push(`# Model Arena — leaderboard`);
  L.push("");
  L.push(`Run: ${meta.date} · endpoint ${meta.endpoint} · Ollama ${meta.ollamaVersion || "?"} · think ${meta.think ? "on" : "off"} · ${meta.samples} sample(s)/probe`);
  const counts = Object.entries(meta.scenarioCounts || {}).map(([k, n]) => `${n} ${k}`).join(", ");
  if (counts) L.push(`Scenarios: ${counts} (see docs/MODEL_EVAL.md for what each battery checks)`);
  L.push("");
  L.push(`| Model | ${batteryNames.map(b => cap(b)).join(" | ")} | Median TTFT | Median speed | Errors |`);
  L.push(`|---|${batteryNames.map(() => "---:").join("|")}|---:|---:|---:|`);
  models.forEach(m => {
    const cols = batteryNames.map(b => (m.batteries[b] ? `${pct(m.batteries[b].rate)} (${m.batteries[b].passed}/${m.batteries[b].total})` : "—"));
    L.push(`| ${m.model} | ${cols.join(" | ")} | ${ms(m.medianTtftMs)} | ${tps(m.medianTokPerSec)} | ${m.errors || 0} |`);
  });
  batteryNames.forEach(bat => {
    const checkNames = orderedChecks(models, bat);
    if (!checkNames.length) return;
    L.push("");
    L.push(`## ${cap(bat)} — per-check pass rates`);
    L.push("");
    L.push(`| Model | ${checkNames.join(" | ")} |`);
    L.push(`|---|${checkNames.map(() => "---:").join("|")}|`);
    models.forEach(m => {
      const b = m.batteries[bat];
      if (!b) return;
      L.push(`| ${m.model} | ${checkNames.map(n => pct(b.checkRates[n] ? b.checkRates[n].rate : null)).join(" | ")} |`);
    });
  });
  if (meta.skipped && meta.skipped.length) {
    L.push("");
    L.push(`## Skipped models`);
    L.push("");
    meta.skipped.forEach(s => L.push(`- **${s.model}** — ${s.reason}`));
  }
  L.push("");
  return L.join("\n");
}
function orderedChecks(models, battery) {
  const seen = new Set(models.flatMap(m => (m.batteries[battery] ? Object.keys(m.batteries[battery].checkRates) : [])));
  return [...CHECK_ORDER.filter(c => seen.has(c)), ...[...seen].filter(c => !CHECK_ORDER.includes(c)).sort()];
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

module.exports = { summarizeCalls, renderLeaderboard, median, CHECK_ORDER };

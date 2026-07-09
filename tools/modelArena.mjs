#!/usr/bin/env node
/* ============================================================
   MODEL ARENA — phase 1 runner (see docs/MODEL_EVAL.md)
   Benchmarks locally-installed Ollama models on the game's own pirate-chat
   prompts: the banter/persona battery and the negotiation-narration
   battery, all scored by deterministic checkers (tools/arenaChecks.js).

   Deliberately NOT part of `node --test`: it does real network I/O against
   a live Ollama server, takes minutes, and its numbers are meaningless off
   the machine that produced them. The pure pieces it drives — scenario
   building, checkers, aggregation — are covered there instead
   (test/arena.test.js); this file is only the I/O shell.

   Usage:
     node tools/modelArena.mjs                        # every installed 0.5B-4.5B model
     node tools/modelArena.mjs --models llama3.2:1b,qwen3:1.7b --samples 3
     npm run arena -- --think                         # reasoning models: think on

   Requests mirror what pirateChat.js sends (`think` always in the body, no
   sampler options unless you pass --temperature/--seed, since the game
   sets none), one call at a time — parallel calls on one local GPU would
   wreck the latency numbers. Each reply is scored on arrival; every raw
   reply lands in results.json so a later judge pass (phase 4) can re-score
   without re-running inference.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildScenarios } = require("./arenaScenarios.js");
const { checkBanterReply, checkNegotiationReply } = require("./arenaChecks.js");
const { summarizeCalls, renderLeaderboard } = require("./arenaReport.js");

const AUTO_MIN_B = 0.5, AUTO_MAX_B = 4.5;   // --models auto: the 0.8B-4B target range, with margin
const IDLE_TIMEOUT_MS = 120000;             // per-call silence allowance (240s under --think)
const MAX_CONSECUTIVE_ERRORS = 10;          // a model failing this often in a row gets abandoned

const HELP = `Model Arena — benchmark local Ollama models on Stellar Frontier's pirate-chat prompts.

Options:
  --endpoint <url>     Ollama server (default http://localhost:11434)
  --models <csv|auto>  models to test; "auto" = every installed model whose
                       parameter_size is ${AUTO_MIN_B}B-${AUTO_MAX_B}B (default auto)
  --samples <n>        samples per probe — small models are high-variance,
                       so scores are pass RATES (default 5)
  --batteries <csv>    banter,negotiation (default both)
  --think              ask for chain-of-thought (message.thinking), like the
                       game's 🧠 toggle; models that don't support it will
                       error on every call, which is itself a result
  --temperature <t>    sampler override (default: none, exactly like the game)
  --seed <n>           sampler seed, for reproducing a specific failure
  --timeout <ms>       idle timeout per call (default ${IDLE_TIMEOUT_MS}, ${IDLE_TIMEOUT_MS * 2} with --think)
  --keep-loaded        skip unloading each model when it finishes
  --out <dir>          results directory (default arena-results/)
  --help               this text

Writes <out>/run-<stamp>/results.json (every raw reply, for later re-scoring)
and leaderboard.md (also printed when the run ends).`;

function fail(msg) { console.error(`modelArena: ${msg}`); process.exit(1); }

function parseCli() {
  let args;
  try {
    ({ values: args } = parseArgs({ options: {
      endpoint: { type: "string", default: "http://localhost:11434" },
      models: { type: "string", default: "auto" },
      samples: { type: "string", default: "5" },
      batteries: { type: "string", default: "banter,negotiation" },
      think: { type: "boolean", default: false },
      temperature: { type: "string" },
      seed: { type: "string" },
      timeout: { type: "string" },
      "keep-loaded": { type: "boolean", default: false },
      out: { type: "string", default: "arena-results" },
      help: { type: "boolean", default: false },
    } }));
  } catch (e) { fail(`${e.message}\n\n${HELP}`); }
  if (args.help) { console.log(HELP); process.exit(0); }
  const samples = parseInt(args.samples, 10);
  if (!(samples >= 1)) fail("--samples must be a positive integer");
  const idleMs = args.timeout ? parseInt(args.timeout, 10) : (args.think ? IDLE_TIMEOUT_MS * 2 : IDLE_TIMEOUT_MS);
  if (!(idleMs >= 1000)) fail("--timeout must be at least 1000 (ms)");
  const batteries = args.batteries.split(",").map(s => s.trim()).filter(Boolean);
  const bad = batteries.filter(b => b !== "banter" && b !== "negotiation");
  if (bad.length) fail(`unknown batteries: ${bad.join(", ")} (phase 1 has banter, negotiation)`);
  const options = {};
  if (args.temperature != null) options.temperature = parseFloat(args.temperature);
  if (args.seed != null) options.seed = parseInt(args.seed, 10);
  return {
    endpoint: args.endpoint.replace(/\/+$/, ""), modelsArg: args.models, samples, batteries,
    think: args.think, options: Object.keys(options).length ? options : null,
    idleMs, keepLoaded: args["keep-loaded"], outDir: args.out,
  };
}

/* ---- Ollama plumbing ---- */
async function getJson(url, timeoutMs) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs || 8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${url}`);
  return r.json();
}
// "1.2B" / "600M" / "3.21B" -> billions, or null
function parseParamSize(s) {
  const m = /([\d.]+)\s*([MB])/i.exec(String(s || ""));
  return m ? parseFloat(m[1]) / (m[2].toUpperCase() === "M" ? 1000 : 1) : null;
}

// POST /api/chat, streamed NDJSON — same shape pirateChat.js consumes, plus
// wall-clock TTFT and the timing metadata Ollama puts on the final line.
// Idle-based abort like the game's createIdleAbort: only real silence kills
// a call, never mere slowness. Resolves { content, thinking, ttftMs,
// metrics } or { error } — it never throws.
async function streamChat(cfg, body) {
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), cfg.idleMs);
  const poke = () => { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), cfg.idleMs); };
  const t0 = performance.now();
  let content = "", thinking = "", ttftMs = null, final = null;
  const takeLine = line => {
    if (!line.trim()) return;
    let obj;
    try { obj = JSON.parse(line); } catch (e) { return; }
    if (obj.error) throw new Error(String(obj.error));
    const d = (obj.message && obj.message.content) || "", th = (obj.message && obj.message.thinking) || "";
    if ((d || th) && ttftMs == null) ttftMs = performance.now() - t0;
    content += d; thinking += th;
    if (obj.done) final = obj;
  };
  try {
    const r = await fetch(cfg.endpoint + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: ctrl.signal,
    });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = await r.json(); if (j && j.error) msg = String(j.error); } catch (e) {}
      return { error: msg };
    }
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of r.body) {
      poke();
      buf += decoder.decode(chunk, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop();
      parts.forEach(takeLine);
    }
    takeLine(buf);
    const metrics = final ? {
      totalDurationNs: final.total_duration, loadDurationNs: final.load_duration,
      promptEvalCount: final.prompt_eval_count, promptEvalDurationNs: final.prompt_eval_duration,
      evalCount: final.eval_count, evalDurationNs: final.eval_duration,
    } : null;
    return { content, thinking, ttftMs, metrics };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? `went quiet for ${cfg.idleMs}ms (idle timeout)` : String((e && e.message) || e) };
  } finally { clearTimeout(timer); }
}

async function warmUp(cfg, model) {
  // untimed: absorbs model load (and surfaces "model not found" before a
  // whole battery burns on it). num_predict caps a rambler.
  const r = await streamChat(cfg, {
    model, messages: [{ role: "user", content: "Reply with the single word: aye" }],
    stream: true, think: false, options: { num_predict: 32 },
  });
  return r.error || null;
}
async function unloadModel(cfg, model) {
  try {
    await fetch(cfg.endpoint + "/api/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [], keep_alive: 0 }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) { /* best-effort — the next model's load evicts it anyway */ }
}

/* ---- The run ---- */
async function main() {
  const cfg = parseCli();

  let version = null;
  try { version = (await getJson(cfg.endpoint + "/api/version")).version; }
  catch (e) { fail(`can't reach Ollama at ${cfg.endpoint} (${e.message}) — is \`ollama serve\` running? Use --endpoint to point elsewhere.`); }

  let installed = [];
  try { installed = ((await getJson(cfg.endpoint + "/api/tags")).models || []).map(m => ({ name: m.name || m.model, sizeB: parseParamSize(m.details && m.details.parameter_size) })); }
  catch (e) { fail(`couldn't list models via /api/tags: ${e.message}`); }

  let models;
  if (cfg.modelsArg === "auto") {
    models = installed.filter(m => m.sizeB != null && m.sizeB >= AUTO_MIN_B && m.sizeB <= AUTO_MAX_B)
      .sort((a, b) => a.sizeB - b.sizeB).map(m => m.name);
    if (!models.length) fail(`no installed models in the ${AUTO_MIN_B}B-${AUTO_MAX_B}B range (found: ${installed.map(m => `${m.name} ${m.sizeB ?? "?"}B`).join(", ") || "none"}). \`ollama pull llama3.2:1b\` to get started, or pass --models explicitly.`);
  } else {
    models = cfg.modelsArg.split(",").map(s => s.trim()).filter(Boolean);
    const known = new Set(installed.map(m => m.name));
    models.filter(m => !known.has(m)).forEach(m => console.log(`note: ${m} isn't in /api/tags — trying anyway (\`ollama pull ${m}\` if it errors)`));
  }

  const scen = buildScenarios();
  const plan = [];
  if (cfg.batteries.includes("banter")) plan.push(...scen.banter);
  if (cfg.batteries.includes("negotiation")) plan.push(...scen.negotiation);
  const totalCalls = models.length * plan.length * cfg.samples;
  console.log(`Model Arena — ${models.length} model(s) × ${plan.length} probe(s) × ${cfg.samples} sample(s) = ${totalCalls} calls`);
  console.log(`endpoint ${cfg.endpoint} (Ollama ${version}) · think ${cfg.think ? "on" : "off"} · options ${cfg.options ? JSON.stringify(cfg.options) : "game defaults"}\n`);

  const calls = [], skipped = [];
  for (const model of models) {
    process.stdout.write(`── ${model} … warming up`);
    const warmErr = await warmUp(cfg, model);
    if (warmErr) {
      console.log(` ✗ skipped (${warmErr})`);
      skipped.push({ model, reason: warmErr });
      continue;
    }
    console.log(" ✓");
    let consecutiveErrors = 0;
    for (const s of plan) {
      let passed = 0, errored = 0;
      for (let i = 0; i < cfg.samples; i++) {
        const body = { model, messages: s.messages, stream: true, think: cfg.think };
        if (cfg.options) body.options = cfg.options;
        const r = await streamChat(cfg, body);
        const rec = { model, battery: s.battery, scenarioId: s.id, sample: i };
        if (r.error) {
          errored++; consecutiveErrors++;
          Object.assign(rec, { error: r.error, pass: false, checks: {} });
        } else {
          consecutiveErrors = 0;
          const scored = s.battery === "banter" ? checkBanterReply(r.content, s) : checkNegotiationReply(r.content, s);
          if (scored.pass) passed++;
          Object.assign(rec, {
            raw: r.content, stripped: scored.stripped, thinking: r.thinking || undefined,
            pass: scored.pass, checks: scored.checks, failures: scored.failures, details: scored.details,
            ttftMs: r.ttftMs == null ? null : Math.round(r.ttftMs),
            tokPerSec: r.metrics && r.metrics.evalCount && r.metrics.evalDurationNs
              ? r.metrics.evalCount / (r.metrics.evalDurationNs / 1e9) : null,
            metrics: r.metrics,
          });
        }
        calls.push(rec);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      }
      console.log(`   ${s.id}  ${passed}/${cfg.samples}${errored ? ` (${errored} error${errored > 1 ? "s" : ""})` : ""}`);
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.log(`   ✗ abandoning ${model} after ${MAX_CONSECUTIVE_ERRORS} consecutive errors`);
        skipped.push({ model, reason: `abandoned mid-run after ${MAX_CONSECUTIVE_ERRORS} consecutive errors (last: ${calls[calls.length - 1].error})` });
        break;
      }
    }
    if (!cfg.keepLoaded) await unloadModel(cfg, model);
  }

  const meta = {
    date: new Date().toISOString(), endpoint: cfg.endpoint, ollamaVersion: version,
    think: cfg.think, samples: cfg.samples, options: cfg.options,
    batteries: cfg.batteries, modelsRequested: models, skipped,
    scenarioCounts: { banter: scen.banter.length, negotiation: scen.negotiation.length },
  };
  const summary = summarizeCalls(calls);
  const leaderboard = renderLeaderboard(summary, meta);

  const stamp = meta.date.replace(/[:T]/g, "-").replace(/\..+/, "");
  const dir = path.join(cfg.outDir, `run-${stamp}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "results.json"), JSON.stringify({ meta, summary, calls }, null, 2));
  fs.writeFileSync(path.join(dir, "leaderboard.md"), leaderboard);

  console.log(`\n${leaderboard}`);
  console.log(`Wrote ${path.join(dir, "results.json")} and ${path.join(dir, "leaderboard.md")}`);
  if (!summary.length) fail("no model produced a single scored call — see skip reasons above");
}

main().catch(e => fail(e && e.stack || String(e)));

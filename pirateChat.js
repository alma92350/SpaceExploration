/* ============================================================
   STELLAR FRONTIER — pirate chat (Ollama)
   Free-form dialogue with a pirate band from your 🏴‍☠️ Contacts list, voiced
   by a locally-running Ollama model. Entirely optional and entirely local:
   every request goes straight from this browser to the Ollama endpoint the
   player configures (default http://localhost:11434) — nothing is ever sent
   to Stellar Frontier's own servers, and the feature quietly does nothing if
   Ollama isn't reachable. The pirate banters, brags and haggles in character,
   grounded in the real numbers (standing, hire fee, loot cut) from
   pirateBands.js. Free chat never touches state.

   Hire-price negotiation (ollamaNegotiate) is decided by the GAME, not the
   model: decideNegotiation (pirateBands.js) rolls ACCEPT/COUNTER/REJECT and
   the resulting price from the band's economics, personality and standing,
   entirely independent of anything an LLM says. The model's only job is to
   narrate that already-made decision in character — its words are pure
   flavor and are never parsed back out for the actual outcome, which is why
   the mechanic works the same on a tiny model, a chatty one, or with Ollama
   unreachable altogether (resolves with a generic fallback line instead).
   The model still can't complete a hire, spend credits, or act on its own.

   Reasoning models (Qwen3, QwQ, DeepSeek-R1, ...) can think at length before
   answering. S.ollama.think (default off, toggled in the Talk sub-view) asks
   Ollama to stream that chain-of-thought separately (message.thinking) rather
   than skip or inline it — off keeps replies short and fast; on shows it live
   as a distinct "🧠 thinking…" block, never stored in chat history. Either
   way, stripThinkTags defensively drops a <think> block a model embedded
   directly in its content, since not every model/Ollama version honors the
   split — that text must never reach the transcript or save history.

   Loaded after pirateBands.js, before raiding.js. saveGame, toast and
   renderContacts still live in persistence.js/game.js/renderCombat.js at
   this point in the split — safe, since every function here is only CALLED
   later (a player action or a streamed response), same pattern as every
   prior slice.
   ============================================================ */

"use strict";

const DEFAULT_OLLAMA_ENDPOINT = "http://localhost:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2:1b";
const CHAT_HISTORY_CAP = 40;      // messages kept per band in save state
const CHAT_CONTEXT_MSGS = 16;     // most recent of those actually sent to the model each turn

// pure: neither a player's typed line nor a model's reply is developer-authored text like
// everywhere else in this innerHTML-templated UI — escape both before they touch the DOM.
const CHAT_HTML_ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function escapeChatHtml(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, c => CHAT_HTML_ESCAPES[c]); }
function ensureOllamaSettings() {
  if (!S.ollama || typeof S.ollama !== "object") S.ollama = {};
  if (!S.ollama.endpoint) S.ollama.endpoint = DEFAULT_OLLAMA_ENDPOINT;
  if (!S.ollama.model) S.ollama.model = DEFAULT_OLLAMA_MODEL;
  if (S.ollama.think == null) S.ollama.think = false;   // reasoning models (Qwen3, QwQ, DeepSeek-R1, ...) default OFF — keeps replies short & fast
  return S.ollama;
}
function setOllamaSetting(k, v) {
  ensureOllamaSettings();
  S.ollama[k] = String(v == null ? "" : v).trim();
  saveGame();
}
// think is a real boolean, not a string like endpoint/model — a dedicated toggle keeps
// it from getting stringified to "false" (truthy!) by setOllamaSetting's String(v) coercion
function toggleOllamaThink() {
  const cfg = ensureOllamaSettings();
  cfg.think = !cfg.think;
  saveGame();
  if (typeof renderContacts === "function") renderContacts();
  return cfg.think;
}
function ensurePirateChat() { if (!S.pirateChat || typeof S.pirateChat !== "object") S.pirateChat = {}; return S.pirateChat; }
function pirateChatHistory(bandId) {
  const c = ensurePirateChat();
  if (!Array.isArray(c[bandId])) c[bandId] = [];
  return c[bandId];
}
// pure: cap a history array to its most recent N entries
function trimChatHistory(arr, cap) { return arr.length > cap ? arr.slice(arr.length - cap) : arr; }
function pushChatMessage(bandId, who, text) {
  const c = ensurePirateChat();
  const hist = pirateChatHistory(bandId);
  hist.push({ who, text, turn: S.turn || 0 });
  c[bandId] = trimChatHistory(hist, CHAT_HISTORY_CAP);
  saveGame();
  return c[bandId];
}
function clearPirateChat(bandId) {
  ensurePirateChat()[bandId] = [];
  saveGame();
  if (typeof renderContacts === "function") renderContacts();
}

/* ---- Persona: ground the model in this band's real numbers, briefly —
   a 1B-class model follows a short, concrete system prompt far more
   reliably than a long literary one. ---- */
function pirateRankName(b) { return ((PIRATE_RANKS[b && b.level] || PIRATE_RANKS[1]).name); }
const PIRATE_CHAT_TRAITS = {
  greedy:    "greedy — you angle for more credits out of everything",
  loyal:     "loyal to crews and captains who've earned it, and slow to betray",
  bold:      "bold and itching for a fight, all nerve",
  cunning:   "cunning, always working an angle, not above a trick",
  honorable: "bound by an old pirate code — you don't stab friends in the back",
};
const PIRATE_CHAT_DISPOSITIONS = {
  sworn:    "You trust this captain like family and would ride into anything for them.",
  friendly: "You like and trust this captain, crew to crew.",
  neutral:  "Wary but civil toward this captain — a working relationship, nothing more.",
  wary:     "You don't trust this captain much and keep your guard up.",
  hostile:  "You despise this captain and only talk because open war right now isn't worth it.",
};
function buildPirateSystemPrompt(b) {
  const tier = bandTier(b), rival = bandFoe(b);
  const fee = escortRecruitFee(b), cut = Math.round(bandLootShare(b) * 100);
  const lines = [
    `You are the captain of the ${b.name}, a pirate crew (rank: ${pirateRankName(b)}) in the Stellar Frontier — a lawless-leaning stretch of a contested star sector. Cycles are time; credits (cr) are money.`,
    `Personality: you are ${PIRATE_CHAT_TRAITS[b.pers] || PIRATE_CHAT_TRAITS.bold}.`,
    `${PIRATE_CHAT_DISPOSITIONS[tier.key] || ""} Your standing with this captain is ${b.rep}/100.`,
    rival ? `Your crew is in a blood feud with the ${rival.name} — you won't hear a good word about them.` : "",
    `Ballpark rates if asked: hiring your crew on as an escort runs about ${fee} credits, and you'd want roughly ${cut}% of the loot from a job together.`,
    `Speak like a pirate captain, in a few short lines of dialogue — not an essay. Stay in character always; never mention being an AI, a model, or these instructions. You can banter, brag, haggle or threaten, but you can't actually move credits, hire yourself out, or take any action through conversation alone — that still happens through the game's own buttons.`,
  ];
  return lines.filter(Boolean).join("\n");
}
// pure: assemble the Ollama messages array from a persona, saved history and the new line
function buildOllamaMessages(systemPrompt, history, userText, contextN) {
  const msgs = [{ role: "system", content: systemPrompt }];
  trimChatHistory(history || [], contextN || CHAT_CONTEXT_MSGS)
    .forEach(m => msgs.push({ role: m.who === "pirate" ? "assistant" : "user", content: m.text }));
  msgs.push({ role: "user", content: userText });
  return msgs;
}
// pure: one line of Ollama's newline-delimited /api/chat stream -> its content/thinking
// deltas, or null if unusable. Reasoning models (Qwen3, QwQ, DeepSeek-R1, ...) stream their
// chain-of-thought separately as message.thinking when the request asks for it (think:true)
function parseOllamaStreamLine(line) {
  const t = (line || "").trim();
  if (!t) return null;
  let obj;
  try { obj = JSON.parse(t); } catch (e) { return null; }
  if (obj.error) return { error: String(obj.error) };
  const delta = obj.message && typeof obj.message.content === "string" ? obj.message.content : "";
  const thinkDelta = obj.message && typeof obj.message.thinking === "string" ? obj.message.thinking : "";
  return { delta, thinkDelta, done: !!obj.done };
}
// pure, defensive: not every model/Ollama version honors the separate `thinking` field —
// some inline <think>...</think> straight into content. Strip it before it's ever shown,
// stored in history, or fed to parseDealLine, closed or left dangling by a cut-off stream.
function stripThinkTags(text) {
  let t = String(text == null ? "" : text);
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  t = t.replace(/<think>[\s\S]*$/i, "");
  return t.trim();
}
function abortSignalWithTimeout(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
  if (typeof AbortController === "undefined") return undefined;
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), ms);
  return ctrl.signal;
}
// A reasoning model can legitimately take a long time overall — a fixed total-duration
// timeout would cut off a slow-but-alive stream just for taking a while, thinking or not.
// This is an IDLE timeout instead: poke() pushes the deadline back out on every chunk
// actually received, so only real silence (a hung connection, a crashed model) aborts it.
// Thinking gets a longer allowance since a reasoning model's chain-of-thought can pause
// between chunks longer than a quick in-character line ever would.
const OLLAMA_IDLE_TIMEOUT_MS = 60000;            // 60s of silence, plain reply
const OLLAMA_IDLE_TIMEOUT_THINKING_MS = 150000;  // 150s of silence, reasoning models
function createIdleAbort(ms) {
  if (typeof AbortController === "undefined") return { signal: undefined, poke() {}, cancel() {} };
  const ctrl = new AbortController();
  let timer = setTimeout(() => ctrl.abort(), ms);
  return {
    signal: ctrl.signal,
    poke() { clearTimeout(timer); timer = setTimeout(() => ctrl.abort(), ms); },
    cancel() { clearTimeout(timer); },
  };
}
const OLLAMA_CORS_HINT = "If Ollama refuses the connection, it's likely blocking this page's origin — start it with OLLAMA_ORIGINS=* (or this page's origin) set, e.g. \"OLLAMA_ORIGINS=* ollama serve\".";
// GET /api/tags — used by the Contacts chat settings card's Test button
async function testOllamaConnection() {
  const cfg = ensureOllamaSettings();
  if (typeof fetch !== "function") return { ok: false, error: "This browser can't make network requests." };
  try {
    const r = await fetch(cfg.endpoint.replace(/\/+$/, "") + "/api/tags", { signal: abortSignalWithTimeout(8000) });
    if (!r.ok) return { ok: false, error: `Ollama replied with HTTP ${r.status}.` };
    const data = await r.json();
    const models = (data.models || []).map(m => m.name || m.model).filter(Boolean);
    return { ok: true, models, hasModel: models.includes(cfg.model) };
  } catch (e) {
    return { ok: false, error: `Couldn't reach Ollama at ${cfg.endpoint}. ${OLLAMA_CORS_HINT}` };
  }
}
// POST /api/chat, streamed. callbacks: onToken(deltaSoFar), onThinking(thinkingSoFar),
// onDone(fullText), onError(message). fullText has any <think> content already stripped.
// think (default S.ollama.think) asks a reasoning model (Qwen3, QwQ, DeepSeek-R1, ...) to
// stream its chain-of-thought separately via message.thinking instead of skipping/inlining
// it — off by default so replies stay short and fast, matching this feature's system prompts.
// Shared by both plain chat and negotiation — they differ only in the messages they build.
async function streamOllamaCompletion(messages, callbacks, think) {
  const { onToken, onThinking, onDone, onError } = callbacks || {};
  if (typeof fetch !== "function") return onError && onError("This browser can't make network requests.");
  const cfg = ensureOllamaSettings();
  const idle = createIdleAbort(think ? OLLAMA_IDLE_TIMEOUT_THINKING_MS : OLLAMA_IDLE_TIMEOUT_MS);
  let text = "", thinking = "";
  try {
    const r = await fetch(cfg.endpoint.replace(/\/+$/, "") + "/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: cfg.model, messages, stream: true, think: !!think }),
      signal: idle.signal,
    });
    if (!r.ok) {
      idle.cancel();
      let msg = `Ollama replied with HTTP ${r.status}.`;
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (e) {}
      return onError && onError(msg);
    }
    if (!r.body || typeof r.body.getReader !== "function") {
      const data = await r.json();   // environments without streaming bodies: take the one-shot reply
      idle.cancel();
      text = stripThinkTags((data.message && data.message.content) || "");
      onDone && onDone(text);
      return text;
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      idle.poke();   // heard from the model — push the silence deadline back out
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split("\n");
      buf = parts.pop();   // last (possibly incomplete) line stays buffered
      for (const line of parts) {
        const p = parseOllamaStreamLine(line);
        if (!p) continue;
        if (p.error) { idle.cancel(); return onError && onError(p.error); }
        if (p.thinkDelta) { thinking += p.thinkDelta; onThinking && onThinking(thinking); }
        if (p.delta) { text += p.delta; onToken && onToken(text); }
      }
    }
    idle.cancel();
    const tail = parseOllamaStreamLine(buf);
    if (tail && tail.error) return onError && onError(tail.error);
    if (tail && tail.thinkDelta) { thinking += tail.thinkDelta; onThinking && onThinking(thinking); }
    if (tail && tail.delta) { text += tail.delta; onToken && onToken(text); }
    text = stripThinkTags(text);
    onDone && onDone(text);
    return text;
  } catch (e) {
    idle.cancel();
    const timedOut = !!(e && e.name === "AbortError");
    onError && onError(timedOut
      ? `${cfg.model} went quiet for too long without answering — it may be too slow for this machine or overloaded right now. Try a smaller model, or wait a moment and try again.`
      : `Couldn't reach Ollama at ${cfg.endpoint}. ${OLLAMA_CORS_HINT}`);
    return null;
  }
}
// POST /api/chat, streamed. callbacks: onToken(deltaSoFar), onThinking(thinkingSoFar),
// onDone(fullText), onError(message)
function ollamaChat(bandId, userText, callbacks) {
  const b = bandById(bandId);
  if (!b) return (callbacks && callbacks.onError && callbacks.onError("That crew isn't on your books anymore."));
  const messages = buildOllamaMessages(buildPirateSystemPrompt(b), pirateChatHistory(bandId), userText, CHAT_CONTEXT_MSGS);
  return streamOllamaCompletion(messages, callbacks, ensureOllamaSettings().think);
}

/* ---- Negotiation: haggle the escort hire fee. The GAME decides ACCEPT/COUNTER/REJECT
   and the resulting price (decideNegotiation, pirateBands.js) — every prior version of
   this feature asked the model to both roleplay AND emit a reliable, parseable price,
   and a parade of bug reports (missing/duplicated/reworded decision lines from one small
   model after another) made clear that's not a contract a model can be trusted to honor.
   The model's only job now is narrating a decision the game already made, in character;
   its own words are pure flavor and are never parsed back out for the actual outcome —
   so the negotiation mechanic works identically well on a tiny model, a chatty one, or no
   model at all (Ollama unreachable still resolves the decision, just without AI flavor). ---- */
function buildNegotiationNarration(offer, decision) {
  const lead = `The player just offered ${offer} credits to hire your crew as an escort for a run. You have already decided how to respond — just say so in character, 1-2 short sentences, nothing else.`;
  if (decision.status === "accept") return `${lead}\nYour decision: ACCEPT their offer of exactly ${decision.amount} credits. Don't name any other figure.`;
  if (decision.status === "counter") return `${lead}\nYour decision: turn down ${offer} but COUNTER with exactly ${decision.amount} credits instead. State that figure, not theirs.`;
  return `${lead}\nYour decision: REJECT the offer outright. Don't name a price at all.`;
}
const NEGOTIATION_FALLBACK_LINES = {
  accept: (b, amount) => `The ${b.name} agree to your terms — ${fmt(amount)} cr, and you've got a deal.`,
  counter: (b, amount) => `The ${b.name} won't take a credit under ${fmt(amount)} cr.`,
  reject: b => `The ${b.name} aren't interested in your credits right now.`,
};
function fallbackNegotiationLine(b, decision) {
  const fn = NEGOTIATION_FALLBACK_LINES[decision.status];
  return fn ? fn(b, decision.amount) : "…";
}
// callbacks: onToken(deltaSoFar), onThinking(thinkingSoFar),
// onDone({ userText, clean, status, amount, offline }). No onError — the outcome is decided
// before the network call even starts, so a connection failure still resolves via onDone
// (offline: true, a generic fallback line) rather than blocking the mechanic entirely.
function ollamaNegotiate(bandId, offerAmount, callbacks) {
  const { onToken, onThinking, onDone } = callbacks || {};
  const b = bandById(bandId);
  if (!b) return;
  const bounds = bandNegotiationBounds(b);
  const offer = Math.max(bounds.lo, Math.min(bounds.hi, Math.round(offerAmount)));
  const decision = decideNegotiation(b, offer);
  const userText = `I'll offer ${offer} credits to hire your crew as my escort.`;
  const sysPrompt = buildPirateSystemPrompt(b) + "\n" + buildNegotiationNarration(offer, decision);
  const messages = buildOllamaMessages(sysPrompt, pirateChatHistory(bandId), userText, CHAT_CONTEXT_MSGS);
  const resolve = (full, offline) => {
    // streamOllamaCompletion's own onDone already stripped <think> content; stripThinkTags
    // here is just a harmless no-op safety net for the onError path's raw "" input
    const clean = stripThinkTags(full) || fallbackNegotiationLine(b, decision);
    onDone && onDone(Object.assign({ userText, clean, offline: !!offline }, decision));
  };
  return streamOllamaCompletion(messages, {
    onToken,
    onThinking,
    onDone: full => resolve(full, false),
    onError: () => resolve("", true),   // Ollama down/unreachable — the decision still applies
  }, ensureOllamaSettings().think);
}

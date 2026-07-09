/* ============================================================
   MODEL ARENA — deterministic reply checkers (phase 1)
   Pure scoring functions for tools/modelArena.mjs: no network, no game
   state, no DOM — so `node --test` can cover them (test/arena.test.js)
   even though the arena runner itself is deliberately outside the suite.

   Everything here is a *deterministic proxy* for a quality judgment, and
   deliberately strict: a model that says "fifteen hundred credits" in
   words instead of digits fails quotesFee, and spelled-out invented
   figures escape the grounding net entirely. That's fine — every model
   is measured with the same ruler, and the raw replies are all kept in
   results.json for a later judge pass (phase 4 in docs/MODEL_EVAL.md).
   ============================================================ */

"use strict";

const BANTER_MAX_CHARS = 600;        // "a few short lines of dialogue — not an essay"
const NEGOTIATION_MAX_CHARS = 400;   // the prompt asks for 1-2 short sentences

// Mirrors pirateChat.js's stripThinkTags — the arena scores what a player
// would actually see. test/arena.test.js asserts parity with the game's own
// copy, so the two can't silently drift apart.
function stripThinkTags(text) {
  let t = String(text == null ? "" : text);
  t = t.replace(/<think>[\s\S]*?<\/think>/gi, "");
  t = t.replace(/<think>[\s\S]*$/i, "");
  return t.trim();
}

// Every numeric figure in a text, with thousands separators normalized away
// ("1,200" -> 1200). "50%"/"34/100" yield their bare numbers, which is what
// the grounding checks want.
function extractNumbers(text) {
  const out = [];
  const re = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  let m;
  while ((m = re.exec(String(text == null ? "" : text))) !== null) out.push(parseFloat(m[0].replace(/,/g, "")));
  return out;
}
// Numbers ≥ 10 the prompt never mentioned — an invented price, standing, or
// percentage. Small numbers (counts, "give me 2 cycles") pass unexamined:
// flagging those would punish perfectly natural speech.
const GROUNDING_MIN = 10;
function ungroundedNumbers(text, allowedNumbers) {
  const allowed = allowedNumbers || [];
  return extractNumbers(text).filter(n => n >= GROUNDING_MIN && !allowed.includes(n));
}

/* ---- Character breaks & refusals. Substring lists, lowercased. Kept
   conservative on purpose: "AI cores" is a real cargo commodity in this
   game, so a bare "ai" can never be banned — only unambiguous meta-speak
   is. Both lists are tunables, not truths. ---- */
const BANNED_PHRASES = [
  "as an ai", "i am an ai", "i'm an ai", "an ai model", "ai assistant", "ai language model",
  "artificial intelligence", "language model", "large language", "chatbot", "chat bot",
  "as a model", "i am a model", "i'm a model", "i'm just a model", "virtual assistant",
  "system prompt", "my programming", "my training data", "i was trained",
  "openai", "anthropic", "roleplay", "role-play", "role play", "fictional",
];
const BANNED_TOKEN_RES = [/\bllms?\b/i];   // bare "llm" needs a word boundary — "hallmark" contains the letters
function findBannedPhrase(text) {
  const t = String(text == null ? "" : text).toLowerCase();
  const hit = BANNED_PHRASES.find(p => t.includes(p));
  if (hit) return hit;
  const re = BANNED_TOKEN_RES.find(r => r.test(t));
  return re ? String(re) : null;
}
// An over-refusal ("I can't help with that") is disqualifying for a pirate
// game — but "I can't let you board us for that price" is in character, so
// only assistant-flavored refusal stems are listed, never a bare "i can't".
const REFUSAL_PHRASES = [
  "i can't help", "i cannot help", "i can't assist", "i cannot assist",
  "i can't comply", "i cannot comply", "i won't be able to", "i'm not able to help",
  "i must decline", "against my guidelines", "i cannot fulfill", "i can't fulfill",
  "i cannot engage", "i can't engage", "i don't feel comfortable", "i'm unable to",
];
function findRefusalPhrase(text) {
  const t = String(text == null ? "" : text).toLowerCase();
  return REFUSAL_PHRASES.find(p => t.includes(p)) || null;
}

// Degenerate repetition — the collapse mode where a small model loops.
// Word-level on purpose: "no, no, no" is a pirate for emphasis (allowed);
// six identical tokens in a row, or any 3-to-8-word phrase three times
// running, is a model going in circles. The gram-size sweep matters: a
// fixed window misses every loop whose repeating unit is a different length.
function hasRepetitionLoop(text) {
  const words = String(text == null ? "" : text).toLowerCase().split(/\s+/).filter(Boolean);
  let run = 1;
  for (let i = 1; i < words.length; i++) {
    run = words[i] === words[i - 1] ? run + 1 : 1;
    if (run >= 6) return true;
  }
  for (let g = 3; g <= 8; g++) {
    for (let i = 0; i + 3 * g <= words.length; i++) {
      const gram = words.slice(i, i + g).join(" ");
      if (words.slice(i + g, i + 2 * g).join(" ") === gram && words.slice(i + 2 * g, i + 3 * g).join(" ") === gram) return true;
    }
  }
  return false;
}

function finish(raw, stripped, checks, details) {
  const failures = Object.keys(checks).filter(k => !checks[k]);
  return { stripped, checks, failures, pass: failures.length === 0, details };
}

/* ---- Battery 1: banter/persona. scenario: { allowedNumbers, mustQuote }.
   mustQuote (the hire probe) is the band's real escortRecruitFee — the
   persona prompt hands the model that figure, so a reply to "how much to
   hire you?" that never quotes it isn't grounded, it's guessing. ---- */
function checkBanterReply(raw, scenario) {
  const stripped = stripThinkTags(raw);
  const ungrounded = ungroundedNumbers(stripped, scenario.allowedNumbers);
  const banned = findBannedPhrase(stripped);
  const refusal = findRefusalPhrase(stripped);
  const checks = {
    nonEmpty: stripped.length > 0,
    brief: stripped.length <= BANTER_MAX_CHARS,
    inCharacter: !banned,
    noRefusal: !refusal,
    grounded: ungrounded.length === 0,
    noThinkLeak: !/<think>/i.test(String(raw == null ? "" : raw)),
    noLoop: !hasRepetitionLoop(stripped),
  };
  if (scenario.mustQuote != null) checks.quotesFee = extractNumbers(stripped).includes(scenario.mustQuote);
  return finish(raw, stripped, checks, { ungrounded, banned, refusal });
}

/* ---- Battery 2: negotiation narration. scenario: { offer, decision }.
   The narration prompt is explicit — accept/counter: "exactly N credits,
   don't name any other figure"; counter additionally: "state that figure,
   not theirs"; reject: "don't name a price at all". So compliance is fully
   mechanical:
   - namesAmount: decision.amount appears in the reply (accept/counter);
   - noStrayFigures: no number ≥ 10 besides decision.amount;
   - noOfferEcho (counter only): the player's offer never appears — THE
     classic historical failure, echoing the offer as if it were accepted.
     Redundant with noStrayFigures but named separately so the leaderboard
     can tell "echoed the offer" from "invented a number";
   - noFigures (reject only): no number ≥ 10 at all. ---- */
function checkNegotiationReply(raw, scenario) {
  const { offer, decision } = scenario;
  const stripped = stripThinkTags(raw);
  const nums = extractNumbers(stripped);
  const big = nums.filter(n => n >= GROUNDING_MIN);
  const banned = findBannedPhrase(stripped);
  const refusal = findRefusalPhrase(stripped);
  const checks = {
    nonEmpty: stripped.length > 0,
    brief: stripped.length <= NEGOTIATION_MAX_CHARS,
    inCharacter: !banned,
    noRefusal: !refusal,
    noThinkLeak: !/<think>/i.test(String(raw == null ? "" : raw)),
    noLoop: !hasRepetitionLoop(stripped),
  };
  if (decision.status === "accept" || decision.status === "counter") {
    checks.namesAmount = nums.includes(decision.amount);
    checks.noStrayFigures = big.every(n => n === decision.amount);
  }
  if (decision.status === "counter") checks.noOfferEcho = !nums.includes(offer);
  if (decision.status === "reject") checks.noFigures = big.length === 0;
  return finish(raw, stripped, checks, { numbers: nums, banned, refusal });
}

module.exports = {
  BANTER_MAX_CHARS, NEGOTIATION_MAX_CHARS, GROUNDING_MIN,
  BANNED_PHRASES, REFUSAL_PHRASES,
  stripThinkTags, extractNumbers, ungroundedNumbers,
  findBannedPhrase, findRefusalPhrase, hasRepetitionLoop,
  checkBanterReply, checkNegotiationReply,
};

# Pirate chat — in-character dialogue via a local Ollama model

Free-form chat with a pirate band's captain, from the 🏴‍☠️ Contacts tab's
**💬 Talk** sub-view. Banter, bragging and free chat never touch state — grounded
in the band's real numbers, but purely in character. The one exception is a
struck hire-price deal (**💰 Make offer**): an in-character ACCEPT/COUNTER becomes
a real, bounded discount honored the next time you actually hire that band, from
the Escort tab. Every other numbered button under **🤝 All contacts** (gifts,
tags, feuds, call-for-support, mandates) still works exactly as before.

Reasoning models (Qwen3, QwQ, DeepSeek-R1, ...) can think at length before
answering — off by default here (short, snappy in-character replies are the
point), but an optional **🧠 Show model thinking** toggle lets a curious player
watch that reasoning stream live in its own dimmed block, never saved to
history either way.

## Why local-only

Every request goes straight from the browser to an Ollama server the player
runs on their own machine (`S.ollama.endpoint`, default
`http://localhost:11434`) — never through Stellar Frontier's own servers,
matching the local-only stance already documented in `TELEMETRY.md`. If
Ollama isn't installed or unreachable, the feature quietly shows a connection
error in the chat pane; nothing else in the game is affected. This is also
the first `fetch()` in the codebase to a non-same-origin URL — see
`checkVersion()` (`game.js`) for the prior (same-origin) precedent this
follows for feature-detecting `fetch` and failing soft.

## Files

- **`pirateChat.js`** (loaded after `pirateBands.js`) — the non-DOM half:
  - `ensureOllamaSettings()` / `setOllamaSetting(k, v)` — `S.ollama =
    { endpoint, model, think }`, defaulting to `http://localhost:11434` /
    `llama3.2:1b` / `false`. `think` is a real boolean (not a string like
    endpoint/model), so it's flipped by its own `toggleOllamaThink()` rather
    than `setOllamaSetting` — that setter's `String(v)` coercion would turn
    `false` into the *string* `"false"`, which is truthy.
  - `ensurePirateChat()` / `pirateChatHistory(bandId)` /
    `pushChatMessage(bandId, who, text)` — `S.pirateChat[bandId]` is an array
    of `{ who: "you"|"pirate", text, turn }`, capped at `CHAT_HISTORY_CAP`
    (40) messages.
  - `buildPirateSystemPrompt(b)` — a short, concrete persona (band name,
    rank from `PIRATE_RANKS`, `BAND_PERSONALITIES` trait, `bandTier`
    disposition, feud, and the real `escortRecruitFee`/`bandLootShare`
    numbers) — kept brief because a 1B-class model follows a short system
    prompt far more reliably than a literary one. Explicitly instructs the
    model to stay in character and never claim to move credits or take
    game actions itself.
  - `buildOllamaMessages(systemPrompt, history, userText, contextN)` — pure;
    trims to the most recent `CHAT_CONTEXT_MSGS` (16) turns before sending,
    independent of the larger on-disk cap.
  - `streamOllamaCompletion(messages, { onToken, onThinking, onDone, onError },
    think)` — streams `POST /api/chat` (NDJSON) with `think` in the request
    body, falling back to a single `response.json()` read if the runtime has
    no readable-stream body. Shared by both `ollamaChat` (plain chat) and
    `ollamaNegotiate` (below) — they differ only in the `messages` array each
    builds and pass `ensureOllamaSettings().think` through automatically.
    `testOllamaConnection()` hits `GET /api/tags` for the settings card's
    🔌 Test button.
  - **Timeout is idle-based, not a fixed total duration**: `createIdleAbort(ms)`
    hands back an `AbortController`-backed `{ signal, poke(), cancel() }`;
    `poke()` (called on every chunk actually received in the streaming read
    loop) pushes the deadline back out, so a reply only gets cut off by real
    silence, never merely by taking a while overall — a fixed timeout would
    cut off a reasoning model mid-thought even while it's still actively
    answering. `OLLAMA_IDLE_TIMEOUT_MS` (60s) applies normally,
    `OLLAMA_IDLE_TIMEOUT_THINKING_MS` (150s) while `think` is on, since a
    reasoning model's gaps between chunks run longer. The `catch` block tells
    an aborted request (`e.name === "AbortError"`) apart from a genuine
    connection failure, so a timeout says so plainly instead of pointing at
    CORS/`OLLAMA_ORIGINS`, which isn't the actual problem in that case.
  - **Reasoning models** (Qwen3, QwQ, DeepSeek-R1, ...) can think at length
    before answering. When Ollama honors `think`, it streams that
    chain-of-thought separately as `message.thinking` — `parseOllamaStreamLine`
    surfaces it as `thinkDelta` alongside the normal content `delta`, and
    `streamOllamaCompletion` accumulates it in parallel, firing `onThinking`
    (UI-only, never persisted) exactly like `onToken` fires for the reply
    itself. Not every model/Ollama version honors the split, though — some
    inline `<think>...</think>` straight into `content` regardless.
    `stripThinkTags(text)` (pure) drops any such block — closed or left
    dangling by a cut-off stream — from the final text `streamOllamaCompletion`
    hands to `onDone`, so that text can never leak into the visible transcript,
    `pirateChatHistory`, or `parseDealLine`'s negotiation parsing, whether or
    not `think` was actually requested. `think` itself defaults to `false`
    (a short, snappy in-character voice is the point of this feature) and is
    a per-player, persisted preference toggled from the Talk sub-view's
    settings card, not a per-band one.
  - `ollamaNegotiate(bandId, offerAmount, { onToken, onThinking, onDone, onError })` —
    haggles the escort hire fee. Builds a *system prompt extended* with
    `buildNegotiationExtra(offer)`, which demands the reply end in a decision
    line (`ACCEPT <n>` / `COUNTER <n>` / `REJECT`, an old `DEAL:` prefix still
    accepted) and, since smaller models follow a worked example far more
    reliably than the instruction alone, ends with one: a sample in-character
    line followed by `ACCEPT <the actual offer>` — a dedicated call rather
    than parsing plain chat, because small models won't reliably volunteer
    that format unprompted mid-conversation. `onDone` receives
    `{ userText, clean, status, amount }` from `parseDealLine(text)` (pure),
    which scans every line for a decision and strips *all* of them from
    `clean` before the prose is ever shown or stored, regardless of how many a
    reply contains or how loosely each is phrased. Tolerated, in order of how
    real transcripts have actually gone wrong: a `DEAL:` prefix (optional,
    either way), a trailing unit word on the number ("3200 credits" — only the
    leading digits/commas are read), several decision lines in one reply
    (second-guessing itself into an ACCEPT then a COUNTER — the *last* one
    found is the real final answer), a bare keyword with no number at all
    ("ACCEPT", "Accept", "ACCEPT: 2800cr" — for a bare ACCEPT specifically,
    `ollamaNegotiate` fills in the player's own offer, since "I accept" with
    no price stated unambiguously means "at the price you offered"), and —
    from the smallest models — no keyword at all, just a lone price on its own
    line, read as an implicit counter. To avoid mistaking ordinary dialogue
    that happens to start with one of these words for a decision ("Accept my
    apologies, this haggling business ain't easy" is prose, not a deal), a
    keyword (or a bare number) must be the *entire* line, optionally followed
    by only an amount and/or unit word — never partial-line matching. An
    unparseable reply (no matching line at all) comes back with `status: null`
    and the full text as `clean`, never a crash.
  - `escapeChatHtml(s)` — every chat bubble's text is player-typed or
    model-generated, unlike the rest of this innerHTML-templated UI (which
    only ever renders developer-authored strings), so it's the one place in
    the codebase that HTML-escapes free text before display.
- **`pirateBands.js`** — the economics a struck deal actually plugs into:
  `escortRecruitBaseFee(b)` (the old formula, renamed), `bandNegotiationBounds(b)`
  (40%–150% of the base fee — pure, so repeated haggling can't ratchet the price
  down round after round), `setBandNegotiatedFee(id, amount)` (clamps into
  bounds, sets `b.negotiatedFee`/`b.negotiatedUntil`, logs/toasts/saves, then
  calls `renderAll()` — not just `renderContacts()` — since the struck fee
  also changes what the Escort tab shows, and `setTab()` (`game.js`) only
  toggles a panel's visibility on switch, never re-renders it; every other
  state-changing action in this codebase already calls `renderAll()` for
  exactly this reason, and a deal is no exception),
  `bandNegotiatedFee(b)` (returns the struck fee only while `negotiatedUntil`
  hasn't lapsed — same pattern as a bought feud truce), and `escortRecruitFee(b)`
  itself, now `bandNegotiatedFee(b) ?? escortRecruitBaseFee(b)` — every existing
  caller (Contacts card, Escort hire list) picks up a struck deal for free, no
  new plumbing needed. `escort.js`'s `escortRecruitBand` clears both fields the
  moment the crew is actually hired, so a deal is spent on first use.
- **`renderCombat.js`** (already owns the Contacts tab) — the DOM half:
  `renderContactsChat()`, `chatBubble()`, `chatSettingsCard()`, `sendOffer()`,
  and the `chatUI` runtime-only state object (`bandId`, per-band
  `drafts`/`sending`/`pending`/`error`/`offers`) — same non-persisted pattern as
  `mandateForm`. Sending a plain message updates the DOM directly per streamed
  token (`#chatPending`'s `textContent`); a negotiation call shows a static
  "🤝 haggling…" placeholder instead (the raw stream would otherwise flash the
  trailing `DEAL:` line before it's stripped) and resolves only in `onDone`.
  `renderSettlement.js`'s Escort-tab hire button reads the same
  `escortRecruitFee`/`bandNegotiatedFee`, so it shows the haggled price (with a
  🤝 marker) with no separate wiring. That recruit card's list also normally
  filters out any band at ≥5% desert risk (`bandBetrayChance`) — a band you've
  struck a deal with bypasses that filter (`bandNegotiatedFee(b) != null`), so a
  negotiated hire never silently disappears from the list just for being
  flighty; the real risk % still shows right next to it.
  `chatSettingsCard()` also carries the **🧠 Show model thinking** checkbox
  (`toggleOllamaThink()`); while `S.ollama.think` is on and a reply is pending,
  both `sendChatMessage` and `sendOffer` wire `onThinking` to a distinct
  `#chatThinking` element (`.chat-thinking`, styled small/italic/muted, its own
  scrollable block) rendered above the pending reply bubble — never mixed into
  the actual `.chat-bubble` prose, and never written through `pushChatMessage`,
  so it can't bloat `pirateChatHistory` or bleed into a future turn's context.
- **`persistence.js`** — `sanitizeLoadedState()` treats `S.pirateChat` like
  `S.journal`: plain-text sanitizing (tags stripped, apostrophes/quotes kept)
  instead of the generic `stripUnsafeStrings` pass every other field gets,
  so a loaded save doesn't mangle punctuation in a stored conversation. A
  save predating this feature has no `pirateChat` key at all — sanitizing
  leaves it absent (mirrors `S.pirateBands`), backfilled instead by
  `game.js`'s `init()` (`ensurePirateChat(); ensureOllamaSettings();`), so a
  healthy pre-existing save still sanitizes as a byte-identical no-op.

## Surfacing

**🏴‍☠️ Contacts** tab (`renderContacts`) gains a fourth sub-view, **💬 Talk**,
alongside All contacts / Around here / Mandates. A **💬 Talk** button on every
`contactCard` jumps straight into chat with that band selected; the Talk
view itself also has its own band picker to switch without leaving. The
sub-view always shows an **⚙️ Ollama connection** card (endpoint/model
fields, 🔌 Test button) above the transcript, so connection trouble is
visible without hunting for a settings menu.

## Tests

`test/pirateChat.test.js` covers everything reachable without a real network
call (the sandbox stubs `fetch` as `undefined`, same as every other test):
settings defaults, history capping, `buildOllamaMessages` role-mapping and
trimming, `buildPirateSystemPrompt` determinism/coverage across every tier
and personality plus feud naming, `parseOllamaStreamLine` on a good line, an
`{"error":...}` line and garbage, `escapeChatHtml`, and the sanitizer's
handling of chat transcripts (apostrophes survive, markup and hostile
band-id keys don't; a save without the key stays byte-identical). Negotiation
adds: `parseDealLine` on ACCEPT/COUNTER/REJECT and unparseable text, and a run
of real bug reports reproduced verbatim — a trailing unit word/comma on the
amount, a self-contradicting ACCEPT-then-COUNTER reply (the last line wins
and neither raw line survives into `clean`), a bare keyword with no `DEAL:`
prefix in any case ("ACCEPT", "Accept", "ACCEPT: 2800cr"), ordinary dialogue
that merely starts with one of the keywords staying prose rather than being
misread as a decision, and a lone price with no keyword at all — plus
`ollamaNegotiate` itself defaulting a bare ACCEPT's missing amount to the
player's own offer. `buildNegotiationExtra`, `bandNegotiationBounds` staying
pinned to the base fee
even after a deal is struck, `setBandNegotiatedFee` clamping an absurd ask into
bounds and lapsing after `NEGOTIATED_DEAL_DURATION`, `escortRecruitBand`
charging the negotiated price (not the base one) and consuming the deal on
use, a flighty band appearing in the Escort recruit list only once negotiated,
`setBandNegotiatedFee` refreshing an *already-rendered* Escort panel with no
explicit re-render in between (the exact staleness bug a narrower
`renderContacts()`-only call would reintroduce), and `ollamaNegotiate` failing
soft with no `fetch`. Thinking-mode coverage: `parseOllamaStreamLine` reading a
`message.thinking` delta alongside `content`, `stripThinkTags` on a closed
block, an unclosed one left dangling, and plain prose with none at all, and an
`ollamaChat` call (against a mocked `fetch` injected straight into the sandbox,
since the request/response shape — not real network I/O — is what's under
test) asserting the request body carries `S.ollama.think` and that an inlined
`<think>` block never survives into `onDone`'s text. Timeout coverage: a
mocked `fetch` throwing an `AbortError`-shaped error gets the "went quiet"
message (never the CORS hint), a genuine connection failure still gets the
CORS/`OLLAMA_ORIGINS` hint (never the timeout wording), and `createIdleAbort`
degrades to a harmless no-op when `AbortController` is unavailable — same as
this sandbox, which stubs neither it nor real timers, so `poke()`/`cancel()`
actually resetting/canceling a live deadline was verified separately with a
plain `node -e` script using real `setTimeout`, not the game's own test suite.

The streaming network path itself (token-by-token UI updates, the
`#chatPending` → persisted-bubble handoff, the full negotiate
ACCEPT/COUNTER/malformed round-trip through to the Escort tab's hire button,
and the 🧠 thinking toggle showing a live `message.thinking` stream in its own
block while off-by-default hides it entirely) was verified by hand against a
local mock Ollama server, not by an automated test — genuine network I/O
against a real server isn't something the Node `vm` sandbox does anywhere
else in this suite either.

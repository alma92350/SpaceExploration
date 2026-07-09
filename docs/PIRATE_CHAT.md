# Pirate chat — in-character dialogue via a local Ollama model

Free-form chat with a pirate band's captain, from the 🏴‍☠️ Contacts tab's
**💬 Talk** sub-view. Banter, bragging and free chat never touch state — grounded
in the band's real numbers, but purely in character. The one exception is a
struck hire-price deal (**💰 Make offer**): an in-character ACCEPT/COUNTER becomes
a real, bounded discount honored the next time you actually hire that band, from
the Escort tab. Every other numbered button under **🤝 All contacts** (gifts,
tags, feuds, call-for-support, mandates) still works exactly as before.

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
    { endpoint, model }`, defaulting to `http://localhost:11434` /
    `llama3.2:1b`.
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
  - `streamOllamaCompletion(messages, { onToken, onDone, onError })` — streams
    `POST /api/chat` (NDJSON), falling back to a single `response.json()`
    read if the runtime has no readable-stream body. Shared by both
    `ollamaChat` (plain chat) and `ollamaNegotiate` (below) — they differ only
    in the `messages` array each builds. `testOllamaConnection()` hits
    `GET /api/tags` for the settings card's 🔌 Test button.
  - `ollamaNegotiate(bandId, offerAmount, { onToken, onDone, onError })` —
    haggles the escort hire fee. Builds a *system prompt extended* with
    `buildNegotiationExtra(offer)`, which demands the reply end in a strict,
    machine-parseable line (`DEAL: ACCEPT <n>` / `DEAL: COUNTER <n>` /
    `DEAL: REJECT`) — a dedicated call rather than parsing plain chat, because
    a 1B-class model won't reliably volunteer that format unprompted mid-
    conversation. `onDone` receives `{ userText, clean, status, amount }` from
    `parseDealLine(text)` (pure), which strips the machine line off before the
    prose is ever shown or stored — an unparseable reply just comes back with
    `status: null` and the full text as `clean`, never a crash.
  - `escapeChatHtml(s)` — every chat bubble's text is player-typed or
    model-generated, unlike the rest of this innerHTML-templated UI (which
    only ever renders developer-authored strings), so it's the one place in
    the codebase that HTML-escapes free text before display.
- **`pirateBands.js`** — the economics a struck deal actually plugs into:
  `escortRecruitBaseFee(b)` (the old formula, renamed), `bandNegotiationBounds(b)`
  (40%–150% of the base fee — pure, so repeated haggling can't ratchet the price
  down round after round), `setBandNegotiatedFee(id, amount)` (clamps into
  bounds, sets `b.negotiatedFee`/`b.negotiatedUntil`, logs/toasts/saves),
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
adds: `parseDealLine` on ACCEPT/COUNTER/REJECT and unparseable text,
`buildNegotiationExtra`, `bandNegotiationBounds` staying pinned to the base fee
even after a deal is struck, `setBandNegotiatedFee` clamping an absurd ask into
bounds and lapsing after `NEGOTIATED_DEAL_DURATION`, `escortRecruitBand`
charging the negotiated price (not the base one) and consuming the deal on
use, and `ollamaNegotiate` failing soft with no `fetch`. The streaming network
path itself (token-by-token UI updates, the CORS/timeout error copy, the
`#chatPending` → persisted-bubble handoff, and the full negotiate
ACCEPT/COUNTER/malformed round-trip through to the Escort tab's hire button)
was verified by hand against a local mock Ollama server, not by an automated
test — genuine network I/O against a real server isn't something the Node
`vm` sandbox does anywhere else in this suite either.

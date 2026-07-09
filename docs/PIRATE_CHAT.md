# Pirate chat — in-character dialogue via a local Ollama model

Free-form chat with a pirate band's captain, from the 🏴‍☠️ Contacts tab's new
**💬 Talk** sub-view. First pass is chat only: banter, bragging and haggling
in character, grounded in the band's real numbers — no mechanical effect yet.
The numbered buttons under **🤝 All contacts** (gifts, hire, tags, feuds,
call-for-support, mandates) are still the only things that move credits or
standing.

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
  - `ollamaChat(bandId, userText, { onToken, onDone, onError })` — streams
    `POST /api/chat` (NDJSON), falling back to a single `response.json()`
    read if the runtime has no readable-stream body. `testOllamaConnection()`
    hits `GET /api/tags` for the settings card's 🔌 Test button.
  - `escapeChatHtml(s)` — every chat bubble's text is player-typed or
    model-generated, unlike the rest of this innerHTML-templated UI (which
    only ever renders developer-authored strings), so it's the one place in
    the codebase that HTML-escapes free text before display.
- **`renderCombat.js`** (already owns the Contacts tab) — the DOM half:
  `renderContactsChat()`, `chatBubble()`, `chatSettingsCard()`, and the
  `chatUI` runtime-only state object (`bandId`, per-band `drafts`/`sending`/
  `pending`/`error`) — same non-persisted pattern as `mandateForm`. Sending
  a message updates the DOM directly per streamed token
  (`#chatPending`'s `textContent`) rather than re-rendering the whole panel
  per token, so the transcript doesn't flicker mid-reply.
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
band-id keys don't; a save without the key stays byte-identical). The
streaming network path itself (token-by-token UI updates, the CORS/timeout
error copy, the `#chatPending` → persisted-bubble handoff) was verified by
hand against a local mock Ollama server, not by an automated test — genuine
network I/O against a real server isn't something the Node `vm` sandbox
does anywhere else in this suite either.

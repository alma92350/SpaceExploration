---
name: verify
description: How to run and observe Stellar Frontier changes at their real surface — the game page in a browser, or the Model Arena CLI against a (mock) Ollama server.
---

# Verifying changes in this repo

No build step, no dependencies. Two surfaces:

## The game (index.html + classic scripts)

```bash
python3 -m http.server 8000        # then browse http://localhost:8000
```

Progress lives in `localStorage`; the ⟲ New button (top-left) resets. To
drive it headless, Playwright against `http://localhost:8000` works — the
scripts are classic (non-module) `<script>` tags, so game state (`S`) and
functions are reachable from `page.evaluate` as globals.

## The Model Arena CLI (tools/modelArena.mjs)

Needs an Ollama server. None can run in a sandboxed container, so verify
against a mock that speaks the same API (NDJSON streaming `/api/chat`,
`/api/tags` with `details.parameter_size`, `/api/version`) — the shape
`tools/modelArena.mjs` consumes. A known-good recipe: two fake models, one
that follows the narration instructions (should score ~100%) and one that
answers "As an AI language model… 999999 credits" (should score 0%) —
the leaderboard separating them end-to-end is the verification.

```bash
node tools/modelArena.mjs --endpoint http://127.0.0.1:<mockport> --samples 2 --out /tmp/arena
```

Worth probing: `--models ghost:1b` (skip path), a stalling model with
`--timeout 2000` (idle abort + 10-consecutive-error abandonment), an
unreachable `--endpoint` (friendly failure, exit 1), `--think` (thinking
captured separately in results.json, `think:true` in request bodies).

## Gotchas

- `node --test` is CI, not verification — the sandbox stubs `fetch` as
  `undefined` on principle, so nothing network-shaped is observable there.
- Arena scores are pass rates over samples; on a mock they should be
  exactly 100%/0%, anything between means a checker regressed.

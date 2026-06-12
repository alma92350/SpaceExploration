# Telemetry Design (planned — not yet implemented)

**Status:** idea approved, implementation deferred.
**Decision (2026-06-11):** local export only — telemetry stays in the player's
browser and is exported to disk as a file by the player. No collector, no
upload, no PII. A remote opt-in upload could be a later phase, never default.

## Goal

Record user interactions so that *offline* analysis (not real-time) can guide
improvements across several dimensions: difficulty/balance curves, economy
health, progressive-disclosure pacing, drop-off/churn, UX friction, strategy
diversity and content reach.

## Architecture: one tiny sink, taps at existing choke points

- `track(event, props)` pushes a small flat record into an in-memory buffer,
  flushed to a capped `localStorage` ring buffer (~5,000 events) on `endTurn`
  and on `visibilitychange`/`pagehide`.
- Export: "📊 Export telemetry" action in the Captain's Console downloads the
  buffer as `.jsonl`, reusing the existing save-to-disk Blob plumbing
  (`exportSave` pattern).
- Common envelope on every event:
  `{ t: Date.now(), sid, turn: S.turn, ver: APP_VERSION, ev, ...props }`
  - `sid` — random per-session id → reconstruct playthrough trajectories.
  - `ver` — compare behaviour across releases (e.g. did the 1.1.1 pirate
    rebalance move combat win-rates?).
- Keep buffer/flush logic pure + headless-guarded (same split as
  `buildSaveText`/`parseSaveText`) so it tests in the node harness.

## Tap points (ranked by leverage ÷ effort)

| Hook | Function | Captures |
|---|---|---|
| Cycle snapshot | `endTurn()` | per-cycle: credits, `netWorth()`, fuel, #colonies, avg happiness, pollution/climate, rep vector, office, wanted/dread, unlocked tabs, career — every progression curve from one tap |
| Friction stream | `toast(msg,"bad")` | every denied/failed action already flows through a bad toast → free frustration log |
| Milestones | `announce()` | big moments (colony lost, win, ambush) — free high-signal stream |
| Navigation | `setTab()` + `setSubView()` | feature discovery order; clicks on locked tabs (confusion signal) |
| Lifecycle | `init()` + `newGame()` | session start (fresh vs resumed, save age, `showAllTabs`), game mode |
| Outcome | `checkWin()`, secession, combat death | win/loss type, cycles-to-win, colonies lost |
| Progression | `buyUpgrade`, `researchTech`, `colonize`, `alignColony`, `foundOrg` | purchase/research order → dominant strategies, dead content |
| Economy/combat leaves | `buy`/`sell`, `encounterFight`, `pirateKillRewards`, `prowl` | transaction sizes, weapon choice, foe rank vs player tier, hull lost, flee/pay/fight choice |

The first five taps answer most questions with no leaf instrumentation.

## Analysis dimensions → data needed

- **Difficulty/balance:** win-rate & hull lost by game stage and player tier.
- **Economy health:** net-worth trajectory; most-traded commodities & margins
  (money fountains/sinks, too-easy arbitrage, mid-game riches).
- **Disclosure pacing:** per tab, cycle unlocked vs cycle first visited;
  `showAllTabs` usage.
- **Drop-off:** session length, cycles/session, **last event before session
  end** (best churn signal).
- **Friction:** bad-toast reasons ranked; repeated identical failures;
  locked-tab clicks.
- **Strategy diversity:** career mix, build orders, crisis responses
  (donate/gouge/loot), faction alignments.
- **Content reach:** planets visited, missions accepted vs abandoned.

## Practical constraints

- Anonymous: random `clientId`/`sid` only, zero PII. Data never leaves the
  machine except by explicit player export.
- Volume is tiny (tens–hundreds of cycles/run); cap the ring buffer.
- Document the `.jsonl` schema in the README when implemented.

## First slice when implemented (~an afternoon)

1. `track()` + ring buffer + Captain's Console export button.
2. Auto-taps: `endTurn`, `toast("bad")`, `setTab`, `init`/`newGame`,
   `checkWin`/secession.
3. README schema note.

Phase 2: economy/combat/strategy leaf events.

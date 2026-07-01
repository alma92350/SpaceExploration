# Sector 4X Layer — persistent faction relations

A background simulation of the five great powers' relationships with **each
other** (not just their reputation with you), the foundation for a broader
living-sector layer. Designed to be built in risk-ordered slices: this one is
pure new state — nothing existing reads `S.factionRel`, so it can't
destabilize the ~90 places `PLANETS[i].faction` is already read.

## Slice 1 (shipped) — the relations engine
- **State**: `S.factionRel[pairKey] = score` (-100..100) for every one of the
  `C(5,2)=10` faction pairs (`FACTION_KEYS`, `factionPairKey`, lazily seeded
  by `ensureFactionRel`). Rivals (`factionsAreRivals`, checks `FACTION_RIVAL`
  in **both** directions — the table has one one-way entry, `syndicate: "core"`
  with no reverse) start tense (-20, Cold War); everyone else starts at Peace
  (25).
- **Tiers** (`factionRelTier`): 🤝 Alliance ≥60 · 🕊️ Peace ≥15 · ❄️ Cold War
  ≥-30 · ⚔️ War <-30. `factionRelation(a,b)` returns `{score, tier, ico, label}`.
- **Per-cycle tick** (`processFactionRelations`, in `endTurn`):
  - Gentle exponential drift toward a target each cycle — rivals pull toward
    -60 (war), everyone else toward 25 (peace) — so it takes many cycles to
    shift a full tier, giving escalation weight.
  - Your **active letter of marque** (`S.commission`) additionally stokes
    *exactly* the patron-vs-target pair, and only that pair.
  - A throttled (`S.turn % 4`), ~50% chance **named incident** nudges one
    random pair by 8–16, with flavor text (`FACTION_INCIDENTS_GOOD/BAD`).
    Logged always; a **tier change** additionally gets its own log line and
    feeds the cycle digest's new `sector` bucket (`digestNote("sector", ...)`)
    — small in-tier nudges don't spam a change notice.
- **UI**: `renderSectorRelations()` — a Politics-tab card listing all 10
  pairs, worst (most tense) first, with a pill + bar per pair. Read-only in
  this slice.
- `factionRel: {}` in `freshState`; `init()` backfills + calls
  `ensureFactionRel()` for older saves.

Tests: `sectorrel.js` (24 checks).

## Slice 2 (shipped) — wider visibility
Still read-only — no new mechanics, just making slice 1's state legible
everywhere the player already looks.
- **Galaxy map**: `factionWarFrontPill(f)` surfaces a world's owning faction's
  single most newsworthy relationship — a red "⚔️ at war w/ X" pill if it's at
  War with anyone (war always outranks an alliance for urgency), else a green
  "🤝 allied w/ X" pill if it has an Alliance. Peace/Cold War (the common
  baseline for most pairs) shows nothing, keeping the map uncluttered.
  Colonizable/unowned worlds (no `p.faction`) never get a pill.
  `factionMostTenseRelation`/`factionMostFriendlyRelation` do the lookup.
- **Operations board** (`renderOps`): lists every pair currently at War or
  Alliance (the two tiers that represent genuine drama from baseline), each
  linking through to the Politics tab. Peace/Cold War pairs are omitted here
  too, for the same reason.
- **Deeper digest detail**: a tier-change note in the cycle recap now shows
  the full transition (`❄️ Cold War → ⚔️ War`), not just the resulting tier —
  more informative without adding volume, since it's still one note per
  change.

Tests: `sectorvis.js` (14 checks).

## Slice 3 (shipped) — rising pirate powers
Mirrors the player's own Haven mechanic. Still additive: a haven-bearing band
is a normal `S.pirateBands` entry with one extra field (`b.haven = {planet,
tier, calm}`) — every existing band system (ally, feud, hire, mandate, tag,
recruit) works on it unchanged.
- **Founding** (`processPirateHavens`, same `S.turn % 5` cadence as
  `processPirates`): a throttled ~25% chance, capped at
  `PIRATE_HAVEN_MAX_ACTIVE` (2) simultaneous havens, weighted toward the
  most already-lawless eligible world (`eligiblePirateHavenWorlds`: `canHaven`,
  not already claimed, not the player's own haven). Prefers an existing band
  (level ≥3, no haven yet) for narrative continuity; falls back to spawning a
  fresh one. Founding immediately sets local `pirateLevel` to at least 3.
- **Growth**: each qualifying cycle, a chance (scaling with local
  `pirateLevel`) to raise the haven's tier (cap `PIRATE_HAVEN_MAX_TIER`=3) and
  sometimes the band's own rank — projecting more menace onto its world.
- **Collapse — the player's built-in counter, no new action needed**: if the
  haven's world is pacified (`pirateLevel` 0) for `PIRATE_HAVEN_CALM_TO_COLLAPSE`
  (3) consecutive qualifying cycles, it's abandoned. Since mandates, fleet
  missions, and ordinary raiding already suppress `pirateLevel`, keeping a
  haven world clean with existing tools starves it out — no new player-facing
  mechanic required.
- **Edge case found & fixed during testing**: a band whose haven collapses
  could be immediately re-picked as a founding candidate in the very same
  cycle (undoing the collapse in the same breath). Fixed by excluding
  same-pass collapses from the founding candidate pool
  (`justCollapsed`) — caught by a 300-trial stress test, not the first pass.
- **Visibility**: Galaxy-card pill (`👑 {band}'s haven T{tier}`), an
  Operations-board row, and a line on the band's Contacts card.

Tests: `pirhavens.js` (25 checks, including a dedicated 200-trial regression
for the same-cycle collapse/founding edge case).

## Slice 4 (shipped) — territory contest
The risky slice: a world's owning faction can actually change. De-risked by
a full audit first — every one of the ~90 existing `.faction` reads
(pricing, enforcement, rep, contracts, crises, Senate seats) turned out to
be dynamic (re-fetched at read time, never cached/snapshotted), so a live
mutation to `PLANETS[i].faction` propagates correctly everywhere with
**zero changes** to those call sites.
- **Eligibility** (`territoryContestFor`): only non-colonizable, owned
  worlds whose owner has a `factionMostTenseRelation` at the War tier are
  contestable; the challenger is that rival.
- **Meter** (`S.territoryControl[pid] = {owner, challenger, meter}`, same
  `S.turn % 5` cadence as `processPirates`): grows each qualifying cycle by
  a rate that scales with how deep the war score is and the world's local
  `pirateLevel` — an unchecked pirate haven (slice 3) directly accelerates
  a contest against its owner. If the war cools or ends, the meter instead
  decays and the contest is cleared once it hits zero.
- **Flip** (`applyTerritoryFlip`): at max meter the world's `faction`
  actually changes to the challenger, logged prominently, announced, and
  digested (`digestNote("sector", ...)`).
- **Persistence quirk**: `PLANETS` is static source, re-declared fresh on
  every page load — it isn't part of `S`. A flip is recorded twice: live on
  the `PLANETS` object (so all ~90 existing reads see it immediately) and
  into `S.territoryFlips[pid] = newFaction`, replayed onto the fresh array
  by `replayTerritoryFlips()` from `init()` after every load.
- **Safety floor** (`TERRITORY_MIN_WORLDS = 1`): a faction is never
  conquered down to zero worlds — its last one is held just short of the
  max meter instead of flipping, verified with a dedicated scenario and a
  400-cycle universal-total-war stress test.
- **UI**: a Galaxy-card pill (`🚩 contested by {challenger} {pct}%`), an
  Operations-board row, and a Politics-tab "Contested Worlds" card with a
  meter bar per active contest.

Tests: `territory.js` (30 checks, including the 400-cycle stress test).

## Roadmap (risk-ordered, not narrative-ordered)
5. **Player leverage** — tie letters of marque to a *live* war (fulfilling
   quota measurably swings a contested world), amplify fleet mission effect
   in contested systems, new legacy capstones ("ended a war", "united the
   sector").

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

## Roadmap (risk-ordered, not narrative-ordered)
3. **Rising pirate powers** — an exceptional band claims a lawless world as
   its own Haven and becomes a named, escalating threat (mirrors the
   player's Haven mechanic). Additive, no core-assumption risk.
4. **Territory contest** — the risky slice: a world caught between two
   warring factions gets a shifting control meter that can actually flip
   `p.faction`. Requires auditing the ~90 existing reads of that field
   first (pricing, enforcement, rep, contracts, crises all assume it's
   static today).
5. **Player leverage** — tie letters of marque to a *live* war (fulfilling
   quota measurably swings a contested world), amplify fleet mission effect
   in contested systems, new legacy capstones ("ended a war", "united the
   sector").

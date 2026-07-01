# Procedural Galaxy Generation — bigger, replayable maps

Brainstormed as improvement #18: the 20 hand-authored worlds are the whole
galaxy today, laid out on a single `x` line with travel cost = distance.
Staged in risk-ordered slices, same discipline as the Sector 4X layer.

## Slice 1 (shipped) — the frontier ring
The lowest-risk option: leave the 20 curated worlds untouched and
procedurally generate a further ring of worlds beyond them, appended live
onto `PLANETS` at load time.
- **Determinism & replayability**: `S.frontierSeed` is rolled once per new
  game (backfilled for older saves) and feeds a small seeded PRNG
  (`mulberry32`) used only for frontier generation — nothing else in the
  game's randomness is touched. The same seed always regenerates the exact
  same ring, so a reload reproduces your sector; a new game rolls a
  different one.
- **Generation** (`generateFrontierRing()`, called from `init()`,
  idempotent within a single load): 8–12 worlds, each drawn from one of 8
  archetypes (Rogue Outpost, Derelict Field, Gas Shoal, Verdant Reach,
  Mineral Vein, Silent Reach, Ember Waste, Trade Shoal) that fix a color,
  deposit pool and stat ranges; names come from a curated 24-name pool
  (shuffled by the seed) so flavor quality matches the hand-authored
  worlds even though placement is procedural. Positioned past the charted
  20's farthest `x`, spaced 3–7 apart, so reaching the ring costs
  meaningfully more fuel — an aspirational late-game destination, not a
  turn-one detour.
- **Deeper exploration, for free**: every frontier world is `hidden`, so
  charting them runs through the *existing* Deep-Space Survey /
  `explore()` pipeline unchanged — no new UI, no new player-facing
  mechanic. The existing "N world(s) still hidden" counter on the Galaxy
  tab now counts the frontier ring too.
- **The `PLANETS`-is-static-source problem, again**: as with territory
  flips, `PLANETS` is redeclared fresh on every page load and isn't part
  of `S`. A save only carries `S.frontierSeed`; `generateFrontierRing()`
  re-derives the identical worlds from it on every load and appends them,
  then `recomputeDistances()` (extracted from the old one-time top-level
  loop) rebuilds the full distance matrix so every old↔new and new↔new
  pair has a `.distances` entry — without it, `fuelCost()` to a frontier
  world would silently compute `NaN`.
- **Spoiler audit**: marking frontier worlds "active" (so contracts,
  markets, `activePlanets()`, etc. all pick them up with zero call-site
  changes, same de-risking as territory contest) meant three systems that
  select from *any* active world and then announce it by name — crisis
  spawning, pirate haven founding, and territory contest — could target
  and name-drop an undiscovered frontier world before the player had ever
  charted it. Fixed by switching those three candidate pools from
  `isActive` to the existing `isVisible` (which already gates hidden
  worlds behind `S.discovered`) — a one-word fix at each site, and
  incidentally a minor correctness fix for the 3 pre-existing hidden
  core-colony worlds too, which had the same latent gap.
- **Balance audit**: sector-wide averages (`S.climate` build-up, crisis
  spawn chance, base-trade and colony-logistics ambush odds) were already
  computed over the *entire* `PLANETS` array, active or not — adding
  8–12 more mostly-dormant worlds would have diluted them well past the
  existing tolerance. Fixed with `nonFrontierPlanets()`, a filtered view
  used at exactly those four call sites so the frontier ring never
  affects sector-wide balance stats (only its own local conditions, once
  discovered).

Tests: `frontier.js` (30 checks, including seed-determinism-after-simulated-reload,
a different-seed-produces-a-different-ring replay check, and dedicated
spoiler-safety checks for all three name-leak sites).

## Slice 2 (shipped) — the lane graph
Distance used to be pure `|x1 - x2|`: a straight line, so a world's cost to
reach was exactly its coordinate gap from wherever the player stood.
De-risked the way slice 1 was: audited every one of the ~14 existing reads
of `p.distances[...]` first (`fuelCost`, `rollPrices`'s regional price
diffusion, `regionalSupply`, escort mission legs/threat/pay, mandate fees,
`bandDistance`, `worldDist` base freight, pirate-intel map range,
`bestFlipFor` arbitrage ranking, signal targeting, the Galaxy card's "ly"
display) — all of them just read `p.distances[id]` as an opaque precomputed
number, none of them cared *how* it was derived. That meant the entire
travel-cost *model* could be replaced with zero call-site changes, the same
de-risking win as territory contest and the frontier ring.
- **Travel stays single-hop/point-to-point** — a deliberate, lower-risk
  scope call over mandatory multi-hop routing (which the audit flagged as
  the higher-risk option: it would need a new route-planning UI and would
  force rebalancing escort/ambush/mandate economics that already scale off
  the distance number). Only how that number is *computed* changes.
- **The graph** (`buildLaneGraph`, `laneShortestPaths`, both feeding a
  rewritten `recomputeDistances(seed)`): a backbone chain across every
  world in `x`-order — so an unperturbed pair's distance still matches the
  old model exactly — plus two seeded perturbations: ~25% of backbone
  links get a **hazard multiplier** (1.5×–3×, an asteroid field or patrol
  gauntlet making that stretch pricier than raw distance suggests), and
  4-6 **hyperlane shortcuts** connect distant, non-adjacent worlds at
  roughly 30-60% of the backbone-path cost. All-pairs shortest paths run
  once per generation (Floyd-Warshall — trivial at ~20-32 nodes) and are
  flattened back into the same `p.distances` lookup table every consumer
  already reads, so `rollPrices()`'s O(n²) per-cycle diffusion loop stays
  exactly as cheap as before (no live graph queries during play).
  Guaranteed connected by construction — the backbone alone reaches every
  world, so no path is ever missing.
- **Seeding**: a new `S.laneSeed` (rolled fresh per new game, backfilled
  for older saves), independent of `S.frontierSeed` so the two systems can
  be reasoned about and tested separately. `recomputeDistances()` falls
  back to a fixed seed the instant `PLANETS` is declared (before `S`
  exists), then is re-run with the real per-save seed once
  `generateFrontierRing()` runs from `init()` — same "provisional value at
  parse time, correct value once `S` exists" pattern the frontier ring
  established.
- **Visible payoff**: each planet gets a `.hyperlanes` list (its direct
  graph neighbors); the Galaxy tab shows a "🛰️ hyperlane" pill on a world
  directly bypass-linked to wherever the player is standing, so a
  surprisingly cheap distant world (or a surprisingly expensive nearby
  one) is now something the player can *see*, not just notice as an
  unexplained number.
- Territory contest, ambush, mandate and escort mechanics are untouched —
  they keep reading the same `p.distances` numbers, which now happen to
  reflect real chokepoints and shortcuts instead of a ruler.

Tests: `lanegraph.js` (20 checks: connectivity, the triangle inequality
across all planet triples, seed-determinism-after-simulated-reload, a
different-seed-produces-a-different-matrix replay check, confirming both a
shortcut-cheapened pair and a hazard-penalized pair exist across a sweep of
seeds, hyperlane reciprocity, and smoke tests of every existing distance
consumer).

## Slice 3 (shipped) — the Sector Code
Surfaces the seeds that have quietly driven slices 1 and 2 all along, so a
galaxy is something a player can read out, share, and recreate — not just
roll blind.
- **One code, not two**: `S.laneSeed` is no longer rolled independently —
  it's now derived from `S.frontierSeed` (`deriveLaneSeed`, a fixed XOR
  mix), so a single short base-36 "Sector Code" (`seedCodeFor`/
  `seedFromCode`) reproduces an entire galaxy: same frontier ring, same
  lane graph, hazards and hyperlanes included. Already-shipped saves that
  independently persisted both seeds are left untouched — the derivation
  only applies to brand-new games and to backfilling a `laneSeed` that's
  missing entirely (a save from the narrow window between slices 1 and 2).
- **A real bug found in the process**: `newGame()` (the "⟲ New" button)
  reset `S` but never touched the live `PLANETS` array or called
  `generateFrontierRing()` — harmless on a page *reload* (where `PLANETS`
  is rebuilt from source) but broken on a **mid-session** New Game: the
  previous run's frontier worlds stayed in `PLANETS`, unmarked in the new
  `S.active`, permanently dangling and unreachable, while the freshly
  rolled `frontierSeed`/`laneSeed` described a galaxy that never actually
  got built. None of the slice 1/2 tests caught it because they all
  simulated a fresh reload directly rather than exercising the real
  `newGame()` path. Fixed by having `newGame()` strip any `p.frontier`
  worlds from `PLANETS` before re-rolling `S`, then calling
  `generateFrontierRing()` and `rollPrices()` itself, exactly mirroring
  what `init()` already does after a real reload.
- **UI**: a new "🔑 Seed" console button opens a prompt pre-filled with the
  current Sector Code — copy it as-is to share, clear it for a random
  sector, or paste a different one to start a new game from it (`confirm`
  still gates the progress-loss warning). The Galaxy tab subtitle also
  prints the current code plainly, so it's discoverable without hunting
  for the button.

Tests: `seedcode.js` (24 checks: code round-tripping incl. case/whitespace
tolerance, laneSeed derivation, explicit-seed determinism across two
independently generated galaxies, the `newGame()` bug fix — both "no stale
frontier worlds left behind" and "regenerated worlds are active with valid
distances" — repeated-code reproducibility, garbage/blank input fallback,
colony-mode compatibility, backfill derivation, and the subtitle display).

## Roadmap (risk-ordered, not narrative-ordered)
4. **Exploration-as-gameplay** — a lightweight probe/scout action with
   its own risk/reward, richer signals tied to the Fortunes system on
   frontier worlds specifically.
5. **A real 2D map** — the lane graph now has genuine topology, but the
   Galaxy tab still renders a flat card grid; a spatial layout (or a
   canvas node-link view) would let players *see* the chokepoints and
   hyperlanes instead of reading pills. Bigger UI lift, no mechanical risk
   — the data's already there.
6. **Full proceduralization** — generate the charted core itself from a
   seed. Would need the same full audit territory contest, the frontier
   ring, and slice 2 all did, extended to every place that assumes a
   stable, permanent planet `id` (colonies, bases, contracts) — likely its
   own multi-slice project, and maybe not worth it given how much
   hand-tuning lives in the curated 20.

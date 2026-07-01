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

## Roadmap (risk-ordered, not narrative-ordered)
2. **Bigger connective map** — replace the 1D `x` line with a proper lane
   graph (nodes + edges, maybe a simple 2D layout for the Galaxy tab), so
   travel cost reflects route distance instead of `|x1-x2|` and routes can
   branch, dead-end, or choke — giving factions and territory contest
   real geography to fight over.
3. **Per-run seed UX** — surface `S.frontierSeed` (or a friendlier derived
   code) at "New Game" so a seed can be entered or shared, not just
   rolled blind.
4. **Exploration-as-gameplay** — a lightweight probe/scout action with
   its own risk/reward, richer signals tied to the Fortunes system on
   frontier worlds specifically.
5. **Full proceduralization** — generate the charted core itself from a
   seed. Would need the same full audit territory contest and this slice
   both did, extended to every place that assumes a stable, permanent
   planet `id` (colonies, bases, contracts) — likely its own multi-slice
   project, and maybe not worth it given how much hand-tuning lives in
   the curated 20.

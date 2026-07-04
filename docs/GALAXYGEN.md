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

## Slice 4 (shipped) — probe the frontier
`explore()` already surveys hidden worlds, legacy and frontier alike, in a
fixed nearest-first queue — no way to specifically push at the frontier
ring, and no risk beyond the action spent. This slice adds a second,
riskier lever aimed only at the frontier, and makes the existing signal
system itself richer wherever it lands on a frontier world — not just
through the new action.
- **`probeFrontier()`**: 1 action + a flat 30 fuel (spent whether it pays
  off or not — a real expedition cost, unlike the free `explore()`),
  targeting the nearest undiscovered *frontier* world specifically via
  `undiscoveredHidden().filter(p => p.frontier)`. Success chance
  (`0.35 + lab*0.05`) is deliberately a harder shot than a routine survey's
  `0.45 + lab*0.06` — the frontier is farther and less charted.
- **Risk**: reuses the exact shape of the existing travel-ambush pattern
  (`maybeAmbush`/`genPirate`) rather than inventing a new encounter system
  — a probe against a lawless target (an archetype's own `lawless` flag,
  or plain `enforce <= 0.15`) has a 22% chance of drawing a pirate
  encounter instead of resolving discovery at all that cycle; a calmer
  target only 10%. Ties directly into the frontier ring's own archetype
  data rather than a flat number.
- **Richer signals, systemically**: `spawnSignal()` itself (not just the
  new action) now checks whether its target planet is a frontier world
  and, if so, recovers that world's archetype via `frontierArchetypeFor()`
  (matching `p.tag` back to `FRONTIER_ARCHETYPES` — the archetype was
  always recoverable post-generation, just never read after the fact
  until now) to bias the roll: tier is an **advantage roll**
  (`Math.max(signalTier(), signalTier())`, skewing stronger), and kind
  leans toward the archetype's flavor — lawless archetypes (Rogue
  Outpost, Derelict Field, Ember Waste) toward salvage-flavored
  `cache`/`derelict`, relics/crystals archetypes (Silent Reach, Mineral
  Vein, Trade Shoal, and the lawless ones too) toward knowledge-flavored
  `anomaly`/`intel`. Because this lives inside `spawnSignal()` itself,
  *any* signal that happens to land on a frontier world is richer —
  ambient rolls, first-visit spawns, purchased scans, not just probes —
  while every non-frontier call site is provably unchanged (the archetype
  lookup is `null` for any non-frontier planet, so `opts.tier || signalTier()`
  and `opts.kind || pick(...)` reduce to exactly the pre-slice-4 code path).
- **UI**: a "🔭 Probe the Frontier" card sits next to the existing
  Deep-Space Survey card on the Galaxy tab, gated by the same Colonial
  Charter tech, showing the remaining undiscovered-frontier count and
  disabling itself when fuel or actions are short.

Tests: `probe.js` (27 checks: every gate, exact fuel/action spend on both
outcomes, the success/failure/ambush paths forced via a mocked `Math.random`,
a 300-trial statistical check that a lawless target is ambushed more often
than a calm one, a 400-trial check that frontier-targeted signals average a
higher tier than core-world ones, kind-bias checks for both archetype
flavors, confirmation that non-frontier `spawnSignal()` behavior is
untouched, and the Galaxy tab card's visibility/state).

**Superseded — merged into the Survey Expedition.** `explore()` and
`probeFrontier()` were later folded into a single multi-cycle
`launchExpedition()`/`processExpedition()` pair (frontier.js): one Galaxy-tab
card, one action + 25 fuel to outfit, targeting `undiscoveredHidden()[0]`
(the same nearest-first queue both old buttons drew from). The trip takes
`3 + 2·frontier − ⌊lab/2⌋` cycles (min 2, ticked from `endTurn`), a lawless
heading rolls the probe's ambush risk each cycle en route (8%/3% — the old
one-shot 22%/10% spread over the journey), and completion always charts the
target — the dice moved from the outcome into the journey. Frontier finds
still call `spawnSignal({ planet })`, so slice 4's richer-signal bias is
untouched. State: `S.expedition = { target, cyclesLeft }`. Tests:
`expedition.test.js`.

## Slice 5 (shipped) — the starmap
The lane graph has had genuine topology since slice 2 — hazard stretches,
hyperlane shortcuts — but the Galaxy tab only ever surfaced it as text (a
pill, an "ly" number on a card). Purely additive, no mechanical risk, as
the roadmap predicted: `renderStarmap()` draws an SVG node-link view of
every world the player already knows about, sitting above the existing
card grid, which is completely untouched — same cards, same Travel
buttons, same detail. A second, more legible view onto data slice 2
already computed, not a replacement.
- **Layout**: known worlds are sorted by `x` and placed by *rank*, not raw
  coordinate — a handful of far-flung frontier worlds at high `x` would
  otherwise squash the charted 20 into one corner of the map. Positions
  follow a gentle sine curve rather than a flat line, so it reads as a
  starlane, not the ruler slice 2 explicitly moved away from.
- **Edges are `.hyperlanes`, node-for-node** — the exact per-planet list
  slice 2 already built for the "🛰️ hyperlane" pill, drawn directly as
  SVG lines instead of read one card at a time. Edges touching the
  player's current location are drawn brighter, so "which worlds are a
  direct hop from here" is visible at a glance across the whole sector,
  not just checked card by card.
- **Same spoiler discipline as everywhere else in this arc**: an edge only
  draws when *both* ends are `galaxyKnown` — a hidden world's hyperlanes
  never leak as a line pointing off into the dark toward something the
  player hasn't charted yet.
- **Interactive**: clicking any node but the player's own calls `travel(id)`
  directly — the map is a second way to move, not just to look.

Tests: `starmap.js` (15 checks: degenerate 0/1-node cases, node-count and
current-location-highlight correctness, click-to-travel wiring, fuel-cost
tooltip accuracy, an exact edge-count spoiler-safety check comparing
against a hand-computed known-known bound, a 30-seed stress sweep
alternating full and realistic (fog-of-war) visibility, and full `endTurn()`
integration).

## Slice 6 (shipped) — core variance
"Full proceduralization" as originally scoped meant replacing the charted
20's hand-written names, descriptions and lore with the same
archetype-template system the frontier ring uses. Checked with the user
before touching it, since I'd flagged it in this doc as the riskiest,
lowest-value slice — guts curated writing rather than adding around it.
Landed on a scoped hybrid instead: the 20's identity (`id`, `name`, `tag`,
`color`, `x`, `desc`, `faction`) stays exactly as hand-written, forever;
only what each world *produces* — deposits, industry, tech, enforce —
varies per Sector Code.
- **`applyCoreVariance(seed)`**: deposit yields jitter ×0.7–1.4 (rounded to
  1 decimal, floored at 0.3 so nothing vanishes), industry/tech jitter
  ±1 (clamped 1–10), enforce jitters ×0.85–1.15 (clamped 0.02–0.98).
  Resource *types* never change — Terra Nova stays mineral-poor, Ferros
  Prime stays ore-rich — only quantities. Deliberately narrow bounds: this
  is meant to add replay texture, not turn a hand-tuned capital into a
  mining hub or a lawless rim world into a fortress.
- **`CORE_BASELINE`**: a pristine snapshot of the charted 20's stats,
  captured once at parse time, before anything can vary them.
  `applyCoreVariance()` always recomputes FROM this baseline — never from
  whatever a previous seed left on the same 20 objects. That matters
  because, unlike the frontier ring (spliced out and rebuilt every
  `newGame()`), the core 20 are the *same* object instances across a
  mid-session New Game — recomputing from source instead of compounding
  is what makes calling it again idempotent rather than a drifting mess.
- **`S.coreSeed`**: derived from `S.frontierSeed` (a third fixed mix,
  alongside `laneSeed`'s), so the one Sector Code a player already shares
  still reproduces the whole galaxy — frontier ring, lane graph, *and*
  core variance together.
- **Ordering fix along the way**: `applyCoreVariance()` runs inside
  `freshState()` itself, before `pickStart()` reads `enforce` to choose a
  starting world — the one seed-derived value `pickStart` depends on
  needed to be correct immediately, not just once `init()` catches up
  afterward.
- Every downstream consumer — `reserveOf()`, `rollPrices()`,
  `canHaven()`, mission/achievement thresholds — already reads these
  fields dynamically per-world with no fixed expectations, confirmed by
  audit before writing a line of this slice, so nothing needed to change
  to pick up the variance.

Tests: `corevariance.js` (15 checks: identity fields provably unchanged
across seeds, variance actually happening and staying in bounds across a
60-seed sweep, determinism after a simulated reload, a different-seed
producing different variance, `coreSeed` derivation and backfill, the
idempotency guarantee under repeated calls, the critical mid-session
`newGame()` round-trip check — switch seeds twice, land back on identical
stats, no compounding drift — frontier-ring worlds staying untouched,
`pickStart()` always resolving validly across 40 seeds, and a live
`reserveOf()` check that reserves are computed from the varied deposit,
not the hardcoded baseline). Found and fixed two hardcoded exact-deposit
assertions in an older, unrelated test (`eco.js`, from long before this
arc) that assumed Ferros Prime's ore deposit was always exactly 2.0 —
updated to compute the expectation from the live (possibly-varied) value
instead, the same category of fix as the unseeded-active-roster test bug
found in slice 5.

## Slice 7 (shipped) — the strategic map
The Galaxy tab had quietly accumulated ~12 pill types across several earlier
features (fleet missions, stationed convoys, pirate mandates, territory
contests, faction war-fronts, pirate havens, hyperlanes...) with no way to
see just one layer, no visual language for who controls a world, and no
footprint at all for two fleet duty types. Purely additive, same low-risk
shape as slice 5's starmap.
- **Fleet presence, color-coded by duty**: the existing 🎯 fleet-mission and
  🚚 stationed-convoy pills gained distinct colors (accent/warn), and two new
  ones cover what was invisible before — 🛡️ patrolling (accent-2, the
  vicinity-gated raid-support status) and ⚓ docked (good, idle/building
  ships sitting at their own home port). New shared predicate
  `fleetPresentAt(pid)` (fleet.js) backs both the map and the intel change
  below.
- **Fleet-sourced pirate intel**: `pirateIntelKnows(pid)` (combat.js) gained
  one more OR-branch, `fleetPresentAt(pid)` — a world with any fleet ship on
  it (mission, station, patrol, or simply docked) reveals its real pirate
  activity for free, independent of a purchased chart. Since this one
  function already gated all 5 real call sites (galaxy map, fleet-mission
  picker, colony-logistics picker, mandate picker, Raider tab intel card),
  the change propagates everywhere at once with no other edits.
- **Faction control, finally visible**: `FACTIONS[f].color` (data.js) had
  been defined since the game's early days but was never read anywhere —
  confirmed by a full-codebase grep before writing a line of this slice. A
  4px colored left-border stripe on each owned world's card, and a matching
  colored ring around its starmap node, now make "who controls this world"
  legible at a glance instead of a plain gray text label. Colonizable/
  unowned worlds get neither, matching every other faction-gated pill.
- **Display filters**: the map's first-ever multi-toggle filter row —
  `S.galaxyFilters` (`ensureGalaxyFilters()`, lazily initialized like
  `S.escort`/`S.territoryControl`, no save migration needed), four
  independent booleans (`fleet`/`pirates`/`factions`/`environment`) each
  gating a cluster of the existing pills, toggled via `toggleGalaxyFilter(key)`
  and a button row mirroring the existing posture/sub-tab button-strip
  convention used elsewhere in the game.

Tests: `galaxymap.test.js` (14 checks) — including a technique worth noting
for future render-function tests: the test sandbox's `document.getElementById`
stub returns a *fresh* element on every call, so a function that writes
`el.innerHTML = ...` (as `renderGalaxy` does, rather than returning a string)
is otherwise unobservable after the fact. Caching the element the first time
a test requests it (monkey-patching `getElementById` inside the sandbox for
just that test) makes the real rendered output readable, matching how an
actual browser DOM already behaves.

## Roadmap (risk-ordered, not narrative-ordered)
None — all seven brainstormed slices are shipped. Bigger, replayable maps
(frontier ring, core variance), real geography (lane graph, starmap),
deeper exploration (probe/richer signals), a shareable Sector Code, and a
legible strategic layer (fleet presence, fleet-sourced intel, faction
control, display filters) are all in. Anything past this would be new
brainstorming, not backlog.

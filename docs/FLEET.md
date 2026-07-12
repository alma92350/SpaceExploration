# Player Fleet — colony shipyards

Your own ships, built at colony **Shipyards** — loyal, fully commanded, no loot
cut. The trade vs hired pirate bands: you pay to **build**, **upkeep**, and
**repair** them, and they can be damaged or lost, in exchange for 100% control.

## Slice 1 (shipped) — construction, roster, upkeep, repair
- **Shipyard** colony building (`colonyBuildingList`, 4 tiers, `req: metallurgy`).
  One colony = one shipyard (colonies are one-per-planet). Tier gates the biggest
  hull and the number of **slipways** (parallel builds = tier).
- **Ship catalog** (`FLEET_SHIPS`): freighters (light/medium/heavy/bulk — cargo
  `cap`), tankers (coastal/medium/super/ultra — cargo `cap` plus a `speed`
  multiplier, see Slice 11), and warships (corvette/frigate/cruiser/
  battleship — combat stats from `SHIP_CLASSES`). Each has a credit+material
  `cost`, a `build` time in cycles, and a `tier`.
- **Construction**: `orderShip` (at the docked colony) validates shipyard tier,
  free slipway, and affordability; debits credits from your own hold, but
  materials draw from `shipyardLocalStorage(pid)` **first** — the colony's own
  `storage` for a colony Shipyard, the base's own `storage` for a base Small
  Shipyard (`canAffordMats`/`payMats`) — falling back to your hold only for
  whatever the local stockpile can't cover. Adds a `status:"building"` ship to
  `S.fleet` that `processFleet` (in `endTurn`) ticks down to `idle`.
- **Upkeep**: `fleetUpkeep` (non-building ships) charged each cycle in
  `processFleet`, reported to the 💰 Cycle accounts ledger as "fleet upkeep".
- **Repair** (`repairFleetShip`) and **scrap** (`scrapShip`, ~40% metals salvage)
  at the ship's home shipyard; repair metals draw from the same
  `shipyardLocalStorage` venue as construction before touching your hold. The
  player's own ship repairs the same way — `repairSubsys`/`repairAll`
  (raiding.js) draw from `localStockpileAt(pid)` (colony storage over a
  coexisting base's, no Shipyard/module required — repair just needs a
  storeroom) before the hold. `repairShip` (the main hull heal) is
  credits-only and untouched by any of this.
- **Reassign home shipyard** (`reassignShipyard`) — an idle ship can re-register
  its home port to whatever colony you're currently docked at, provided that
  colony's Shipyard tier can service it (`def.tier <= yard`, same gate as
  construction). Costs a flat logistics fee (`shipyardReassignCost`, 8% of the
  ship's credit cost, floored at 200cr) — for consolidating a fleet built
  piecemeal across several colonies, since repair, convoy assignment (Slice 7)
  and slipway accounting are all keyed off `home`.
- **Small Shipyard** base module (`baseModuleList`, catalogs.js, 2 tiers,
  `shipyard: true`, no tech `req` — the base-module system has no tech-gating
  machinery at all, so this matches every other base module's unlocked-by-
  construction-alone convention rather than introducing a first-of-its-kind
  exception). Bases can be founded on *any* world, including non-colonizable
  ones a colony could never reach — so this is a forward-outpost building
  option, not a worse colony Shipyard. Its own `tiers:2` ceiling caps it to
  light hulls forever (Light Freighter/Corvette at Tier 1, Medium Freighter/
  Frigate at Tier 2) — `buildModule`'s existing tier-max guard enforces this
  for free, no separate hull-pool concept needed. `shipyardTierAt(pid)`
  unifies the lookup: a colony's full-range Shipyard always wins if a colony
  and a base somehow coexist on one world, never blended with the base's
  capped tier. `shipyardVenueAt(pid)` drives the Fleet tab's copy (which tab
  to go upgrade in).
- **Recycling bonus** (`scrapRefundPct`) — a **Tier 2 base Small Shipyard**
  raises `scrapShip`'s salvage rate from the usual 40% of a hull's metals
  to 60% (`SCRAP_REFUND_PCT`/`SCRAP_RECYCLE_BONUS_PCT`). Gated to the base
  module specifically, not colony Shipyards, matching the brainstorm's own
  framing of the salvage bonus as a Small Shipyard perk at its higher tier.
  The roster's scrap button (`shipRow`, renderFleetFortunes.js) previews the
  refund amount and a ✦ bonus mark when the elevated rate applies.
- **Ship customization** (`upgradeLoadout(shipId, "cargo"|"combat")`) — an
  idle hull docked at its home **base** Small Shipyard (any tier ≥1; colony
  Shipyards don't grant this) can commit to a Cargo or Combat loadout, up to
  `LOADOUT_MAX_LEVEL` (3) levels, paid in hold materials
  (`loadoutUpgradeCost`: metals+electronics, scaling with level). Cargo adds
  flat capacity (`LOADOUT_CARGO_PER_LEVEL`) to a new `s.cargoBonus` field;
  Combat adds hull (`LOADOUT_HULL_PER_LEVEL`, baked directly into the
  ship's own `hullMax`/`hull`, same as every other per-instance hull
  mutation) and firepower (`LOADOUT_STR_PER_LEVEL`) to a new `s.combatBonus`
  field. A ship commits to its first lean permanently — switching means
  scrapping and rebuilding (mirrors Escort's per-vessel stance precedent,
  escort.js, but on hold materials rather than the weapons/drones/ai pool,
  since this is a construction-venue mechanic, not a combat one).
  `shipCargoCap(s)`/`shipStrEff(s)` are the bonus-aware readers, threaded
  through every live-instance call site: `fleetAsAlly`, `escortRallyFleet`,
  `battleGroupFirepower`, `colonyHaulCap`, `convoyCargoBonus` (fleet.js),
  the Fleet tab's roster spec line and convoy roster (renderFleetFortunes.js),
  and the Escort tab's "recruit your own warships" row (renderSettlement.js)
  — deliberately NOT threaded into build-menu catalog *previews* (no ship
  instance exists yet to have a bonus) or `fleetShipUpkeep`/
  `fleetMissionDamage` (scoped out to avoid a wider balance pass). The Fleet
  tab's roster row (`shipRow`) shows a compact loadout badge + upgrade
  buttons beneath any idle ship docked at its home base Small Shipyard.
- **UI**: new **✦ Fleet tab** (`renderFleet`, `#panel-fleet`, `TAB_LADDER` entry
  unlocking once you hold a colony) — roster (warships / freighters, hull bars,
  status, repair/reassign/scrap/loadout) + the current shipyard's build menu
  (colony or base, venue-aware copy). The Bases tab's module card shows
  tier/slipway count for the Small Shipyard in place of a commodity output line.
- State: `S.fleet` (freshState + init migrate); the Small Shipyard is just a
  new key under `S.bases[pid].modules`, and `loadout`/`loadoutLevel`/
  `cargoBonus`/`combatBonus` are new optional per-ship fields — no migration
  needed for any of it. Exports: `orderShip`, `scrapShip`, `repairFleetShip`,
  `reassignShipyard`, `upgradeLoadout`, `shipyardTierAt`, `shipyardVenueAt`,
  `shipyardLocalStorage`, `localStockpileAt` (colonization.js),
  `scrapRefundPct`, `shipCargoCap`, `shipStrEff`. Tests:
  `fleet.js`, `reassign.test.js`, `smallshipyard.test.js`,
  `repairmatsource.test.js`,
  `shipyardmatsource.test.js`.

## Stats
- `fleetShipHullMax` / `fleetShipStr` derive from `SHIP_CLASSES` (warships) or
  cargo `cap` (freighters and tankers, via `fleetIsHauler(def)`);
  `fleetShipUpkeep` scales with class str / capacity the same way.
  `fleetShipSpeed(def)` reads a hull's `speed` field (only tankers have
  one — see Slice 11), defaulting to `1` for everything else.

## Slice 2 (shipped) — fleet missions
- `assignFleetMission(shipId, planet, task, dur)` sends an **idle warship** to work
  a system with the same `MANDATE_TASKS` (cull/protect/raid) as pirate mandates —
  but **no fee** and **100% of the take** (`processFleet` mission loop credits
  `mandateCycleYield` at full cut). Ship class → `shipMissionLevel` (corvette 2 …
  battleship 5) drives yield; `fleetMissionEst` previews it.
- **Risk** instead of a cut: `fleetMissionDamage` wears the hull each cycle by
  pirate activity / class hull (protect ×0.35); a hull that hits 0 is **lost**
  (you still bank what it earned). Upkeep keeps running. Raids honor the
  letter-of-marque Wanted exemption (`commissionCovers`).
- `recallFleetMission` ends early and banks the accrued take. A ship on mission
  can't be reassigned or scrapped. Activity in the dispatch picker is intel-gated
  (`pirateIntelKnows`). UI: dispatch card + per-ship mission status & recall in the
  Fleet tab. Exports added. Tests: `fleetmission.js`.

## Slice 3 (shipped, revised in Slice 8) — combat allies
- **Raids**: `raidSummonFleet(shipId)` brings a patrol-assigned warship in as a
  loyal ally (`fleetAsAlly`, `share:0` — no loot cut). Originally 100% callable
  from anywhere in the fleet, no distance check — Slice 8 gates this to warships
  on patrol (`assignPatrol`) at the raid's own world. Shares the 2-ally cap with
  band allies. `allyStrike` already handles a band-less ally (fp 1.0). Buttons
  in `preyCombatCard` (pirate + faction prey).
- **Escorts**: `escortRallyFleet(shipId)` adds a warship as a free `support` convoy
  escort carrying `fleetId`; the ship is marked `status:"escort"`. It never deserts
  (betrayal check skips `support`). `releaseFleetEscorts(e)` (called from
  escortDeliver/abortEscort/escortFail) syncs the convoy ship's hull back to the
  fleet ship, or removes it if it was destroyed.
- A ship on a mission or escort can't be reassigned or scrapped. Exports added.
  Tests: `fleetally.js`.

## Slice 4 (shipped) — freight convoys
- `assignLogistics(shipId, planetId)` stations an idle ship at one of your colonies
  (`status:"logistics"`, `station`). Freighters there **haul its goods**; warships
  there **guard the convoys**. `recallLogistics` frees them.
- **Transport savings**: `colonyHaulDiscount` (stationed freighter capacity) cuts
  the colony's `logisticsFee` (cheaper market imports); `colonyFreightMult` cuts
  its base↔colony freight in both trade passes. Bigger freighters → bigger cut.
- **Piracy risk**: `processConvoys` (in `processFleet`) — each cycle a stationed
  hauler in a pirate-active system can be **ambushed** (hull damage + a credit
  loss ledgered as "convoy losses"; hull 0 → lost). Stationed **warship guards**
  cut the ambush chance (~×0.45 each) and the damage.
- A ship on logistics duty can't be reassigned or scrapped. UI: a Logistics-duty
  card (colony picker + assign hauler/guard + savings & risk readout) and station
  status in the roster. Exports added. Tests: `fleetlogi.js`.

## Slice 5 (shipped, revised in Slice 8) — Battle Group: fleet-vs-fleet raid combat
Individual fleet allies (`raidSummonFleet`, slice 3) are still capped at the 2-ally
wing. **Battle Group** is a separate, additive mechanic: deploy every warship
patrolling the raid's own world at once (originally: your whole idle warship
fleet, wherever it was — revised by Slice 8's vicinity gate) into a raid as a
pooled formation, fought with an escort-style posture — reusing `ESCORT_POSTURES`
(screen/balanced/press) directly.

- `deployBattleGroup()` — marks every `fleetRaidable()` ship `status:"battle"`.
  `recallBattleGroup()` frees them anytime, no penalty, hull as-is — restoring
  `status:"patrol"` (not `"idle"`) so a patrol-assigned ship stays on call for
  the next raid at that world without needing to be reassigned again.
- `battleGroupFirepower()` — pooled strength of the group (battered ships fire
  less, same `hull/hullMax` factor as `escShipFP`), scaled by posture `.off`.
  Pools into `combatStrike`'s shared damage total alongside player + ally
  damage (Slice 8 splits that total across however many hostiles are targeted).
- `battleGroupScreenMult()` — while a group is deployed, ALL incoming fire to the
  player is scaled by posture `.def` (hooked into `foeStrikes`, same insertion
  point as the Fortunes `incomingMult` hook) — **screen** protects you, **press**
  exposes you more (mirrors escort semantics exactly).
- `battleGroupTakeFire(hostile)` — each round a group member takes real damage
  scaled by the given hostile's strength and posture `.def`; a ship at 0 hull is
  **destroyed and removed from the fleet** (same `_dead` purge pattern as convoy
  ambush/fleet missions). Real stakes: fielding a fleet against a strong foe can
  cost you ships. Slice 8 calls this once per *living* hostile in the engagement
  (originally: once per round, scaled only by the anchor prey's strength) — a
  bigger pooled enemy group threatens the Battle Group proportionally more.
- `releaseBattleGroup()` is folded into every raid-engagement end point:
  `clearEngagement()` (the canonical exit — disengage/extort/pack-cleared),
  `shipCrippled()` (towed off), and `travel()` (quarry slips away). Survivors
  return to `idle` with their wear intact (repairable at a shipyard).
- UI: `preyCombatCard` — "✦ Deploy Battle Fleet (N)" button when idle warships
  exist; once deployed, a status line (pooled 🔥/🛡️) + posture buttons + Recall.
  Surfaced on the Operations board (`renderOps`, "✦ ship · battle fleet (hull)").
  `S.battleGroupPosture` in freshState + init migrate. Exports added.
  Tests: `battlegroup.js`.

## Slice 6 (shipped) — tactical formation (positioning, not just pooled DPS)
Battle Group damage used to land on a uniformly random member. It's now a real
**positioning** decision across three tiers (`FORMATION_SLOTS`, per-ship
`s.formation`, sticky across recall/redeploy):

- **🛡️ Vanguard** (fpMult 0.85) — tanks: `battleGroupTakeFire` targets the
  **frontmost non-empty tier** 85% of the time (`battleGroupFrontTier`); the
  other 15% is stray fire that ignores tiering, so no formation is ever
  perfectly safe. Lose the Vanguard and the Line becomes the front tier; lose
  that too and Reserve is next — a formation **collapses tier by tier**.
- **⚔️ Line** (fpMult 1.20) — your main damage dealers, protected while the
  Vanguard holds.
- **🌌 Reserve** (fpMult 0.70) — safest, weakest, held back.
- `battleGroupFirepower()` applies each ship's tier `fpMult` before summing —
  moving ships between tiers is a genuine offense/survivability trade, not
  cosmetic.
- `battleGroupScreenMult()` adds a bonus: a **standing Vanguard** (any ship
  alive there) screens the player harder (×0.85 on top of posture `.def`); an
  **empty Vanguard** exposes the player more (×1.1) — positioning has stakes
  for the player's own hull, not just the fleet.
- `deployBattleGroup()` auto-assigns first-time deploys by hull size (biggest
  → Vanguard) via `autoAssignFormation`; manual picks (`setBattleGroupFormation`)
  are sticky and survive recall/redeploy. Reassignment is only valid for ships
  currently in the group.
- UI: `preyCombatCard`'s battle fleet block now lists each tier (member ships,
  pooled hull, a "◀ taking fire" flag on the front tier) with per-ship move
  buttons; the Operations board and ops row show each ship's tier icon.
  Tests: `tacticalbattle.js`.

## Galaxy map markers
`renderGalaxy` now shows pills for fleet missions (🎯), stationed convoys (🚚),
and pirate mandates (📜) at the planets they're running at, alongside the
existing pirate/crisis/signal pills — so the map surfaces everything the
Operations board tracks, spatially. Tests: `galaxymarkers.js`.

## Slice 7 (shipped) — personal convoy: extending the player's own cargo hold
Slice 4's freight convoys are stationary at a colony, hauling *that colony's*
goods. This slice is the travel-companion mirror: a `status:"convoy"` fleet
ship rides **with the player**, resolving on the per-jump travel-ambush
cadence (`maybeAmbush`, combat.js) instead of a per-cycle timer.

- `assignConvoy(shipId)` / `recallConvoy(shipId)` — only an **idle ship docked
  at its own home port** can come aboard (there's no "current location"
  tracked for idle ships beyond `home`, so the player must physically
  rendezvous with it); indefinite until recalled, same as `logistics`/
  `mission`.
- **Cargo**: `convoyCargoBonus()` sums convoy-status freighters' `cap`
  (damaged ones haul less, same `hull/hullMax` shape as `escShipFP`), added
  straight into `cargoCap()` — but capped at `convoyCargoCeiling()`
  (`BASE_CARGO + upgrades.cargo*150`, i.e. the player's *own* Cargo Hold
  investment). Upgrading Cargo Hold raises both your own hold and the
  convoy's usable ceiling, so the two reinforce rather than one making the
  other pointless — a real second hold, not a way to skip the upgrade.
- **Cost**: `convoyFuelSurcharge()` adds +8% fuel per jump per convoy ship
  (any role), capped at +50% — hooked into `fuelCost()`. This is the second
  lever against just stacking cheap freighters past the cargo ceiling: it
  keeps climbing with zero further cargo benefit once you're capped.
- **Escort**: `convoyGuardCount()` = convoy-status **warships** *plus* any
  pirate band currently `bandFollowing()` — reusing that mechanic as-is (a
  following band already travels with you every cycle, `processBandSupport`;
  this just gives that state a second job). Guards damp travel-ambush odds
  in `maybeAmbush()` (`×0.45^guards`, the same shape `processConvoys` already
  uses for stationed colony guards), and if an ambush slips through anyway,
  `convoyAmbushRisk(lvl)` swipes at one convoy freighter — damage/credit loss
  scaled by `1/(1+guards)` (again reusing `processConvoys`' own formula),
  hull 0 → lost with its cargo.
- A ship on convoy duty can't be scrapped until recalled. UI: a "🚚 Personal
  Convoy" card in the Fleet tab's Assignments sub-tab (bonus cargo + ceiling,
  fuel surcharge, guard count/odds, roster + recall, add-ship buttons scoped
  to idle ships docked here) and convoy status in the roster + Operations
  board. No galaxy-map marker — unlike a stationed logistics convoy, a
  personal convoy has no fixed planet to pin.
- Deliberately **out of scope for this slice**: convoy warships/bands don't
  yet add firepower to actually *fighting* an ambush that occurs (`
  encounterFight()` has no multi-actor machinery today, unlike raid combat's
  `combatStrike()`) — a natural, separately-audited follow-up once this
  slice's numbers have been played. Exports added. Tests: `convoy.test.js`.

## Slice 8 (shipped) — vicinity-gated raid support + pooled multi-hostile engagements
Two changes to raid combat, requested together: fleet support (both
`raidSummonFleet`'s 2-ally slot and `deployBattleGroup`) previously answered a
raid from anywhere, with zero distance check — reversing Slice 3/5's original
"100% callable, any prey, no distance/odds" design. And when a coalition raid
target's distress call succeeded (`maybeRescue`), reinforcements trickled in
one at a time and had to be fought in a strict FIFO queue (`promoteOrEnd`) —
the player could never choose a target, and incoming fire (already
simultaneous) didn't feel like a real group fight.

- **Vicinity gate**: a new ship status, `"patrol"` (`assignPatrol(shipId,
  planetId)` / `recallPatrol(shipId)`, fleet.js) — not colony-restricted like
  `assignLogistics`, since raids happen anywhere. `fleetRaidable()` now returns
  only `status:"patrol"` ships whose `station` matches `S.location`; both
  `raidSummonFleet` and `deployBattleGroup` read it, so the gate covers both
  mechanics at once. `recallBattleGroup`/`releaseBattleGroup` restore
  `status:"patrol"` (not `"idle"`) for a ship with a station, so it stays on
  call for the *next* raid at that world without needing reassignment.
  `scrapShip`'s duty-block list gained `"patrol"`. UI: a "🎯 Patrol here"
  button in the Fleet tab roster (mirrors the Logistics-assignment button),
  and a hint in `preyCombatCard` pointing idle-but-unassigned owners at the
  Fleet tab.
- **All-at-once rescue arrival**: `maybeRescue` pulls in *every*
  currently-eligible non-pirate contact from `_others` at once (still capped
  at `RESCUE_PACK_CAP`, 2) rather than splicing in one ship per successful
  roll. (Superseded: the ambient 20%-per-round trigger described here is gone
  from live combat — a rescue now only lands through the 📡 distress-call
  intent telegraph, `assignRaidIntents`/raidResolveDepartures in raiding.js;
  `maybeRescue`'s own unforced roll survives only for direct/legacy callers.)
- **Pooled targeting**: new `S.raidTargets` (indices into `allHostiles(S.prey)`)
  with `raidToggleTarget(idx)`/`raidFocusTarget(idx)`, mirroring Escort's own
  `escortToggleTarget`/`escortFocus` exactly. `combatStrike` pools player +
  ally + Battle Group damage into one total and splits it evenly across
  whatever's selected — defaulting to every living hostile when nothing is
  picked, same default Escort uses. `allyStrike` changed from "compute and
  apply to one hardcoded target" to "just compute and return a number" (the
  same shape `battleGroupFirepower()` already had) so it can feed the shared
  pool. New `raidResolveKills(anchor, killed)` handles a salvo that kills more
  than one hostile at once: non-anchor kills are spliced straight out of the
  pack; if the anchor itself died, the **existing** `promoteOrEnd` is reused
  unchanged (it already promotes a survivor or clears the engagement) — now
  triggered only for that one case rather than on every kill.
  `raidExtort`/`raidSpareRecruit`/`raidDisengage` are untouched — per-
  encounter narrative actions, not per-shot combat, deliberately out of scope.
- UI: `preyCombatCard`'s old one-line pack-count pill is replaced by a
  per-hostile roster (mirrors `renderEscort`'s `foeCards`) with an hp bar and
  Target/Focus buttons per hostile. Battle Group's Vanguard/Line/Reserve
  tiering (the "assign which of *your* hulls tank vs. attack" mechanic) is
  completely unchanged — it already operates independently of which specific
  enemy hostile is engaged. Exports added. Tests: `raidvicinity.test.js`,
  `raidpool.test.js`.

This completes the player fleet: build → mission → ally → haul → battle group
→ personal convoy → vicinity-gated, pooled raid combat.

## Slice 9 (shipped) — patrol becomes "Follow me"
Reverses the "pin to one world" half of Slice 8's vicinity gate, on request:
pinning a warship to a single world meant it was invisible to a raid at any
other world, requiring a manual recall + reassign every time the player
changed operating areas.

- `assignPatrol(shipId)` (fleet.js) drops its `planetId` parameter entirely —
  `s.station` is simply never set (`null`) for this duty anymore. The ship
  status is still `"patrol"` internally (the on-call duty itself hasn't
  changed, only what used to pin it to one world), but it now means "follows
  the player everywhere."
- `fleetRaidable()` drops its `s.station === S.location` clause — every
  `status:"patrol"` warship is raidable everywhere, always. `raidSummonFleet`
  drops its own copy of the same check. `battleGroupStandDown` simplifies
  from `s.status = s.station ? "patrol" : "idle"` to unconditionally
  `"patrol"`, since every ship reaching `"battle"` status came from
  `fleetRaidable()`, which now only ever contains following ships.
- `fleetPresentAt(pid)` (shared with Slice 7's fleet-sourced pirate intel)
  changes its patrol clause from `s.station === pid` to `pid === S.location`
  — a following ship is present only where the player currently is. This is
  the one real narrowing: a following ship can no longer grant intel about a
  world other than the player's current one (the logistics/idle-at-home
  clauses right next to it are untouched and still cover that for their own
  duties).
- UI: "🎯 Patrol here" → "🛰️ Follow me" (`renderFleetFortunes.js`, no `pid`
  argument anymore); the galaxy map's patrol pill (`renderCore.js`) now keys
  off `p.id === S.location` instead of `s.station`, so it only ever lights up
  on the card for wherever the player currently stands; the Operations board
  (`renderOps`) gained a row for `"patrol"` status ships (it previously had
  none) since that's now the more useful place to see "who's following me"
  from any world. No `SAVE_VERSION` bump — an existing save's
  `status:"patrol"` ships keep working; their stale `station` value is simply
  never read again. Tests: `raidvicinity.test.js` (rewritten), `galaxymap.test.js`.

## Slice 10 (shipped) — fix: the Escort tab's rally list used the wrong pool
The Escort tab's "your own warships" section (`renderSettlement.js`) listed
`fleetRaidable()` as its callable-hulls pool — before Slice 9 that function
meant "idle warships," so it happened to line up with what `escortRallyFleet`
actually requires (`status:"idle"`). Slice 9 redefined `fleetRaidable()` to
mean "warships following the player" (`status:"patrol"`), which the Escort
list never picked up on: it started showing following ships as callable
(they'd always refuse, "that ship isn't available," when clicked) while
hiding genuinely-available idle ships docked right at the player's own
location.
- New **`fleetEscortable()`** (fleet.js): `status:"idle"` warships with
  `home === S.location` — a distinct pool from `fleetRaidable()`. Following
  duty is for raid support wherever the player roams; rallying a convoy
  departing from here only ever makes sense for a hull that's actually
  docked here.
- `escortRallyFleet(shipId)` gained the matching `s.home !== S.location`
  refusal it was always missing — defense in depth, not just a UI-list fix,
  so a stale UI or direct call can't rally a hull from anywhere else either.
- `renderSettlement.js`'s rally list now reads `fleetEscortable()` instead of
  `fleetRaidable()`.

Tests: `escortfleet.test.js` (5 checks, including a render-level check that
the button offered for a following ship is gone and the idle local one now
appears).

## Slice 11 (shipped) — tanker hulls & autonomous Tanker Runs
No hull anywhere had a "speed"/travel-time stat — a player jump (`travel()`,
economy.js) always resolves in exactly one cycle regardless of distance or
convoy contents; only the Escort tab's contracts modeled multi-cycle travel,
and that's tied to accepting a contract, not to freely dispatching your own
fleet. Tankers needed a genuinely slow, background-risk delivery mechanic —
modeled directly on `assignFleetMission`/`processFleet`'s existing shape
rather than inventing a new core-loop state.
- **New hull family** (`FLEET_SHIPS`, `role:"tanker"`): `tanker_coastal`/
  `tanker_medium`/`tanker_super`/`tanker_ultra`, tiers 1–4, reusing `cls` for
  hull/str scaling exactly like freighters (`fleetIsHauler(def)` now covers
  both roles in `fleetShipHullMax`/`fleetShipStr`/`fleetShipUpkeep`). A new
  `speed` field (0–1, only tankers have it) reads through `fleetShipSpeed(def)`
  — every other hull implicitly defaults to `1`, so no existing hull's
  behavior changes. Tier gating is free: `orderShip`'s existing
  `def.tier > yard` check plus the base Small Shipyard's own `tiers:2`
  ceiling means only Tier 1–2 tankers build at a base, Tier 3–4 need a
  colony Shipyard — no new gating code.
- **Tanker Run** (`assignTankerRun(shipId, destId, escortIds)`): dispatches
  an idle tanker to haul fuel to another known world. Loads fuel onto it (up
  to `shipCargoCap(s)`, so a base Small Shipyard Cargo Loadout refit just
  works) via the same `shipyardLocalStorage`/`canAffordMats`/`payMats`
  sourcing every other build/repair action already uses — local stockpile
  first, hold for the rest. Any chosen idle warships docked at the *same*
  home ride along as escorts (`status:"tanker_run"`, `s.escortFor`). Run
  state lives directly on the ship (`s.run = {to, dist, totalCycles,
  cyclesLeft, fuel, escorts}`), the same shape `s.mission` already uses for
  fleet missions. `tankerRunCycles(dist, speed)` — `dist/(3*speed)`, clamped
  2–12 — reuses the Escort contract's own `dist/3` leg shape, so a slower or
  farther-bound tanker visibly takes longer, and a run is always genuinely
  "multiple cycles."
- **Risk, ticked in `processTankerRuns()`** (called from `processFleet`,
  alongside `processConvoys`): pirate ambush uses the exact
  `processConvoys` shape (`(0.05+lvl*0.04) * 0.45^guards`, hull + fuel loss
  scaled down `/(1+guards)`, hull ≤0 destroys the tanker) — an escorting
  warship damps this. Authority interception only rolls once
  `S.pirate.wanted >= 25` (the same threshold `maybeInterdict`, outlaw.js,
  already uses), independent of escorts (hired muscle doesn't make customs
  less suspicious) — on a hit it confiscates the carried fuel and a modest
  fine/rep hit (a seizure, not a firefight, so no hull damage), mirroring
  the existing customs-bust shape (economy.js).
- **Delivery**: a player colony/base destination tops up its
  `storage.fuel`; anywhere else, the remaining fuel sells at `sellPrice`.
  The tanker (and any escorts) return to idle with `home` updated to the
  destination — it's physically there now, same abstraction fleet missions
  already use.
- `recallTankerRun(shipId)` only works before the run has ticked
  (`cyclesLeft === totalCycles`) — restores the loaded fuel onto the ship
  itself (`s.fuel`, see Slice 12) rather than refunding it to storage, since
  it never actually left port; frees the ship and its escorts. No mid-run
  recall; a run always resolves via delivery or loss. `scrapShip` also
  refuses a ship mid-run, same as every other duty status.
- **UI** (renderFleetFortunes.js): a third "⛽ Tankers" roster section
  alongside Warships/Freighters, a live in-transit status line
  (destination + cycles left), and a new "Dispatch a tanker run" card
  (`tankerRunForm`, mirrors `fleetMissionForm`) with ship/destination
  selects, escort toggle buttons, a live cycle/risk estimate, and the
  dispatch button.
- State: `s.speed` is a static hull-def field (no migration); `s.run`/
  `s.escortFor` are new optional per-ship fields, `s.status` gains a new
  `"tanker_run"` value — no `SAVE_VERSION` bump needed. Exports:
  `fleetIsHauler`, `fleetShipSpeed`, `tankerRunCycles`, `tankerRunGuards`,
  `assignTankerRun`, `recallTankerRun`, `processTankerRuns`,
  `setTankerRunField`, `toggleTankerEscort`. Tests: `tanker.test.js`
  (11 checks).

## Slice 12 (shipped) — Tanker Load/Unload
Slice 11 only ever loaded a tanker automatically, at the moment a run was
dispatched (`assignTankerRun`'s own local-storage/hold top-up). There was
no way to stage a tanker's cargo ahead of time, see how much it was
carrying while idle, or reclaim/redistribute fuel without committing to a
full run. Fixed with two new manual actions, gated exactly like every
other "you must physically be at this ship's dock" fleet action (repair,
reassign, refit, personal-convoy boarding): `s.status === "idle" && s.home
=== S.location`.
- New per-ship field `s.fuel` — an idle tanker's own onboard cargo, sitting
  outside of any run (`s.run.fuel` is a separate, run-scoped amount that
  only exists in transit). No migration needed; undefined reads as 0
  everywhere via the usual `|| 0` convention.
- **`loadTanker(shipId)`**: tops the ship up to `shipCargoCap(s)`, drawing
  fuel from whatever's here — **base first, then colony** (a deliberate,
  explicit reversal of `shipyardLocalStorage`/`localStockpileAt`'s
  colony-first precedence used everywhere else in the codebase, chosen
  because that's the exact order asked for). No Shipyard required — just
  a base or colony storeroom to draw from, same reasoning
  `localStockpileAt` already uses for repairs.
- **`unloadTanker(shipId)`**: drains the ship's fuel, filling destinations
  in order — the player's own ship tank (`fuelCap()`) first, then the base,
  then the colony (mirroring Load's own base-before-colony order), and
  finally **sells** whatever's left at `sellPrice` for credits. A single
  click empties the tanker sensibly with no destination picker needed.
- `assignTankerRun` now treats any already-loaded `s.fuel` as a head
  start: it tops up only the shortfall (`cap - already`) from local
  storage/hold, instead of re-deriving the whole load from scratch. A
  tanker topped off ahead of time via `loadTanker` dispatches with that
  fuel already committed.
- **UI** (renderFleetFortunes.js): the roster's tanker spec line shows
  `🛢️N loaded` whenever `s.fuel > 0`; two new conditional buttons on an
  idle, home-docked tanker's row — ⬆️⛽ Load (shown only when there's local
  fuel to draw and room to take it) and ⬇️⛽ Unload (shown only when the
  tanker is actually carrying something).
- Tests: `tanker.test.js` (+5 checks: base-before-colony load ordering
  capped at the hull's own cargo capacity, load/unload refusing a ship
  that isn't idle-and-docked-here or has nothing to move, the full
  player-tank → base → colony → sell unload cascade, and `assignTankerRun`
  correctly topping off pre-loaded fuel rather than ignoring it).

## Slice 13 (shipped) — reinforce a tanker run already under way
Escorts could only ever be chosen at the moment a run was dispatched
(`assignTankerRun`'s `escortIds` argument) — there was no way to send more
protection to a tanker already traveling if, say, a pirate-active route was
discovered only after it left port. `escortRallyFleet` (Slice 3/8) already
solved the identical problem for the Escort tab's own convoy — rallying
more hulls into an *already-active* mission — so this is that same shape,
just for a Tanker Run.
- **`reinforceTankerRun(tankerId, warshipId)`** (fleet.js): the warship
  must be idle and docked at the *same home port the tanker itself
  departed from* (`w.home === s.home`) — the only place it could
  plausibly set out from to catch up — and the tanker must actually be
  `status:"tanker_run"`. On success the warship joins `s.run.escorts`
  exactly like one assigned at dispatch: it counts toward
  `tankerRunGuards(s)` for every remaining cycle (damping
  `tankerRunPirateRisk`'s odds and severity from that point on), and is
  freed and relocated to the destination on delivery, or freed on loss,
  through the exact same escort-release code the original escorts
  already used — no special-casing needed since reinforcements and
  dispatch-time escorts are indistinguishable once aboard.
- **UI** (renderFleetFortunes.js, Assign view): a new "🛡️ Reinforce a
  tanker run" card lists every ship currently `tanker_run` (destination,
  cycles left, live escort count, and its home port), with one button per
  idle warship docked at that same home port to send it immediately — no
  form state needed, each button is a direct action like the Logistics
  card's own "Assign guard" buttons.
- Tests: `tanker.test.js` (+6 checks: a same-home reinforcement joins and
  raises the guard count; a wrong-home, busy, or non-warship ship is
  refused; refused entirely for a tanker not on a run; a mid-run
  reinforcement measurably reduces pirate damage/fuel loss the same as a
  dispatch-time escort; and a reinforcement is freed/relocated on delivery
  exactly like an original escort).

## Slice 14 (shipped) — Fleet Status roster scales past ~30 ships
The roster (`renderFleet`'s `status` view, renderFleetFortunes.js) grouped
ships into three fixed role buckets with no sort, filter, search, collapse,
or pagination — every ship in a bucket was a full-detail row in whatever
order it was built. Fine at 5 ships (the `fleetadmiral` milestone's own
threshold); a wall of rows once a save's fleet passes 30.
- **Numeric-aware name sort**: each role bucket is now sorted by
  `s.name.localeCompare(..., {numeric:true})` instead of build order, so
  same-class hulls (auto-named `"<Class> N"` by `fleetNameFor`) cluster in
  a sane order — `Corvette 2` before `Corvette 10`, not after.
- **Collapsible groups**: clicking a role header (`toggleFleetGroup(role)`)
  collapses/expands it — session-only state (`fleetGroupCollapsed`, not
  saved), same pattern as `subViews`. The header always shows a count
  (`shown/total` once a filter is narrowing it).
- **At-a-glance status line + quick filters**: a summary (`N idle · N on
  duty · N damaged · N building`) always shows once the fleet is non-empty.
  Once the fleet exceeds 8 ships, a filter-button row (All/Idle/On
  duty/Damaged/Building) and a name search box appear
  (`fleetRosterFilter`, `setFleetRosterFilter`) — same session-only-var
  idiom as `marketSort` (renderProgression.js). "Damaged" matches
  `fleetRepairCost`'s own definition of needing repair (`hull < hullMax`,
  any missing hull) rather than the roster bar's `<60%` warn/bad
  threshold — shipped first keyed off the bar color, then fixed: that
  threshold hid ships sitting at, say, 80% hull that already show a 🔧
  repair button and cost, so a player scanning "Damaged" for anything
  worth topping off before a raid missed them.
- **Search box focus fix**: the search box (`#fleetRosterSearch`) live-
  filters on every keystroke via `renderFleet()`, which rebuilds the whole
  `#panel-fleet` DOM (`el.innerHTML = ...`) — dropping browser focus after
  every letter, unlike the chat draft input (renderCombat.js), which
  sidesteps the same trap by simply never re-rendering on keystroke (not
  an option here, since the whole point is a live-updating list).
  `renderFleet()` now saves `document.activeElement`'s selection range
  before the rebuild when it's the search box, and restores focus + caret
  position on the freshly-created input afterward.
- Deliberately out of scope: no change to per-ship action buttons, to the
  Assignments/Shipyard sub-views, or to any fleet domain logic in
  fleet.js — this is a roster-list *rendering* reorg only.

## Slice 15 (shipped) — empty Tanker Runs, and Load/Unload by a specific quantity
Two rough edges from Slices 11/12: `assignTankerRun` refused to dispatch a
tanker with zero fuel aboard and none available at its home, even though
sending an empty tanker to reposition it (or to load up at the destination
instead) is a perfectly reasonable thing to want; and `loadTanker`/
`unloadTanker` only ever moved the maximum possible amount in one direction,
with no way to move a smaller, specific amount.
- **`assignTankerRun`**: dropped the `fuel <= 0` refusal — a run's `fuel`
  can now legitimately be `0`. The dispatch log/toast reads "casts off ...
  empty" instead of "with 0 fuel" when that's the case.
- **`tankerRunDeliver`**: an empty arrival (`r.fuel <= 0`) now logs simply
  arriving at the destination, skipping the storage-topup/sell branch
  entirely (topping up or selling `0` fuel was harmless but read oddly).
  Non-zero delivery is unchanged.
- **`loadTanker(shipId, qty)`** / **`unloadTanker(shipId, qty)`**: both take
  a new optional `qty`. Omitted (or `null`), behavior is unchanged — load
  tops off to `shipCargoCap(s)`, unload drains everything aboard. Given, it's
  clamped to what's actually movable (remaining room + local fuel for load;
  fuel actually carried for unload) and only that much moves — unload's
  player-tank → base → colony → sell cascade still applies, just to the
  requested amount instead of the ship's full cargo.
- **UI** (renderFleetFortunes.js): the roster's ⬆️⛽ Load/⬇️⛽ Unload buttons
  each gained a `qty`-style number input (`loadqty-<id>`/`unloadqty-<id>`,
  defaulting to the max movable amount, same convention as the Market tab's
  buy/sell quantity boxes) feeding new `loadTankerQty`/`unloadTankerQty`
  wrappers that read the input and call `loadTanker`/`unloadTanker` with it
  — `tankerLoadQty`/`tankerUnloadQty` remember the last typed value per ship
  across re-renders, mirroring `marketQty`. The "Dispatch a tanker run"
  card's Dispatch button is no longer disabled at zero available fuel — only
  an unpicked destination disables it — and its Load stat line notes
  "(dispatching empty)" when there's nothing to load.
- Tests: `tanker.test.js` (+4 checks: dispatching with no fuel anywhere
  still starts a run with `run.fuel === 0`; an empty run delivers cleanly
  without touching an owned world's storage or paying out credits at a
  foreign one; `loadTanker`/`unloadTanker` move exactly a requested amount,
  clamped to what's actually available/carried).

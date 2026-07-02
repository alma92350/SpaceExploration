# Player Fleet — colony shipyards

Your own ships, built at colony **Shipyards** — loyal, fully commanded, no loot
cut. The trade vs hired pirate bands: you pay to **build**, **upkeep**, and
**repair** them, and they can be damaged or lost, in exchange for 100% control.

## Slice 1 (shipped) — construction, roster, upkeep, repair
- **Shipyard** colony building (`colonyBuildingList`, 4 tiers, `req: metallurgy`).
  One colony = one shipyard (colonies are one-per-planet). Tier gates the biggest
  hull and the number of **slipways** (parallel builds = tier).
- **Ship catalog** (`FLEET_SHIPS`): freighters (light/medium/heavy/bulk — cargo
  `cap`) and warships (corvette/frigate/cruiser/battleship — combat stats from
  `SHIP_CLASSES`). Each has a credit+material `cost`, a `build` time in cycles,
  and a `tier`.
- **Construction**: `orderShip` (at the docked colony) validates shipyard tier,
  free slipway, and affordability; debits credits + materials from your hold; adds
  a `status:"building"` ship to `S.fleet` that `processFleet` (in `endTurn`) ticks
  down to `idle`.
- **Upkeep**: `fleetUpkeep` (non-building ships) charged each cycle in
  `processFleet`, reported to the 💰 Cycle accounts ledger as "fleet upkeep".
- **Repair** (`repairFleetShip`) and **scrap** (`scrapShip`, ~40% metals salvage)
  at the ship's home shipyard.
- **Reassign home shipyard** (`reassignShipyard`) — an idle ship can re-register
  its home port to whatever colony you're currently docked at, provided that
  colony's Shipyard tier can service it (`def.tier <= yard`, same gate as
  construction). Costs a flat logistics fee (`shipyardReassignCost`, 8% of the
  ship's credit cost, floored at 200cr) — for consolidating a fleet built
  piecemeal across several colonies, since repair, convoy assignment (Slice 7)
  and slipway accounting are all keyed off `home`.
- **UI**: new **✦ Fleet tab** (`renderFleet`, `#panel-fleet`, `TAB_LADDER` entry
  unlocking once you hold a colony) — roster (warships / freighters, hull bars,
  status, repair/reassign/scrap) + the current colony's shipyard build menu.
- State: `S.fleet` (freshState + init migrate). Exports: `orderShip`, `scrapShip`,
  `repairFleetShip`, `reassignShipyard`. Tests: `fleet.js`, `reassign.test.js`.

## Stats
- `fleetShipHullMax` / `fleetShipStr` derive from `SHIP_CLASSES` (warships) or
  cargo `cap` (freighters); `fleetShipUpkeep` scales with class str / capacity.

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

## Slice 3 (shipped) — combat allies
- **Raids**: `raidSummonFleet(shipId)` brings an idle warship in as a loyal ally
  (`fleetAsAlly`, `share:0` — no loot cut). 100% callable (any prey, no distance/
  odds); shares the 2-ally cap with band allies. `allyStrike` already handles a
  band-less ally (fp 1.0). Buttons in `preyCombatCard` (pirate + faction prey).
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

## Slice 5 (shipped) — Battle Group: fleet-vs-fleet raid combat
Individual fleet allies (`raidSummonFleet`, slice 3) are still capped at the 2-ally
wing. **Battle Group** is a separate, additive mechanic: deploy your **whole idle
warship fleet at once** into a raid as a pooled formation, fought with an
escort-style posture — reusing `ESCORT_POSTURES` (screen/balanced/press) directly.

- `deployBattleGroup()` — marks every `fleetRaidable()` ship `status:"battle"`.
  `recallBattleGroup()` frees them anytime, no penalty, hull as-is.
- `battleGroupFirepower()` — pooled strength of the group (battered ships fire
  less, same `hull/hullMax` factor as `escShipFP`), scaled by posture `.off`.
  Added to `combatStrike`'s damage against `prey` each round alongside ally damage.
- `battleGroupScreenMult()` — while a group is deployed, ALL incoming fire to the
  player is scaled by posture `.def` (hooked into `foeStrikes`, same insertion
  point as the Fortunes `incomingMult` hook) — **screen** protects you, **press**
  exposes you more (mirrors escort semantics exactly).
- `battleGroupTakeFire(prey)` — each round a group member takes real damage
  scaled by the prey's strength and posture `.def`; a ship at 0 hull is
  **destroyed and removed from the fleet** (same `_dead` purge pattern as convoy
  ambush/fleet missions). Real stakes: fielding a fleet against a strong foe can
  cost you ships.
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

This completes the player fleet: build → mission → ally → haul → battle group
→ personal convoy.

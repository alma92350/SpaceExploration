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
- **UI**: new **✦ Fleet tab** (`renderFleet`, `#panel-fleet`, `TAB_LADDER` entry
  unlocking once you hold a colony) — roster (warships / freighters, hull bars,
  status, repair/scrap) + the current colony's shipyard build menu.
- State: `S.fleet` (freshState + init migrate). Exports: `orderShip`, `scrapShip`,
  `repairFleetShip`. Tests: `fleet.js`.

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
- `battleGroupTakeFire(prey)` — each round a random group member takes real
  damage scaled by the prey's strength and posture `.def`; a ship at 0 hull is
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

## Galaxy map markers
`renderGalaxy` now shows pills for fleet missions (🎯), stationed convoys (🚚),
and pirate mandates (📜) at the planets they're running at, alongside the
existing pirate/crisis/signal pills — so the map surfaces everything the
Operations board tracks, spatially. Tests: `galaxymarkers.js`.

This completes the player fleet: build → mission → ally → haul → battle group.

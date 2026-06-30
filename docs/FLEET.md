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

## Roadmap
- **Slice 2 — Fleet missions**: assign warships to system mandates (cull/protect/
  raid) at **100% of the take** + upkeep instead of a fee (extends the mandate
  engine; ship class drives yield).
- **Slice 3 — Combat allies**: warships callable into raids & escorts as loyal,
  free allies (no desertion, no cut).
- **Slice 4 — Freight convoys**: freighters cut logistics/freight costs with
  piracy ambush risk, mitigated by escorting warships.

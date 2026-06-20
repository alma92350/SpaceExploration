# Convoy Escort — design & balance notes

The 🛡️ **Escort** tab is an expert-gated, fleet-command combat mode that
mirrors the raid engine for *defense*. The player accepts a contract, commands
a whole fleet, and pools its firepower against ambushers — splitting it equally
across the targets they choose — while shepherding freighters to port.

## Unlock (expert gate)
`TAB_LADDER` entry `escort`: requires the **raid** tab already unlocked **and**
a real combat record — `(bountyKills + raids) >= 12` **or** a Letter of Marque
completed (`commissionsDone > 0`). No early cycle fallback (it's expert);
`showAllTabs` still reveals it.

## Fleet model
`S.escort = { active, offers[], mission, fleet[], wave, posture, targets[], jam }`,
plus `S.escortRep` (guild reputation, persisted in the save).

- **Flagship** — the player's ship; hull/subsystems are `S.pirate.*`, and only it
  can field-repair. Each salvo it expends ammo for the best weapon it can afford
  (`escortFlagWeapon()` → `payAmmo`); firepower scales to that weapon's mult, so
  running out of energy/torpedo/antimatter rounds drops it back to free kinetic.
- **Escorts** — armed, `SHIP_CLASSES`-scaled hull & firepower; count grows with
  guild rank (2 → 4).
- **Freighters** — the payload; little firepower. Losing them cuts the fee.

Pooled firepower `escortFirepower()` = Σ each living ship's FP × posture offense
(wounded ships shoot less).

## Combat
- **Equal split** (the signature mechanic): selected targets each take
  `F / |targets|`. Focus-fire = one target; spread = suppress many.
- **Sub-system targeting** (applies to every selected foe): 🎯 Hull = full
  damage; 🔫 Weapons / 🛡️ Defenses / 🚀 Engines deal half damage but blunt the
  foe's return fire (`dmgMul`), strip its armor so your hits land harder
  (`vuln`), or cripple its drive (`eng`).
- **Break off**: once every *living* attacker's engines are crippled none can
  pursue, so the convoy can disengage and continue to the next leg (forfeiting
  any loot from the survivors).
- **Loot**: a destroyed attacker drops a fraction (`ESCORT_LOOT_FRAC = 0.3`) of
  its bounty + credits (to your purse) and cargo (into the hold) — the rest is
  slag. On top of the contract fee, but deliberately tempered so escorting isn't
  a money fountain.
- **Postures**: 🛡️ Screen (escorts body-block freighters via intent redirection,
  −offense), ⚖️ Balanced, ⚔️ Press (+offense, +incoming).
- **Enemy archetypes & telegraphed intent**: 🏴‍☠️ Raider→freighters,
  ⚡ Interceptor→highest-FP escort, 💢 Gunship→flagship; a ☠️ Marauder Lead
  anchors high-threat waves. Each foe announces its next target so the player can
  prioritise. Enemies fire on that declared intent; intents recompute each round.
- **Boss abilities** (elite, ~50%/round): 💥 Alpha Strike (doubled hit),
  📣 Rally (whole wave +40% this round), 📡 Jammer (next salvo → 70%).
- **Field repair** patches only the flagship and costs that round's salvo.

## Pre-mission prep & the deadline
Threat is **dynamic** (`escortLiveThreat`): it tracks current pirate activity at
both route endpoints (`pirateLevel(from)`/`pirateLevel(to)`). After accepting a
contract you get a **prep window** — roam freely (you're only combat-locked
during an active ambush) and hunt pirates in the ⚔️ Raider tab at the origin or
destination; every kill there (`pirateKillRewards` lowers `S.pirates[id]`) cuts
the convoy's threat before you set out. The **fee is locked** at the contract's
original threat, so cleaning up keeps the pay and cuts the risk.

But the contract has a **cycle deadline** (`mission.deadline = accept turn +
cycleBudget`, where `cycleBudget = legs + max(4, dist/3)`). Every cycle — prep,
travel, or a leg — counts. `escortDeadlineCheck()` (called from `endTurn`) fails
the run with `escortFail("timeout")` if you overrun (never mid-ambush; timeout
doesn't cripple the flagship). Cycles-left and live threat show in the panel.

## The journey (phase 3)
- Each leg = one cycle (`endTurn`) + fuel. Per-leg fuel = `fuelCost(dest) × 1.15
  / legs`, i.e. the whole run costs about a normal one-way jump plus 15% for the
  convoy, spread over the legs (stored as `mission.legFuel`). Ambush risk ramps
  as the convoy nears its destination; low fuel blocks the next leg.
- **Between-leg yard repair** (phase 4): out of combat, repair escorts &
  freighters to full for credits + metals + electronics — a sink that keeps long
  runs viable.
- Delivery pays `reward × survivingFreighters/total` (+flawless bonus), moves the
  player to the destination, and grants guild reputation.

## Outfitting the convoy (assign weapons / drones / AI cores)
Spend your hold of 🔫 weapons, 🛸 combat drones and 🧠 AI cores to bolt
**attack** and **defense** onto any fleet ship (flagship or the freighters/escorts
you guard). Assets are **consumed** (a money sink); once committed they sit in a
fleet pool you can shuffle between ships, and are gone when the run ends.

- 🔫 Weapons → flat attack (`OUTFIT_WPN_AP`).
- 🛸 Drones → flat attack (strike) **or** mitigation (screen, `OUTFIT_DRONE_DP`).
- 🧠 AI cores → **multiply** a ship's attack or defense with diminishing returns
  (`outfitAiBoost`, caps at +60%); mitigation overall caps at 60%.
- Per-ship capacity by hull (`shipOutfitCap`): flagship 8, freighters 2, escorts
  scale with class — harden a couple of ships, not all.
- `escOutfitAttack` feeds `escShipFP` (more pooled firepower); `escOutfitMitig`
  cuts incoming damage in `escortEnemyTurn` (best spent on freighters).
- Re-rig dockside or between legs for free; **mid-ambush re-rigging forfeits the
  round** (`pendingRedeploy` → `escortBraceRound`).

## Escort Guild ranks
`ESCORT_RANKS`: Freelancer (0) → Contractor (60) → Convoy Master (160) → Fleet
Commander (320). Higher rank → reward multiplier (up to ×1.40) and more escorts.
Reputation gain per delivery ≈ `(10 + threat·40)·survivorFrac (+10 flawless)`.

## Balance (sim: `/tmp/escortbal.js`)
A simple AI (focus weakest, repair flagship when low) across tiers gives
~**81–87% win**, ~**5 rounds/run**, ~**6–7k cr** per successful multi-leg run,
with ~20–30% failure. Enemy waves scale with `veterancy()` and contract threat,
so it stays challenging and is not a money fountain. A thinking player does
better by reading intent, screening freighters, and killing the foe about to
hit cargo first.

## Tests
- `escort.js` — MVP: gate, fleet build, firepower pooling, equal split, enemy
  fire, wave-clear, reward scaling, flagship-loss failure.
- `escort2.js` — archetypes, telegraphed intent, screen body-block, elite spawn.
- `escort3.js` — guild ranks/perks, reward & fleet scaling, leg = cycle + fuel,
  low-fuel block, reputation + promotion, elite abilities, jammer debuff.
- `escort4.js` — between-leg yard repair (cost, full heal, out-of-combat guard),
  sound-cue names, galaxy destination marker.

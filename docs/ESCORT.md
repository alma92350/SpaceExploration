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
- **Postures**: 🛡️ Screen (escorts body-block freighters via intent redirection,
  −offense), ⚖️ Balanced, ⚔️ Press (+offense, +incoming).
- **Enemy archetypes & telegraphed intent**: 🏴‍☠️ Raider→freighters,
  ⚡ Interceptor→highest-FP escort, 💢 Gunship→flagship; a ☠️ Marauder Lead
  anchors high-threat waves. Each foe announces its next target so the player can
  prioritise. Enemies fire on that declared intent; intents recompute each round.
- **Boss abilities** (elite, ~50%/round): 💥 Alpha Strike (doubled hit),
  📣 Rally (whole wave +40% this round), 📡 Jammer (next salvo → 70%).
- **Field repair** patches only the flagship and costs that round's salvo.

## The journey (phase 3)
- Each leg = one cycle (`endTurn`) + `ESCORT_LEG_FUEL` fuel; ambush risk ramps as
  the convoy nears its destination. Low fuel blocks the next leg.
- **Between-leg yard repair** (phase 4): out of combat, repair escorts &
  freighters to full for credits + metals + electronics — a sink that keeps long
  runs viable.
- Delivery pays `reward × survivingFreighters/total` (+flawless bonus), moves the
  player to the destination, and grants guild reputation.

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

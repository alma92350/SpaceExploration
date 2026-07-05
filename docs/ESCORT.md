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
- **Postures**: 🛡️ Screen (−offense, noticeably less damage taken overall),
  ⚖️ Balanced, ⚔️ Press (+offense, +incoming).
- **Formation** (`FORMATION_SLOTS`/`FORMATION_TIERS`/`shipFormation`, reused
  as-is from the Raid tab's Battle Group, fleet.js): every convoy ship —
  flagship, escorts, freighters — sits in 🛡️ Vanguard, ⚔️ Line or 🌌 Reserve
  (`setEscortFormation(fi, slot)`, fleet-index based like `setVesselStance`).
  `escortFrontTier()` (mirrors `battleGroupFrontTier`) is whichever tier,
  checked front-to-back, currently has living ships — 85% of each round's
  targeting draws only from that tier, 15% is stray fire reaching the whole
  fleet, so Reserve is very safe but never perfectly so. Tier also weights
  `escShipFP`: Line hits hardest (`fpMult` 1.20), Vanguard tanks but hits
  softer (0.85), Reserve hits softest (0.70). `buildEscortFleet` defaults
  freighters to Reserve and the flagship/escorts to Line; Vanguard starts
  empty, so nothing is forced into the riskiest slot without the player's
  own choice.
- **Enemy archetypes & telegraphed intent**: 🏴‍☠️ Raider→freighters,
  ⚡ Interceptor→highest-FP escort, 💢 Gunship→flagship; a ☠️ Marauder Lead
  anchors high-threat waves. This role preference is now a *secondary* filter
  applied within whichever pool Formation exposes that round (`chooseIntent`)
  — a raider can't reach a freighter tucked into Reserve behind a holding
  Vanguard except on the rare stray-fire roll. Each foe still announces its
  resolved target so the player can prioritise; intents recompute each round
  (moving a ship mid-round doesn't retroactively dodge an already-telegraphed
  hit — only the *next* round's `assignIntents()` sees the new formation).
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
cycleBudget`, `cycleBudget = legs + slack`, `slack = 1..5` — 🔴 Rush to 🟢
Relaxed). Every cycle — prep, travel, or a leg — counts. `escortDeadlineCheck()`
(from `endTurn`) fails the run with `escortFail("timeout")` on overrun (never
mid-ambush; timeout doesn't cripple the flagship). Cycles-left and live threat
show in the panel.

**Reward is multi-parameter & partly opaque.** The fee blends payload, distance,
threat, guild-rank multiplier, a **rush premium** for tight windows, and a hidden
**market swing** (~±16%) — so two similar postings can pay differently and the
true reward/risk ratio isn't transparent. A quiet **promptness bonus** (≈3% of
the fee per spare cycle at delivery) rewards fast runs, so prepping to cut threat
trades against a quicker, better-paid delivery.

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

## Per-vessel combat stance & fit
Each vessel flies a **stance** (`VESSEL_STANCES`) and you buy up to **3 levels of
fit** for the active stance, paid from your hold of 🔫 weapons, 🛸 drones, 🧠 AI
cores. Fit is **consumed** for the run; switching stance is free (the level is
tracked per stance, so each can be built up independently).

- ⚔️ **Aggressive** — bonus firepower (`atk` up to +55%), no extra armor.
- ⚖️ **Balanced** — a modest mix of attack and mitigation.
- 🛡️ **Defensive** — mitigation up to 32% (capped at `OUTFIT_MIT_CAP` 60%), no
  attack bonus.
- `stanceProfile(sh)` yields `{atk, mit}`: `atk` multiplies `escShipFP` (pooled
  firepower); `mit` cuts incoming damage in `escortEnemyTurn`.
- **Cost** (`vesselUpgradeCost`) scales with the stance's asset mix
  (`STANCE_COST_W`), the level, and the vessel's size (`vesselSizeFactor`:
  flagship ×2, freighters ×0.6, escorts by class). Max level by type
  (`vesselMaxLevel`): freighters Lv2, everything else Lv3. The UI shows the exact
  cost on each upgrade button and flags what you're short on (buy more at the
  Market).
- `setVesselStance` / `upgradeVessel` are the actions. Mid-ambush changes set
  `pendingRedeploy` → you must `escortBraceRound` (forfeit the round).

## Escort Guild ranks
`ESCORT_RANKS`: Freelancer (0) → Contractor (60) → Convoy Master (160) → Fleet
Commander (320). Higher rank → reward multiplier (up to ×1.40) and more escorts.
Reputation gain per delivery ≈ `(10 + threat·40)·survivorFrac (+10 flawless)`.

## Balance (sim: `/tmp/escortbal.js`)
A simple AI (focus weakest, repair flagship when low) across tiers gives
~**81–87% win**, ~**5 rounds/run**, ~**6–7k cr** per successful multi-leg run,
with ~20–30% failure. Enemy waves scale with `veterancy()` and contract threat,
so it stays challenging and is not a money fountain. A thinking player does
better by reading intent, keeping freighters in Reserve, and killing the foe
about to hit cargo first.

## Tests
- `escort.js` — MVP: gate, fleet build, firepower pooling, equal split, enemy
  fire, wave-clear, reward scaling, flagship-loss failure.
- `escort2.js` — archetypes, telegraphed intent, screen body-block, elite spawn.
- `escort3.js` — guild ranks/perks, reward & fleet scaling, leg = cycle + fuel,
  low-fuel block, reputation + promotion, elite abilities, jammer debuff.
- `escort4.js` — between-leg yard repair (cost, full heal, out-of-combat guard),
  sound-cue names, galaxy destination marker.
- `escortformation.test.js` — default formation (freighters Reserve,
  flagship/escorts Line), `setEscortFormation` validation, `escortFrontTier`
  fallthrough as tiers empty, tier-gated-then-role-preference targeting,
  `escShipFP`'s tier scaling, and the roster's formation badges/move buttons.

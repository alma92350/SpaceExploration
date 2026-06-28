# Pirate bands — a persistent relationship layer

A roster of named pirate crews (`S.pirateBands`) you build lasting history with,
spanning raids and escorts. (Decisions: named bands; auto loot rate from
rep+level+dread; rep raised by ally-calls, your dread, credits, valued cargo and
deeds; full build.)

## Model
`band = { id, name, ico, level 1-5, rep -100..100, encounters, fought, allied,
gifted, lastSeen, status }`. Tiers (`bandTier`): ☠️ Hostile (<-40) · 🤨 Wary ·
😐 Neutral · 🤝 Friendly (≥41) · 👑 Sworn (≥76).

Transient foes/allies are tied to a band via `bindBand(foe, preferAlly)` — 60%
reuse a known crew (so history accrues), else `newBand`. Standings drift toward
neutral over time (`decayBands`, ±1/cycle).

## Collaboration (rep) changes
- **Ally calls** (`raidCallAllies`): +6 each, `allied++` — repeated alliances
  deepen trust.
- **Sparing**: foe flees +4, disengage +3 (you let the crew live).
- **Fighting at your side** then winning: +4.
- **Killing a band** (`raidWinPirate`): −30 (`fought++`).
- **Gifts**: credits tribute (`giftBandCredits`, ≈+1 rep / 400 cr, cap +15) and
  valued cargo (`giftBandCargo` — weapons/AI/luxury/fuel/drones worth more).
- **Dread**: not stored on the band, but your `S.pirate.dread` shaves their loot
  demand and desertion odds (they respect a fearsome name).

## Loot-share negotiation (raids)
`bandLootShare(b)` = `0.18 + level·0.04 − rep/100·0.12 − min(.10, dread/100·.10)`,
clamped 0.05–0.45. Each called ally stores its `share`; `lootShare()` (the
player's cut) = `max(0.1, 1 − Σ ally.share)`. Sworn-enemy bands (Hostile) refuse
to rally at all.

## Escort recruitment
Friendly/neutral bands hire on as escort ships (`escortRecruitBand`, up to
`ESCORT_MAX_HIRED` = 5; `escortDismissBand` releases one to free a slot, no
refund, returning any outfitted gear to the fleet pool):
`escortRecruitFee = (800 + level·700)·(1 − rep/100·0.4)` — friends cheaper. The
hired ship's hull/firepower scale with band level. Each leg, `escortBetrayalCheck`
rolls desertion at `bandBetrayChance = clamp(0..0.5, 0.26 − rep/100·0.32 −
min(.18, dread/100·.18))` — low standing deserts, your dread keeps them honest.
Surviving a delivery raises the band's rep (+8); deserting drops it (−12).

## Surfacing
- **🏴‍☠️ Contacts** sidebar tab (`renderContacts`, ladder-gated: unlocks once
  `S.pirateBands` is non-empty): a card per band with standing bar,
  personality, feud, history, ally cut / hire fee / desert risk, and tribute +
  gift buttons.
- Raid call-allies log shows each band and its negotiated cut.
- 🛡️ Escort staging → **🤝 Hire pirate escorts** card (out of combat) with fee
  and desertion-risk per band.

## Contacts tab sub-views + Mandates
The Contacts panel is split via the shared `subTabBar` into **🤝 All contacts**,
**📍 Around here** (crews based in the current system + its pirate-activity meter),
and **📜 Mandates**.

- **Mandates** (`MANDATE_TASKS`, `S.mandates`): commission a band to work a chosen
  system for `MANDATE_DURATIONS` (3/6/9) cycles. Pay an upfront `mandateFee`
  (scales with band level, duration, distance, task `feeMul`, minus a standing
  discount); bank a `cut` of each cycle's take (`mandateCycleYield`, paid lump at
  completion). `processMandates` (in `endTurn`) accrues the cut and applies world
  effects; `cancelMandate` recalls early (keep accrued, forfeit fee).
- Tasks: **🎯 cull** (lawful — suppresses local `pirateLevel`, cut of bounties),
  **🛡️ protect** (lawful — steady suppression + fees), **🏴 raid** (piracy — fattest
  cut but +Wanted/cycle and faction rep loss, no suppression). The raid Wanted is
  **waived when you hold a letter of marque against the target system's faction**
  (`commissionCovers`) — sanctioned, though they still resent it. `mandateAct` caps
  yield scaling (`MANDATE_ACT_CAP`) so one mandate can't milk an infested system.
- A commissioned band is `bandOnMandate` + `busyUntil`, so it can't be called for
  support, hired/rallied for a convoy (`escortRecruitableBands`/`escortRecruitBand`
  refuse it), or double-booked until the run ends. But it sits at its contract
  world (`b.loc = planet`), so if you go **raiding that same system** it's in the
  area and can be summoned as a raid ally (`bandsRaidable`, distance 0) — joining
  the fight without dropping its mandate. Tests: `mandatebusy.js`.
- **Balance** (`mandatebal.js`, 3k runs/case): cull ROI +12–68% at active systems
  (−29% on a clean one — don't farm empties), protect ~+26% steady, raid +20–73%
  but +15–22 Wanted over the run plus faction anger. Tests: `mandates.js`.

## Tags, location & call-for-support (brotherhood)
- **Tags** (`BAND_TAGS`: ⭐ Brotherhood, 🟢 Ally, 👁️ Watch, 🔴 Rival; `setBandTag`,
  toggle): a player label shown next to the band's name everywhere (Contacts,
  Escort hire/roster, raid ally/foe cards). Brotherhood/Ally tags are "loyal" and
  raise call-for-support odds.
- **Location** (`band.loc`, set on `bindBand` to where you crossed them; `newBand`
  seeds a random home): shown with distance (`bandDistance`) on cards.
- **Call for support** (`callBandSupport`, from Contacts): a band in your system
  falls in at once (on-call); a distant one rolls `bandSupportOdds` (rep +
  brotherhood + dread − distance, nil if busy) and, if it answers, is **inbound**
  for `~dist/4` cycles, then **on-call** for `BAND_ONCALL_DURATION` (4) cycles
  (`processBandSupport` in `endTurn`). A refusal sets a short `busyUntil`.
  - Raid: `raidSummonOnCall` brings an on-call band in as an instant ally.
  - Escort: `escortRallyOnCall` adds an on-call band as a **free volunteer**
    escort ship (`support:true` — doesn't count against the hire cap, never betrays).
- **Managing a summoned crew** (Contacts buttons):
  - `bandFollow` — once a crew is standing by, ask them to ride with you for
    `BAND_FOLLOW_DURATION` (6) cycles; `processBandSupport` retargets `band.loc`
    to your location each cycle so they jump where you jump and stay callable
    anywhere. Re-calling extends the window. On expiry they peel off, leaving a
    short on-call tail. `bandFollowing` / `bandOnCall` treat a follower as on-call.
  - `bandStandDown` — send an inbound (recall) or on-call/following crew home
    early, clearing their support state. Tests: `followctl.js`.
- **Allied pirates in any raid (incl. letter of marque)**: the raid action card
  offers `raidSummonOnCall` for **faction** prey too (not just pirate prey), so
  allied crews can join your privateer hunts against coalition shipping. Summonable
  crews (`bandsRaidable`) are the standing-by/following ones **plus willing crews
  based in the system you're hunting** ("on site") — so you don't always have to
  pre-call. Crews set to **follow** auto-join a fresh engagement via
  `raidJoinFollowers` (from `engageTarget`), up to the 2-ally cap, skipping blood
  rivals; you can't summon the crew you're fighting. When no crew is on the scene
  but you have willing friends elsewhere, the card hints to call them or have one
  follow. Tests: `marque.js`, `marque2.js`.

## Pirate-proposed smuggling runs
- A band you're friendly with (`eligiblePirateClients`: active, willing, rep ≥ 10)
  may post a **smuggling contract** in the 🛡️ Escort offers
  (`genPirateEscortContract`, ~55% chance one replaces a normal posting): run their
  `PIRATE_CARGO` contraband to a destination.
- vs a legit escort (`m.pirate` flag): **~1.5–2× pay** (better the higher your
  standing), **+threat** (law patrols, `threatRand +0.12`), and on delivery —
  **big crew standing** (`m.repBand`), **+Dread** (`m.dread`), **+Wanted**
  (`m.heat`), and a **rep hit at the destination's faction** — but **no
  Escort-Guild or legit-faction credit**. Accepting nudges standing up a little.
- Bailing (`abortEscort`) or losing the cargo (`escortFail`) **burns the crew's
  trust** (−rep). Tests: `smuggle.js`.

## Personalities & feuds (polish)
Each band rolls a **personality** (`BAND_PERSONALITIES`) that flavours its
numbers: 🤑 Greedy (bigger cut/fee, flaky, *steals*), 🛡️ Loyal (cheaper, rarely
deserts), ⚔️ Bold (+22% firepower as ally/hire), 🦊 Cunning (*steals*),
⚖️ Honorable (loyal, slight firepower). Modifiers feed `bandLootShare` (+cut),
`escortRecruitFee` (×fee), `bandBetrayChance` (+betray) and ally/hire firepower
(×fp).

~35% of new bands carry a **feud** with an existing band (`feudWith`, mutual,
with a **depth 1–3** in `feudDepth`). A band won't ally or hire on while its rival
already serves you (`bandRivalServing` → `bandWillAlly` / recruit refusal), and
**siding with one band angers its rival** (−8 rep on ally or hire, `bandFoe`).

**Brokering peace** (`reconcileBands`, Contacts card 🤝 button): pay
`bandReconcileCost` — `1500 × depth`, discounted by the two crews' average standing
and your Dread (cheaper when they trust/fear you), pricier for hostile crews,
floored at 300 — to settle the feud for good. Both `feudWith`/`feudDepth`/`truceUntil`
clear, both crews gain +4 rep, and they can serve side by side thereafter.

**Temporary truce** (`brokerTruce`, 🕊️ button): a cheaper alternative —
`bandTruceCost` ≈ 35% of the full cost — buys `BAND_TRUCE_DURATION` (6) cycles of
peace. `truceUntil` is set on both bands; `bandTruceActive` makes `bandRivalServing`
stand down so they can serve together meanwhile. The feud isn't cleared — when the
window lapses (`processTruces` in `endTurn`) it smoulders back. Re-buy to extend.
Tests: `feud.js`.

**Spare & recruit** (`raidSpareRecruit`): once a pirate is beaten to ≤35% hull
(`raidCanSpare`) a "🤝 Spare crew" action appears in the raid — hold fire and the
crew lives, owing you (+20 rep), then the engagement promotes/ends.

**Richer betrayal:** a Greedy/Cunning turncoat (personality `steal`) doesn't just
bolt — it makes off with a **freighter** (a delivered-cargo loss), not merely
deserting.

## Tests
`/tmp/bands.js` (19 checks): roster persistence, tiers, loot-share by
rep/level/dread, gifts (rep + inventory spend), ally negotiation + player cut,
hostile refusal, kill penalty, recruit fee scaling + hiring, betrayal odds +
desertion.
`/tmp/bands2.js` (12 checks): personality modifiers (cut/fee/betray/firepower),
feud refusal to co-serve + rival anger, feud co-hire block, spare-&-recruit,
thieving-turncoat freighter theft.

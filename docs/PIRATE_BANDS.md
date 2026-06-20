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
Friendly/neutral bands hire on as escort ships (`escortRecruitBand`, max 2):
`escortRecruitFee = (800 + level·700)·(1 − rep/100·0.4)` — friends cheaper. The
hired ship's hull/firepower scale with band level. Each leg, `escortBetrayalCheck`
rolls desertion at `bandBetrayChance = clamp(0..0.5, 0.26 − rep/100·0.32 −
min(.18, dread/100·.18))` — low standing deserts, your dread keeps them honest.
Surviving a delivery raises the band's rep (+8); deserting drops it (−12).

## Surfacing
- ⚔️ Raider tab → **🏴‍☠️ Pirate Contacts** card: roster with tier/rep/history,
  tribute + gift buttons.
- Raid call-allies log shows each band and its negotiated cut.
- 🛡️ Escort staging → **🤝 Hire pirate escorts** card (out of combat) with fee
  and desertion-risk per band.

## Personalities & feuds (polish)
Each band rolls a **personality** (`BAND_PERSONALITIES`) that flavours its
numbers: 🤑 Greedy (bigger cut/fee, flaky, *steals*), 🛡️ Loyal (cheaper, rarely
deserts), ⚔️ Bold (+22% firepower as ally/hire), 🦊 Cunning (*steals*),
⚖️ Honorable (loyal, slight firepower). Modifiers feed `bandLootShare` (+cut),
`escortRecruitFee` (×fee), `bandBetrayChance` (+betray) and ally/hire firepower
(×fp).

~35% of new bands carry a **feud** with an existing band (`feudWith`, mutual).
A band won't ally or hire on while its rival already serves you
(`bandRivalServing` → `bandWillAlly` / recruit refusal), and **siding with one
band angers its rival** (−8 rep on ally or hire, `bandFoe`).

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

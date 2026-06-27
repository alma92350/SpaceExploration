# Fortunes — temporary boons & banes ("drops")

Temporary modifiers the player picks up that create moments of hope and
unpredictability and reward seeking. Buffs are **boons**, negatives are
**banes**. Code namespace: `fx` / `S.fx`.

## Design goals
- **Pleasure of searching** — most boons come from *doing/exploring* (first
  visits to new worlds, research breakthroughs, ambient luck), not a menu. The
  dedicated signal/Investigate "hunt" is slice 2.
- **Hope** — there's always a nonzero chance each cycle (`maybeFortune`, 12%).
- **Unpredictable** — what you get is hidden until it lands; phase-gated variety.

## Engine (game.js)
- `FX` — definition table keyed by effect. Each: `{ ico, name, kind:'boon'|'bane',
  domain, phases:[...], weight, mods:{tag:val}, blurb, clearCost? }`.
- `S.fx = [{ key, cyclesLeft, gained }]` — active effects (freshState + init migrate).
- Effects are **read at point of use**, never mutate base stats:
  - `fxAdd(tag)` — additive sum (tags: `actions`, `buyDisc`, `sellPrem`).
  - `fxMult(tag)` — `1 + Σ`, floored at 0.1 (tags: `weaponMult`, `incomingMult`,
    `researchMult`, `influenceMult`, `repMult`, `fuelMult`, `lootMult`).
- **Hooks**: `actionsMax`/`actionsLeft` · `playerStrikes` (weaponMult) ·
  `foeStrikes` (incomingMult) · `buyPrice`/`sellPrice` · `research` (researchMult) ·
  `doPolitics` (influence/rep) · `fuelCost` · `plunder` (lootMult).

## Balance
- **Duration is inverse to strength** (`fxDuration`): an impact budget
  `FX_BUDGET / fxStrength` × jitter, clamped 1–20 cycles; banes ×1.25 so they
  sting a little longer. A punchy +20% weapon boon ≈ 5 cyc; a gentle effect ≈ 10+.
- `FX_MAX_ACTIVE = 4`; granting when full evicts the soonest-expiring effect.
- No duplicate stacking — re-granting the same key **refreshes** its duration.
- Banes are gentle and always wear off; clearable ones (`clearCost`) can be
  bought off at any time (`clearFx`); others (e.g. Ion Storm) just expire.

## Acquisition (slice 1)
- **Exploration** — first arrival at a new world: 30% (80% boon / 20% bane).
- **Research** — 8% boon after a research action.
- **Ambient** — 12% each cycle end (`maybeFortune`, 68% boon / 32% bane).
- Phase pool (`gamePhase`: early/mid/late from turn + net worth + office/career)
  filters which effects can roll, so variety shifts as the game grows.

## Catalog (slice 1, 12)
Boons: ⚡ Overclocked Reactor (+1 action) · 💥 Gun Runners' Cache (+20% weapon) ·
🛰️ Salvaged Plating (−18% incoming) · 🤝 Trade Winds (buy−12%/sell+10%) ·
🔬 Eureka (+35% research) · 🏛️ Political Capital (+40% inf, +50% rep) ·
⛽ Clean Burn (−25% fuel) · 🏴‍☠️ Feared Name (+25% raid credits).
Banes: 🧯 Reactor Leak (−1 action, clear 600) · 🚨 Customs Crackdown
(buy+/sell−, clear 800) · 🕳️ Ion Storm (−18% weapon, wears off) · 🔧 Saboteur
(+18% incoming, clear 700).

## UI
- `renderFortunes()` — active chips under Ship stats: icon, name, cycles left,
  green/red, plus a 🧹 clear button on clearable banes. `clearFx` is exported.

## Tests
`fortunes.js` (24 checks): engine, inverse duration, refresh-not-stack, cap +
eviction, every system hook, tick/expiry, clear (and non-clearable), phase
gating, HUD render.

## Roadmap
- **Slice 2 — the hunt**: faint *signals* ("anomalous readings near X" / drifting
  caches) you spend an action+fuel to **Investigate** → weighted roll with rarity
  tiers; signals decay if ignored. The core "pleasure to search" loop.
- **Slice 3**: full catalog across all domains, deeper phase-gating, richer bane
  mitigation, and a `fortunebal.js` tuning sim.

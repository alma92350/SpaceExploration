# 🚀 Stellar Frontier

A browser-based space exploration & economy game. Pilot the **S.S. Wanderer**
across a sector of **ten worlds** — extract raw materials, refine them through
**multi-step production chains**, trade across living markets, smuggle
contraband past customs, court rival **factions**, and climb the political
ladder until you secure your legacy as **Sector Governor**.

No build step, no dependencies. Just open it in a browser.

## ▶️ Play

```bash
# open directly…
xdg-open index.html        # Linux
open index.html            # macOS

# …or serve it (recommended) and visit http://localhost:8000
python3 -m http.server 8000
```

Progress saves automatically to the browser's `localStorage`.
Use the **⟲ New** button (top-left) to start over.

## 🎮 How to play

Each **cycle** you get **4 actions** for local work (extraction, production,
research, politics). **Travelling** burns fuel and advances a cycle. Use
**End Cycle ▸** to refresh actions, drift the markets, and roll random events.

## ⛏️ The economy: a tiered production chain

```
EXTRACT ─▶ RAW ─refine─▶ REFINED ─fabricate─▶ COMPONENTS ─assemble─▶ FINISHED / LUXURY
```

**20 commodities across 6 tiers.** No world makes everything, so profit comes
from moving materials along the chain and across the map.

**Markets have depth.** Prices react to *your* trades: dumping a big load
crashes the local price (with diminishing returns per unit), and bulk buying
spikes it. Markets recover toward equilibrium over a few cycles, so lasting
wealth comes from spreading trades across worlds and time — not from one giant
sell. (The *Galactic Exchange* tech deepens liquidity to soften the hit.)

- **Raw** — Ore, Crystals, Radioactives ☢️, Ice, Biomass, Spice, Helium-3, Relics 🏺
- **Refined** — Metals, Energy Cells, Fuel, Chemicals, Medicine
- **Components** — Alloys, Electronics
- **Finished** — Consumer Goods, Machinery, Weapons 🔫
- **Luxury / Strategic** — Luxury Goods, Antimatter 🌀

**Energy Cells power production** — almost every refining and manufacturing
step needs them, so energy is the heartbeat of your industry.

## 🌍 Extraction is bound to specific worlds

You can only harvest what a world actually holds, using four methods:

| Verb | Resources | Needs |
|------|-----------|-------|
| ⛏️ **Mine** | Ore, Crystals, Radioactives, Ice | Mining Laser boosts yield |
| 🌿 **Forage** | Biomass, Spice | Bio-Harvester boosts yield |
| 🎈 **Capture** | Helium-3 (gas giants) | **Gas Scoop module required** |
| 🏺 **Exploit** | Relics (ancient ruins) | risky near lawful space |
| 🧲 **Salvage** | Metals + Electronics from wrecks | **Salvage Rig required** |
| 🎯 **Bounties** | Credits + influence (lawless worlds) | Shield reduces risk |

## 🪐 The ten worlds

| World | Type | Faction | Extract |
|-------|------|---------|---------|
| **Terra Nova** | Capital / Garden | Core Authority ⚖️ | Biomass, Spice |
| **Glacius** | Ice World | Core Authority | Ice, gas |
| **Ferros Prime** | Mining | Mining Guild ⛏️ | Ore, Crystals, Radioactives |
| **Verdani** | Agri-world | Agri-Combine 🌾 | Biomass, Spice |
| **Helix Belt** | Asteroid Belt | Mining Guild | Ore, Crystals, Radioactives, Salvage |
| **Kybernet** | Tech Hub | Tech Syndicate 🔬 | Crystals |
| **Nimbus** | Gas Giant | Frontier Coalition 🛰️ | Helium-3 |
| **Forge Station** | Industrial | Mining Guild | Ore (best manufacturing) |
| **Oort Reach** | Frontier Outpost | Frontier Coalition | Ore, Radioactives, Relics, Salvage, Bounties |
| **Erebus** | Ancient Ruins | Frontier Coalition | Relics, Radioactives, Salvage, Bounties |

Each world has its own **industry level, tech level, market prices, controlling
faction** and **law enforcement** strength.

## 🏗️ Bases — passive production while you roam

Establish a permanent **outpost** on any world, then build modules that work
**automatically every cycle — even while you're light-years away**:

- **Hydroponic Farm / Spice Plantation** — auto-forage food & spice
- **Automated Mine / Crystal Quarry / Isotope Mine / Ice Harvester / Gas
  Skimmer / Excavation Site** — auto-mine whatever that world holds
  (location-bound, like hand extraction)
- **Solar Array** — generate Energy Cells anywhere
- **Storage Depot** — expand the base stockpile

Each base has its own **storage**; dock there to deposit/withdraw cargo (or
**Store all cargo** in one click). Build a network of farms, mines and depots
across the galaxy and let them fill up while you trade, fight and politick
elsewhere. Stored goods count toward your net worth.

## 🏛️ Politics, factions & trade law (the deep end)

- **Five factions** — Core Authority, Mining Guild, Agri-Combine, Tech
  Syndicate, Frontier Coalition. Build **reputation** through trade, lobbying
  and missions; friendly factions give you better prices and lighter customs.
- **Contraband** — Radioactives, Relics, Weapons and Antimatter are illegal on
  some worlds. Carrying or selling them risks a **customs bust** (seizure +
  fine + Core reputation loss). The **Smuggler's Hold**, **Shielded Hold**,
  good local standing and Senator/Governor titles all reduce the risk — the
  lawless rim (Oort, Erebus) barely checks at all.
- **Missions** — faction- and resource-themed contracts, including delivery
  runs and shady smuggling jobs that pit the Frontier against the Core.
- **Governor Decrees** — once you rule the sector, declare a **Trade Monopoly**
  (passive income each cycle) and a **Sell Tariff** (+15% to your sell price on
  a chosen commodity).

## 🛠️ Fifteen ship upgrades (3 tiers each)

Cargo Hold · Fuel Tanks · Ion Engine · Mining Laser · Bio-Harvester ·
**Gas Scoop** · **Salvage Rig** · Fabricator Module · Fusion Reactor ·
Research Lab · Deflector Shield · **Shielded Hold** · **Smuggler's Hold** ·
Trade Computer · Diplomatic Suite.

## 🔬 Technology tree

Fourteen techs across extraction (Deep-Core, Xeno-Biology, Cloud Skimming,
Salvage Drones), refining/manufacturing unlocks (Metallurgy, Microelectronics,
Fission Reactors, Fuel Cracking, Biotech, Munitions, Antimatter Containment),
markets, diplomacy, and the legacy-capping **Terraforming**.

## 🏆 Winning — your legacy

Complete all four to win:
- Amass **75,000 credits** net worth
- Research **Terraforming** (top of the tech tree)
- Become **Sector Governor** (top of the political ladder)
- **Visit all ten worlds**

Each objective sets off **fireworks** and an announcement; the final one
triggers a grand golden **finale**. 🎆

## 🗂️ Project structure

```
index.html   — layout & markup
style.css    — neon-space UI theme
game.js      — all game logic (economy, factions, production, rendering, save)
```

Everything is plain HTML/CSS/JS — tweak the data tables at the top of
`game.js` (commodities, planets, recipes, upgrades, techs, missions, factions)
to make the sector your own.

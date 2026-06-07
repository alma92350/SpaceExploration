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

**Construction needs materials, not just credits.** Founding a base and
building/upgrading modules consumes commodities from your hold — **metals**
for everything, plus **electronics** for high-tech modules (Solar Array, Gas
Skimmer, Isotope Mine, Crystal Quarry, Excavation Site). Bring the materials
or make them on site.

## 🌍 Colonies — develop a planet's economy

Frontier worlds marked **colonizable** can be settled and grown into thriving
economies. Found a colony, then develop it:

- **Population & happiness** — your citizens grow when fed and content, and
  leave when starving or overtaxed.
- **Buildings** — Habitat Domes (housing), Agri-Domes (food), Factories
  (+industry, auto-build goods), Research Campuses (+tech, passive research),
  Spaceports (trade & tax), and resource extractors for the world's deposits.
- **Taxes** — set a tax rate for steady credit income (but high taxes sour the
  mood).
- **Develop the economy by importing** — ship food, alloys, energy and goods to
  the colony to keep people happy and feed its factories. As population and
  buildings grow, the world's **industry and tech levels rise**, improving
  production, research and prices there.

Colonies live and grow **every cycle, even while you're away**. A populous
colony is a major asset toward your net worth.

### Living colonies — stakes & defense

A colony can be lost as well as grown:

- **Pirate raids** strike frontier worlds, stealing stockpiles and credits.
  Build a **Garrison** 🛡️ to repel them and keep order.
- **Disasters** fit the world: volcanic worlds suffer **eruptions** that damage
  buildings, lush worlds catch **plagues**, others lose harvests to **blight**.
- **Booms** occasionally bless a colony with migrant waves or trade windfalls.
- **Unrest & secession** — let happiness collapse for too long and unrest
  builds until the colony **revolts and declares independence**, lost for good.
  Keep your people fed, supplied and fairly taxed (a Garrison buys you time).

Growing a frontier colony into a thriving 25k-population capital is its own
**legacy objective** toward winning the game.

### Logistics network — hands-off supply

Once a colony has a **Spaceport** 🛰️ it joins your **logistics network**. Set a
target stock level ("keep stocked to N") for any key commodity and each cycle
the network maintains it automatically:

1. **Free redistribution** — surplus on your other networked colonies is shipped
   in first, at no cost. A farm world can feed a factory world; specialise your
   colonies and let the network balance them.
2. **Market import** — any remaining shortfall is bought from market and
   delivered, for a logistics fee.

Higher Spaceport tiers **lower the fee** (30% → 10%) and **raise throughput**
(how much can move per commodity per cycle), so a busy capital can keep itself
fed and stocked without you ever ferrying cargo by hand.

## 🔭 Exploration — chart the unknown

Beyond the charted worlds lie **hidden planets**. Run a **Deep-Space Survey**
(in the Galaxy tab) to discover them — a Research Lab sharpens your sensors.
Newly found worlds (jungle Pandora, shattered Tartarus, paradise Elysium) are
prime, untouched colony sites. Two colonizable worlds (Aurora, Cinder) are
charted from the start; the rest are yours to find.

## 🏛️ Politics, factions & trade law (the deep end)

- **Five factions** — Core Authority, Mining Guild, Agri-Combine, Tech
  Syndicate, Frontier Coalition. Build **reputation** through trade, lobbying
  and missions; friendly factions give you better prices and lighter customs.
- **Contraband** — Radioactives, Relics, Weapons and Antimatter are illegal on
  some worlds. Carrying or selling them risks a **customs bust** (seizure +
  fine + Core reputation loss). The **Smuggler's Hold**, **Shielded Hold**,
  good local standing and Senator/Governor titles all reduce the risk — the
  lawless rim (Oort, Erebus) barely checks at all.
- **Faction standing** — your reputation sits on a scale from Hostile →
  Disliked → Neutral → Friendly → **Allied**. Allies (rep ≥ 60) sell cheaper,
  pay more, and their customs look the other way on contraband.
- **Career missions** — the milestone ladder (relief, ore pacts, smuggling,
  Senate, Governorship).
- **Time-bounded contracts** — factions post fresh **supply** and **smuggling**
  jobs every few cycles: deliver a commodity to one of their worlds before the
  deadline for credits, influence and reputation. Let one expire and you lose
  standing with that faction. There's always a rotating board of work.
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

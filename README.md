# 🚀 Stellar Frontier

A browser-based space exploration & economy game. Pilot the **S.S. Wanderer**
across a sector that's **different every game** — extract raw materials, refine them through
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
| 🏴‍☠️ **Raid** | Plunder ships on the lanes (the outlaw path) | **Weapon Systems**; see below |

## 🏴‍☠️ Raiding — the outlaw's life

Arm up with **Weapon Systems** and turn pirate. From the **Raid** tab, **Prowl**
the shipping lanes to find prey — fat, well-escorted Luxury Liners and Patrols
near lawful worlds, leaner Haulers and Smugglers out on the rim. Then choose how
to take them:

- **⚔️ Attack** — fight for the cargo; win and you plunder their hold, credits and
  fuel (taking hull damage; your **Deflector Shield** softens the blow).
- **☠️ No Quarter** — show the crew no mercy: extra **Dread**, but extra **Wanted**.
- **💀 Extort** — once you're feared enough, captains pay **tribute** without a
  shot fired. Build Dread through attacks, then reap it safely.

Three meters define the outlaw:

- **💀 Dread** — your fearsome name. Boosts your raid power and makes prey
  surrender to extortion. The cutthroat's snowball.
- **🎯 Wanted** — the bounty on your head. Climbs with every raid (worst for
  Core liners near lawful space), draws **bounty hunters**, and cools when you
  lie low on the lawless rim.
- **🛡️ Hull** — your ship's integrity. Combat wears it down; **repair** for
  credits at any world. Let it hit zero and your ship is **crippled** — cargo
  jettisoned and a costly tow home.

Crime pays well — until the whole sector wants you dead.

## 🪐 The core worlds — a rotating roster

There are **15 core trade worlds**, but **each new game features a random 9 of
them**, so every playthrough charts a different sector with a different economy,
faction balance and starting world. The 5 colonizable colony worlds are always
present.

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
| **Aquaria** | Ocean World | Agri-Combine | Biomass, Ice |
| **Pyralis** | Desert World | Core Authority | Crystals, Radioactives |
| **Cobalt Hub** | Free Port | Tech Syndicate | Crystals, gas |
| **Korrath** | Warlord World | Frontier Coalition | Ore, Radioactives, Relics, Salvage, Bounties |
| **Vesper** | Twilight World | Mining Guild | Ore, Crystals, gas |

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

### 🏛️ Power & Organizations — the politician's machine

Research the **Galactic Charter** to start building a political machine. Found
**organizations** that run automatically every cycle, draw a credit **upkeep**,
and unlock active abilities — fund them or they downsize in a scandal. Choose
your colours along a **bright / grey / dark** spectrum:

- **People's Movement** 📣 — a party that grows public support and stages rallies.
- **Lobbying Firm** 🤝 — turns money into influence, cycle after cycle.
- **Media Network** 📺 — polish your image (Spin) or **smear** rivals for cheap popularity.
- **Charitable Foundation** 🕊️ — builds legitimacy and calms colonies — and **launders** dirty money.
- **Intelligence Cell** 🕵️ — counter-surveillance that keeps the heat off.
- **Private Security** 🛡️ — guards your worlds, intimidates opponents, and **shakes down** the economy for slush.

Four **power meters** track who you're becoming:

- **Popularity** — public support; wins hearts, calms unrest.
- **Legitimacy ⟷ Notoriety** — statesman or crook; trust slowly follows it.
- **Heat** — suspicion from dirty deeds; let it boil over and a **scandal breaks**.
- **Slush fund** — dirty credits you must **launder** before spending cleanly.

Clean power is slow and poor; dirty power is fast and fragile — navigate the grey.
Jump straight in with the **🏛️ Politics** new-game button (charter, war chest,
influence and a starter party).

### ⚖️ The Senate — write the law of the sector

Win a **Senate Seat** (Career Missions) to legislate. The five factions are
**voting blocs** whose seats scale with the worlds they control. Propose a
**Bill** (costs influence) and it goes to the floor, where each bloc votes on:

- the bill's **stance** toward them (does it help or hurt their interests),
- your **standing** with them, plus the **public mood** and your **legitimacy**,
- and any **lobbying** (spend influence) or **bribes** (spend slush — dirty, and
  it raises Heat and costs legitimacy) you apply to swing their vote.

Win the tally and the bill becomes a **standing law** that reshapes the whole
sector economy until you repeal it — for example:

- **Free Trade / Tariff / Mining Rights** — move sell & buy prices sector-wide.
- **Spice Prohibition / Legalization** — rewrite what counts as contraband.
- **Deregulation / Martial Law** — slash or spike customs-bust risk everywhere.
- **Universal Basic Income** — treasury cost each cycle for popularity & calm.
- **Anti-Corruption Act** — makes *your own* dirty deeds generate far more Heat.
- **Emergency Monopoly Grant / Immunity Act** — naked self-dealing (governor only).

A popular statesman passes reforms on merit; a notorious operator has to buy the
votes. Either way, the laws you write change the game everyone — including you —
is playing.

### 🚨 Investigations & trials — Heat has consequences

Let your **Heat** run hot and the faction most opposed to you opens a **corruption
investigation**. A case file builds each cycle — faster the hotter you run,
slower the more **legitimacy** you've banked (and an Anti-Corruption law on the
books makes it build faster still). Reach **100 evidence** and you're indicted.

You can fight the case — cleanly or otherwise:

- **Lawyer Up** — credits build a real legal defense and chip at the evidence.
- **Bribe the investigator** — slush makes evidence vanish, but it can backfire.
- **Spin** (Media), **Bury Evidence** (Intel), **Strong-arm witnesses** (Security)
  — your organizations earn their keep, each with its own risk.
- **Scapegoat** — pin it on one of your own organizations and dissolve it to make
  the case collapse.
- **Face the Trial now** — gamble on the current evidence if you think you'll win.

At **trial**, the evidence is weighed against your legitimacy, popularity, the
defense you built, and your standing with the prosecutor — for a verdict that
ranges from **acquittal** through **fines**, **censure**, **removal from office**
and **imprisonment** (you lose cycles in detention while your machine runs on),
all the way to **disgrace & exile** that wipes your political career to the
ground. Crime can pay — until it doesn't.

### 🗳️ Office & Elections — three routes to power

Climb a ladder of public office — **Councillor → Senator → Sector Governor →
First Consul** — and claim each rung **three different ways**:

- **🗳️ Election** — win at the ballot box on your **popularity** (and a campaign
  chest). The clean, populist route; victory builds legitimacy.
- **🤝 Appointment** — get an **allied faction** to install you with **influence**
  and money. Backroom power, no public mandate, and rivals resent the deal.
- **⚔️ Coup** — seize power by force with your **Private Security** and slush. It
  craters your legitimacy, enrages every faction, spikes Heat — and it can fail
  catastrophically.

**Terms expire.** Hold an elected or appointed office only while your support
holds up (popularity keeps decaying, so keep campaigning); hold a seized office
only while you keep the muscle. Fall short at term's end and you're demoted.

Reach the summit and you complete a **political legacy** whose title reflects how
you ruled — **The Statesman** (clean and respected), **The Demagogue** (a
popularity landslide), **The Kingpin** (bought and blackmailed), or **The
Consul** (taken by force). Different game, every time.

### 🏴 Trade laws — outlaw or legalize goods to move prices

Bend the market by changing what's legal — two ways, with a real trade-off:

- **Lobby (per planet)** — sway the local authority to **outlaw** a good (chokes
  supply, so its now-**contraband price climbs** — but selling it risks customs)
  or **legalize** a restricted one (opens the market and **softens its price**).
  Local, instant, influence-funded, lasts a few cycles, and a little shady
  (costs legitimacy, raises Heat). There's an immediate price shock, and while
  the law stands the good carries the usual black-market premium.
- **Legislate (sector-wide)** — pass a **Trade Restriction Act** in the Senate
  on a commodity of your choice to outlaw it **everywhere**, permanently, until
  repealed (or a **Legalization Act** to strike all contraband laws at once).
  Slower and needs a Senate majority, but legitimate and far-reaching.

Outlaw a good you can still smuggle and sell into the spike; legalize one to
crash a rival economy's premium. The law is just another lever on the market.

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
data.js      — static tables: commodities, planets, factions, recipes (loaded first)
galaxygen.js — procedural galaxy generation: frontier ring, lane graph, Sector Code, core variance
crises.js    — planetary disasters: triggers, relief/gouge/loot player responses
state.js     — the game state singleton (S) and freshState()
pricing.js   — market pricing: per-planet prices, buy/sell spreads, depth & slippage
feedback.js  — ship log, captain's journal, sound effects, toasts, fireworks/announcements
resources.js — extraction, deposit reserves/depletion, pollution/climate
combat.js    — piracy/combat: subsystems, typed weapons, matchmaking, ambushes
pirateBands.js — named pirate crews: standing, feuds/truces, tags, call-for-support
game.js      — game logic (economy, factions, production, rendering, save)
test/        — automated tests (Node's built-in test runner, no dependencies)
```

`data.js`, `galaxygen.js`, `crises.js`, `state.js`, `pricing.js`,
`feedback.js`, `resources.js`, `combat.js`, `pirateBands.js` and `game.js`
are all plain classic `<script>` tags (no `type="module"`, no bundler)
sharing one global
scope, in that load
order — still just plain HTML/CSS/JS you can open directly in a browser. Tweak the
tables in `data.js` (commodities, planets, recipes) or the ones further into
`game.js` (upgrades, techs, missions, factions) to make the sector your own.

## ✅ Tests

The game's scripts are loaded together exactly as a browser would load them
(via Node's `vm` module, with minimal `window`/`document`/`localStorage`
stubs) so the tests exercise the real game code, not a rewritten copy. No
dependencies to install — just:

```bash
npm test
```

CI (`.github/workflows/test.yml`) runs the same command on every push and
pull request against `main`.

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

Every raid also plays into sector politics: sacking a coalition's shipping
always docks your rep with them, but it quietly earns rep with **whichever
faction considers them a rival** — striking their enemy is a real, Wanted-
earning risk that faction's own agents notice and reward, letter of marque
or not. Hold a matching commission against that same target and its patron
reward stacks right on top.

A hidden **🏴‍☠️ Haven** can be **relocated** as the sector's heat map shifts —
its tier and stash carry over intact to a new lawless world, so a den that's
grown too hot doesn't have to be abandoned outright. And a faction beaten all
the way down to **zero worlds** isn't gone for good: with your trust already
earned, it'll still deal you a **Letter of Marque from exile** (🏛️ Politics
tab) — the only way to help a dispossessed power fight its way back onto the
map.

Your own fleet can back you up in a raid: assign an idle warship to
**🛰️ Follow Me** (✦ Fleet tab) and it's on call wherever you travel —
either as one of your 2 loyal allies, or pooled into a whole **Battle Group**
(with **Vanguard/Line/Reserve** tiering deciding which hulls tank hits and
which do the damage). No manual reassignment as you move between worlds. And
if a coalition target calls for help, every rescuer in the area answers
together — pick which hostile(s) to focus fire on, same as the Escort tab's
convoy combat, instead of being forced to kill them one at a time in a fixed
order.

The ✦ Fleet tab builds three families of hull at a colony **Shipyard** (or a
base's smaller **Small Shipyard** for the lightest tiers): **freighters**
haul goods, **warships** fight or work system missions, and **🛢️ tankers**
run fuel on their own. A tanker's onboard cargo can be topped off ahead of
time with the roster's **⬆️⛽ Load** button (base first, then colony) and
drained with **⬇️⛽ Unload** (your own tank first, then the base, then the
colony, selling whatever's left) — handy for staging fuel before a run or
reclaiming it without one. A tanker is genuinely slow, so dispatching one is
a background **Tanker Run**, not an instant trip — it tops off whatever's
already loaded and takes several cycles to reach a far world, delivering to
a colony/base's storage or selling at a foreign market on arrival. The whole
way there it risks a pirate ambush (an escorting warship cuts the odds) and,
if you're **Wanted**, a navy interception that confiscates the cargo outright.
Spot trouble on the route after a tanker's already left? The Assign tab's
**🛡️ Reinforce a tanker run** card lets you send more idle warships — docked
at the same home port the tanker departed from — to join its escort
mid-transit, cutting the odds for whatever's left of the trip.

## 💬 Talk to your pirate bands (optional, local Ollama)

The **🏴‍☠️ Contacts** tab has a **💬 Talk** sub-view for free-form, in-character
chat with any band you've crossed paths with, voiced by a model running on
your own machine via [Ollama](https://ollama.com). Each captain's tone is
grounded in that band's real standing, personality and rates (hire fee, loot
cut) from `pirateBands.js`. Free chat is just banter, but you can also
**💰 make an offer** to haggle their escort hire fee — an in-character
ACCEPT or COUNTER becomes a real discount (bounded 40%-150% of the going
rate) that holds for a few cycles until you actually sign the crew on from
the 🛡️ Escort tab. Every other numbered button on the Contacts card still
works exactly as before.

It's entirely optional and entirely local: the page talks straight to
Ollama's HTTP API on your machine (default `http://localhost:11434`, model
`llama3.2:1b` — change either in the Talk sub-view), never through any
server of this game's own. If Ollama isn't installed or reachable, the rest
of the game is unaffected — you'll just see a connection error in the chat
pane. Install Ollama, pull a model (`ollama pull llama3.2:1b`), and make
sure it accepts requests from this page's origin — Ollama's default CORS
policy only allows `localhost`/`127.0.0.1` origins, so if you're serving the
game from anywhere else, start it with `OLLAMA_ORIGINS=*` (or your page's
exact origin) set, e.g. `OLLAMA_ORIGINS=* ollama serve`.

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
- **Growth uses your stockpile, not just this cycle's harvest** — a colony
  banking a real food surplus keeps growing toward its housing cap even if
  the farm's raw output alone would otherwise plateau it.
- **Output tracks population, research and stability, not just building
  tiers** — a colony's **Workforce** (population vs. what its buildings need
  to run), **Automation** (a bonus from its tech level, on manufacturing
  specifically) and **Unrest** (a penalty once discontent sets in) all show
  on the governor card, so a colony that looks "stuck" always has a visible
  reason and a lever to pull.
- **👷 Labor Relief** — under-crewed for what you've built? Fund a temporary
  **Production Surge** (Tech, Electronics, Machinery, AI Cores & Alloys buy
  10-15 cycles of +15/30/50% output across the whole colony) instead of
  waiting on population. **Community Relief** is a separate, on-demand
  happiness boost and unrest relief paid in Consumer Goods, on a cooldown —
  alongside, not instead of, the passive comfort a stocked larder of goods,
  luxury and medicine already provides.

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

Beyond the charted worlds lie **hidden planets**. Launch a **Survey
Expedition** (in the Galaxy tab, an action + fuel to outfit) and your crew
works toward the nearest uncharted signature over several cycles — longer
into the deep frontier, shorter with a good Research Lab. Lawless headings
can draw an ambush en route, but a returned expedition always brings back
a charted world, and frontier finds turn up richer signals. Newly found
worlds (jungle Pandora, shattered Tartarus, paradise Elysium) are prime,
untouched colony sites. Two colonizable worlds (Aurora, Cinder) are
charted from the start; the rest are yours to find.

The Galaxy tab itself reads as a real strategic map: every world's card and
starmap node carries a **colored border in its controlling faction's own
color**, a warship you've sent on **🎯 mission**, **🚚 logistics**, or
**🛰️ follow-me** duty (or that's simply **⚓ docked** at home) shows up right
on the map in a color matched to its duty — a following ship's pill lights up
wherever you currently are, since it travels with you — and a world under
your fleet's watch shares its **pirate activity for free**, chart or no
chart, since a ship sitting there has eyes of its own. Your own **🌍
colonies**, **🏰 bases**, and **🏗️ Shipyards** (colony or base, whichever's
built) get their own pills and map glyphs too — no longer just an unmarked
world among the rest. A **Show:** filter row lets you declutter the map down
to just the fleet, pirate, faction, settlement, or environmental layer you
care about.

The **starmap** itself reads as a living view, not a frozen snapshot: every
node is labeled by name, carries 🏴/⚔️/📦 glyphs for pirate activity and your
own warships/freighters, and the whole layout **drifts slowly, cycle over
cycle** — no orbital mechanics, just dark matter, probably. An active convoy
run draws its own dashed route between origin and destination (multi-leg
progress shown as a 🚚 marker sliding along it), which flips to a bright,
alarmed 💥 the moment an ambush actually lands. Any 🛢️ tanker out on a fuel
run gets its own dotted route too, tracking its live progress toward
delivery. It's interactive too: 🔍+/🔍− and directional pan buttons (or just
the mouse wheel over the map) let you zoom into a crowded cluster or a
single world's neighborhood, with a ↺ Reset view button to snap straight
back to the full sector.

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
- **The Concordat Spire** — once **Terraforming** is researched, the tech tree
  has nowhere left to send your accumulating research points. Designate one of
  your colonies as the site of a sector-defining mega-project and pour tech
  points plus Alloys/Electronics/Antimatter into it from any colony's own
  stock. Which factions' worlds end up supplying it is never asked of you
  directly — spread the load and every faction's relations drift toward
  peace; funnel it through one faction's colonies and their rivals grow
  tenser instead. A third capstone legacy alongside the outlaw's Pirate Lord
  and the lawful Sector Marshal.

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

## ⚖️ Ship Trim

Reallocate what your upgrades already bought you across three axes —
📦 Cargo, 🔫 Firepower, 🧭 Autonomy (fuel range, jump efficiency, flee odds).
Balanced trades nothing; Hauler/Gunship/Voyager each trade +35% on one axis
for −30% on the other two, scaled by how much you've actually installed —
an unupgraded ship has nothing to trade either way. It's a real strategic
call, not a toggle: a refit costs credits and takes several cycles to
complete (Ship tab), and switching back costs the same as switching away.

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
catalogs.js  — content catalogs: upgrades, techs, missions, offices, orgs, bills, base/colony buildings
crises.js    — planetary disasters: triggers, relief/gouge/loot player responses
state.js     — the game state singleton (S) and freshState()
pricing.js   — market pricing: per-planet prices, buy/sell spreads, depth & slippage
feedback.js  — ship log, captain's journal, sound effects, toasts, fireworks/announcements
resources.js — extraction, deposit reserves/depletion, pollution/climate
combat.js    — piracy/combat: subsystems, typed weapons, matchmaking, ambushes
pirateBands.js — named pirate crews: standing, feuds/truces, tags, call-for-support
pirateChat.js — in-character band chat via a local Ollama model: persona, streaming, settings
raiding.js   — raid resolution, plunder, dockside/field ship repair
sector4x.js  — sector 4X layer: rising pirate powers, territory contest, faction relations
outlaw.js    — the outlaw path: navy interdiction, Pirate Haven, Privateer Commissions, capstone legacies
politics.js  — research & politics actions: orgs, the Senate, trade-law lobbying, investigations, offices
economy.js   — core economy actions: production, trade, black market, contraband, travel, upgrades/techs/missions
colonization.js — bases, the base<->colony trade network, random contracts, and colonies
fleet.js     — player fleet: ship orders/repair, raid allies, the Battle Group, logistics, fleet missions
fortunes.js  — fortunes (temporary boons & banes) and signals (the hunt for faint contacts)
frontier.js  — the logistics network, exploration, and win condition/milestone tracking
mandates.js  — commission a pirate band to work a system for several cycles
escort.js    — convoy escort: the expert-gated fleet-command combat tab
renderCore.js — rendering, slice 1: always-visible UI chrome and the Galaxy tab
renderProgression.js — rendering, slice 2: Market, Industry, Research, Politics, Missions
renderCombat.js — rendering, slice 3: Raid, Contacts, Ship
renderSettlement.js — rendering, slice 4: Bases, Colonies, Escort
renderFleetFortunes.js — rendering, slice 5: Fleet, Fortunes
persistence.js — save/load, the Captain's Log narrative export, portable save files
game.js      — the application shell: turn orchestration, tab disclosure, version check, newGame/init
test/        — automated tests (Node's built-in test runner, no dependencies)
```

`data.js`, `galaxygen.js`, `catalogs.js`, `crises.js`, `state.js`, `pricing.js`,
`feedback.js`, `resources.js`, `combat.js`, `pirateBands.js`, `pirateChat.js`,
`raiding.js`, `sector4x.js`, `outlaw.js`, `politics.js`, `economy.js`,
`colonization.js`, `fleet.js`, `fortunes.js`, `frontier.js`, `mandates.js`,
`escort.js`, `renderCore.js`, `renderProgression.js`, `renderCombat.js`,
`renderSettlement.js`, `renderFleetFortunes.js`, `persistence.js` and
`game.js`
are all plain classic `<script>` tags (no `type="module"`, no bundler)
sharing one global
scope, in that load
order — still just plain HTML/CSS/JS you can open directly in a browser. Tweak the
tables in `data.js` (commodities, planets, recipes) or `catalogs.js`
(upgrades, techs, missions, factions) to make the sector your own.

## ✅ Tests

The game's scripts are loaded together exactly as a browser would load them
(via Node's `vm` module, with minimal `window`/`document`/`localStorage`
stubs) so the tests exercise the real game code, not a rewritten copy. No
dependencies to install — just:

```bash
npm test
```

CI (`.github/workflows/test.yml`) syntax-checks every script and runs the
same command on Node 20 and 24, on every push and pull request against
`main`. The suite also includes repo guardrails: a version-consistency
check (`APP_VERSION`, `version.json`, the changelog and `index.html`'s
`?v=` cache-busters must agree), a duplicate-declaration guard for the
shared global scope, and a seeded 120-cycle simulation smoke test.

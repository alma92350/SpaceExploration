# 🚀 Stellar Frontier

A browser-based space exploration & economy game. Pilot the **S.S. Wanderer**
across a sector of six worlds — trade commodities, mine ore, farm food,
manufacture goods, research technology, and climb the political ladder until
you secure your legacy as **Sector Governor**.

No build step, no dependencies. Just open it in a browser.

## ▶️ Play

```bash
# from the project folder, either just open index.html…
xdg-open index.html        # Linux
open index.html            # macOS

# …or serve it (recommended) and visit http://localhost:8000
python3 -m http.server 8000
```

Your progress is saved automatically to the browser's `localStorage`.
Use the **⟲ New** button (top-left) to start over.

## 🎮 How to play

Each **cycle** you get **3 actions** for local work (mining, farming,
manufacturing, research, politics). **Travelling** to another world burns
fuel and advances a cycle. Use **End Cycle ▸** to refresh actions, drift the
markets, and trigger random events.

### The loop
1. **Trade** — buy a commodity cheap on one world, sell it dear on another.
2. **Produce** — mine minerals, harvest food, or refine minerals into goods.
3. **Upgrade** — spend credits on your ship; invest tech points in research.
4. **Lobby** — earn influence and complete political missions for titles.
5. **Explore** — visit all six worlds and chase the four legacy goals.

## 🪐 The six worlds

| World | Type | Strength | Weakness |
|-------|------|----------|----------|
| **Terra Nova** | Capital / Garden | Food, politics, tech | Mineral-poor |
| **Ferros Prime** | Mining | Cheap, abundant ore | Starved for food |
| **Verdani** | Agri-world | Cheapest food | Little industry |
| **Kybernet** | Tech hub | Highest tech (10) | Pricey, high crime |
| **Forge Station** | Industrial | Best manufacturing (10) | Few raw resources |
| **Oort Reach** | Frontier outpost | Rich ore, cheap fuel | Lawless, low tech |

Each world has its own **mining richness, fertility, industry level, tech
level** and **market prices**, so what's profitable depends on where you are.

## 💱 Activities

- **Trading** — live markets for minerals, food, goods and fuel. Prices drift
  each cycle and react to events. The *Galactic Exchange* tech reveals trends.
- **Mining** — extract minerals; yield scales with planet richness + Mining Laser.
- **Farming** — harvest food; scales with fertility + Hydroponics Bay.
- **Manufacturing** — refine minerals → goods; scales with planet industry + Fabricator.
- **Research** — generate tech points (scales with planet tech + Research Lab),
  then unlock an 8-node **technology tree**.
- **Politics** — earn influence and complete **missions** for credits and the
  Senator → Governor titles.

## 🛠️ The ten ship upgrades

Each has **3 tiers**:

1. **Cargo Hold** — more cargo capacity
2. **Fuel Tanks** — more fuel capacity
3. **Ion Engine** — cheaper jumps
4. **Mining Laser** — +mining yield
5. **Hydroponics Bay** — +farming yield
6. **Fabricator Module** — +manufacturing output
7. **Research Lab** — +research output
8. **Deflector Shield** — fewer losses from pirates/hazards
9. **Trade Computer** — better buy/sell prices
10. **Diplomatic Suite** — +influence gain

## 🏆 Winning — your legacy

Complete all four to win:
- Amass **50,000 credits** net worth
- Research **Terraforming** (top of the tech tree)
- Become **Sector Governor** (top of the political ladder)
- **Visit all six worlds**

## 🗂️ Project structure

```
index.html   — layout & markup
style.css    — neon-space UI theme
game.js      — all game logic (state, economy, rendering, persistence)
```

Everything is plain HTML/CSS/JS — fork it, tweak the numbers in `game.js`
(planets, upgrades, techs, missions, events) and make it your own.

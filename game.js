/* ============================================================
   STELLAR FRONTIER — a space exploration & economy game
   Pure vanilla JS. No dependencies. State persists to localStorage.
   ============================================================ */

"use strict";

/* ---------- Resource definitions ---------- */
const RES = {
  credits:  { name: "Credits",   ico: "💰", color: "#ffd166" },
  fuel:     { name: "Fuel",      ico: "⛽", color: "#4fd1ff" },
  minerals: { name: "Minerals",  ico: "🪨", color: "#b08968" },
  food:     { name: "Food",      ico: "🌾", color: "#4ade80" },
  goods:    { name: "Goods",     ico: "📦", color: "#c084fc" },
  tech:     { name: "Tech Pts",  ico: "🔬", color: "#60a5fa" },
  influence:{ name: "Influence", ico: "🏛️", color: "#f472b6" },
};

/* Tradable commodities (have markets) */
const COMMODITIES = ["minerals", "food", "goods", "fuel"];

/* ---------- Planet definitions ----------
   richness: mineral mining yield mult
   fertility: farming yield mult
   industry: manufacturing efficiency (1-10)
   tech: research efficiency / tech level (1-10)
   demand: per-commodity base price multiplier (a planet that lacks a
           good buys it dear and sells it cheap)
*/
const PLANETS = [
  {
    id: "terra",
    name: "Terra Nova",
    tag: "Capital • Garden World",
    color: "#3b82f6",
    desc: "The cradle of the colonies. Lush, populous and politically dominant, but mineral-poor.",
    distances: {}, // filled below
    x: 0,
    richness: 0.5, fertility: 1.6, industry: 6, tech: 7,
    base: { minerals: 22, food: 8, goods: 30, fuel: 14 },
  },
  {
    id: "ferros",
    name: "Ferros Prime",
    tag: "Mining World",
    color: "#b45309",
    desc: "A scarred iron giant riddled with mines. Drowning in ore, starved for food.",
    distances: {},
    x: 3,
    richness: 1.9, fertility: 0.3, industry: 4, tech: 3,
    base: { minerals: 7, food: 26, goods: 34, fuel: 12 },
  },
  {
    id: "verdani",
    name: "Verdani",
    tag: "Agri-World",
    color: "#16a34a",
    desc: "Endless terraced farms feed half the sector. Little industry, modest tech.",
    distances: {},
    x: 5,
    richness: 0.4, fertility: 2.0, industry: 3, tech: 4,
    base: { minerals: 24, food: 5, goods: 32, fuel: 13 },
  },
  {
    id: "kybernet",
    name: "Kybernet",
    tag: "Tech Hub",
    color: "#8b5cf6",
    desc: "A neon arcology of laboratories and fabricators. High tech, high prices, high crime.",
    distances: {},
    x: 8,
    richness: 0.6, fertility: 0.6, industry: 8, tech: 10,
    base: { minerals: 20, food: 20, goods: 22, fuel: 16 },
  },
  {
    id: "forge",
    name: "Forge Station",
    tag: "Industrial World",
    color: "#ef4444",
    desc: "A planet-sized factory. Turns raw ore into goods at unmatched scale.",
    distances: {},
    x: 11,
    richness: 1.1, fertility: 0.5, industry: 10, tech: 6,
    base: { minerals: 16, food: 22, goods: 16, fuel: 15 },
  },
  {
    id: "oort",
    name: "Oort Reach",
    tag: "Frontier Outpost",
    color: "#06b6d4",
    desc: "The lawless edge of charted space. Rich, dangerous, and cheap on fuel for the bold.",
    distances: {},
    x: 15,
    richness: 1.6, fertility: 0.7, industry: 2, tech: 2,
    base: { minerals: 12, food: 24, goods: 38, fuel: 9 },
  },
];

/* compute symmetric distances from 1-D positions */
PLANETS.forEach(a => {
  PLANETS.forEach(b => {
    if (a.id !== b.id) a.distances[b.id] = Math.max(1, Math.abs(a.x - b.x));
  });
});

/* ---------- Ship upgrades (10), each tiered ---------- */
const UPGRADES = [
  { id: "cargo",   name: "Cargo Hold",        ico: "📦",
    desc: "Expand cargo capacity for minerals, food & goods.",
    tiers: 3, baseCost: 1200, costMul: 2.2,
    effect: t => `+${t*150} cargo capacity` },
  { id: "fueltank",name: "Fuel Tanks",        ico: "🛢️",
    desc: "Carry more fuel for longer voyages.",
    tiers: 3, baseCost: 800, costMul: 2.0,
    effect: t => `+${t*40} fuel capacity` },
  { id: "engine",  name: "Ion Engine",        ico: "🚀",
    desc: "More efficient drive — every jump burns less fuel.",
    tiers: 3, baseCost: 1500, costMul: 2.4,
    effect: t => `-${t*12}% fuel per jump` },
  { id: "miner",   name: "Mining Laser",      ico: "⛏️",
    desc: "Boost mineral yield when mining a world.",
    tiers: 3, baseCost: 1400, costMul: 2.3,
    effect: t => `+${t*35}% mining yield` },
  { id: "hydro",   name: "Hydroponics Bay",   ico: "🌱",
    desc: "Onboard farms boost food output when harvesting.",
    tiers: 3, baseCost: 1300, costMul: 2.3,
    effect: t => `+${t*35}% farming yield` },
  { id: "factory", name: "Fabricator Module", ico: "🏭",
    desc: "Refine minerals into goods faster and cheaper.",
    tiers: 3, baseCost: 1800, costMul: 2.5,
    effect: t => `+${t*30}% manufacturing output` },
  { id: "lab",     name: "Research Lab",      ico: "🔬",
    desc: "Generate more tech points from research.",
    tiers: 3, baseCost: 1700, costMul: 2.5,
    effect: t => `+${t*40}% research output` },
  { id: "shield",  name: "Deflector Shield",  ico: "🛡️",
    desc: "Reduce losses from pirates and cosmic hazards.",
    tiers: 3, baseCost: 1600, costMul: 2.4,
    effect: t => `-${t*25}% hazard losses` },
  { id: "trade",   name: "Trade Computer",    ico: "💹",
    desc: "Sharper deals — better buy/sell spreads at every market.",
    tiers: 3, baseCost: 2000, costMul: 2.6,
    effect: t => `${t*4}% better prices` },
  { id: "envoy",   name: "Diplomatic Suite",  ico: "🤝",
    desc: "Lush quarters for dignitaries — gain more influence from politics.",
    tiers: 3, baseCost: 1500, costMul: 2.4,
    effect: t => `+${t*40}% influence gain` },
];

/* ---------- Research technologies ---------- */
const TECHS = [
  { id: "deepcore",  name: "Deep-Core Drilling",   cost: 30,  ico: "🪨",
    desc: "Unlocks richer mineral seams. +25% base mining everywhere.", req: [] },
  { id: "geneseed",  name: "Gene-Seed Crops",      cost: 30,  ico: "🌾",
    desc: "Hardier crops. +25% base farming everywhere.", req: [] },
  { id: "automation",name: "Factory Automation",   cost: 50,  ico: "⚙️",
    desc: "Automated lines. +1 minerals→goods conversion ratio.", req: ["deepcore"] },
  { id: "warpdrive", name: "Warp Coils",           cost: 70,  ico: "🌀",
    desc: "Fold space. Cuts all jump fuel costs by a further 20%.", req: [] },
  { id: "markets",   name: "Galactic Exchange",    cost: 60,  ico: "📈",
    desc: "Live market feeds. Reveals price trends & stabilises prices.", req: [] },
  { id: "fusion",    name: "Fusion Refinement",    cost: 80,  ico: "☀️",
    desc: "Refine fuel from minerals in the Industry bay.", req: ["automation"] },
  { id: "diplomacy", name: "Galactic Charter",     cost: 90,  ico: "📜",
    desc: "Unlocks high-tier political missions for big rewards.", req: ["markets"] },
  { id: "terraform", name: "Terraforming",         cost: 140, ico: "🌍",
    desc: "The pinnacle of science. Required to complete your legacy.", req: ["fusion","geneseed"] },
];

/* ---------- Political missions ---------- */
const MISSIONS = [
  { id: "trade_route", name: "Broker a Trade Route", tier: 1,
    cost: { influence: 10, credits: 500 },
    reward: { credits: 1800 },
    desc: "Negotiate a lucrative trade pact between two worlds." },
  { id: "relief", name: "Famine Relief Mission", tier: 1,
    cost: { influence: 8, food: 80 },
    reward: { influence: 14, credits: 600 },
    desc: "Deliver food to a starving colony and earn goodwill." },
  { id: "tech_summit", name: "Host a Tech Summit", tier: 2,
    cost: { influence: 25, tech: 20 },
    reward: { credits: 3000, influence: 10 },
    desc: "Convene the sector's scientists. Prestige and profit." },
  { id: "senate", name: "Win a Senate Seat", tier: 2, reqTech: "diplomacy",
    cost: { influence: 50, credits: 3000 },
    reward: { influence: 40, perk: "senator" },
    desc: "Claim a seat on the Galactic Senate. Unlocks the Governorship." },
  { id: "governor", name: "Become Sector Governor", tier: 3, reqTech: "diplomacy", reqPerk: "senator",
    cost: { influence: 120, credits: 12000 },
    reward: { perk: "governor" },
    desc: "Rule the sector. A cornerstone of your legacy." },
];

/* ============================================================
   GAME STATE
   ============================================================ */
let S; // global state

function freshState() {
  return {
    turn: 1,
    location: "terra",
    res: { credits: 3000, fuel: 100, minerals: 0, food: 0, goods: 0, tech: 0, influence: 0 },
    upgrades: { cargo:0, fueltank:0, engine:0, miner:0, hydro:0, factory:0, lab:0, shield:0, trade:0, envoy:0 },
    techs: {},          // id -> true
    missions: {},       // id -> true (completed)
    perks: {},          // senator / governor
    actionsUsed: 0,     // local actions used this cycle (mine/farm/etc.)
    prices: {},         // planetId -> { commodity -> price }
    visited: { terra: true },
    log: [],
    stats: { jumps: 0, trades: 0, profit: 0 },
    achieved: {},       // objectiveKey -> true (celebrated)
    won: false,
  };
}

/* derived capacities */
const BASE_CARGO = 100;
const BASE_FUEL = 100;
const ACTIONS_PER_CYCLE = 3; // local economic actions before you must end the cycle

function cargoCap()  { return BASE_CARGO + S.upgrades.cargo * 150; }
function fuelCap()   { return BASE_FUEL + S.upgrades.fueltank * 40; }
function cargoUsed() { return S.res.minerals + S.res.food + S.res.goods; }
function cargoFree() { return cargoCap() - cargoUsed(); }

/* ============================================================
   PRICING
   ============================================================ */
function rollPrices() {
  PLANETS.forEach(p => {
    S.prices[p.id] = S.prices[p.id] || {};
    COMMODITIES.forEach(c => {
      const base = p.base[c];
      const stab = S.techs.markets ? 0.12 : 0.30; // tech tightens volatility
      const cur = S.prices[p.id][c];
      let price;
      if (cur == null) {
        price = base * (1 + (Math.random() * 2 - 1) * stab);
      } else {
        // drift toward base + noise
        const drift = (base - cur) * 0.25;
        price = cur + drift + base * (Math.random() * 2 - 1) * stab * 0.6;
      }
      S.prices[p.id][c] = Math.max(2, Math.round(price));
    });
  });
}

function priceAt(planetId, commodity) {
  return S.prices[planetId][commodity];
}
/* trade computer narrows the spread between buy and sell */
function tradeSpread() { return Math.max(0.84, 0.90 - S.upgrades.trade * 0.04); } // sell = buy * spread
function buyPrice(planetId, c)  { return Math.round(priceAt(planetId, c) * (1 + (1 - tradeSpread()) * 0.5)); }
function sellPrice(planetId, c) { return Math.round(priceAt(planetId, c) * tradeSpread()); }

/* ============================================================
   CELEBRATIONS — fireworks canvas + announcement banner
   ============================================================ */
let _fxCanvas, _fxCtx, _fxParticles = [], _fxRAF = null, _fxUntil = 0, _fxLastLaunch = 0;

function _fxResize() {
  _fxCanvas.width = window.innerWidth;
  _fxCanvas.height = window.innerHeight;
}

function _fxBurst(x, y, count, hue, big) {
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const spd = (big ? 4 : 2.6) + Math.random() * (big ? 5.5 : 3);
    _fxParticles.push({
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd,
      life: 1,
      decay: 0.008 + Math.random() * 0.013,
      hue: hue + (Math.random() * 40 - 20),
      size: big ? 2.4 + Math.random() * 2 : 1.6 + Math.random() * 1.4,
    });
  }
}

function fireworks(duration = 2500, big = false) {
  if (typeof document === "undefined") return; // headless safety
  if (!_fxCanvas) {
    _fxCanvas = document.getElementById("fx");
    if (!_fxCanvas) return;
    _fxCtx = _fxCanvas.getContext("2d");
    window.addEventListener("resize", _fxResize);
  }
  _fxResize();
  _fxUntil = Math.max(_fxUntil, performance.now() + duration);
  _fxBigMode = big || _fxBigMode;
  if (_fxRAF) return; // already animating; we just extended the deadline

  const tick = (t) => {
    const ctx = _fxCtx, W = _fxCanvas.width, H = _fxCanvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(5,7,15,0.18)"; // trailing fade
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";

    const big = _fxBigMode;
    if (t < _fxUntil && t - _fxLastLaunch > (big ? 200 : 340)) {
      _fxLastLaunch = t;
      const shells = big ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let k = 0; k < shells; k++) {
        _fxBurst(
          W * (0.18 + Math.random() * 0.64),
          H * (0.18 + Math.random() * 0.42),
          big ? 60 + Math.floor(Math.random() * 40) : 42,
          Math.random() * 360, big
        );
      }
    }

    for (let i = _fxParticles.length - 1; i >= 0; i--) {
      const p = _fxParticles[i];
      p.vy += 0.05;            // gravity
      p.vx *= 0.99; p.vy *= 0.99;
      p.x += p.vx; p.y += p.vy;
      p.life -= p.decay;
      if (p.life <= 0) { _fxParticles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue},100%,${55 + p.life * 25}%,${p.life})`;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }

    if (t < _fxUntil || _fxParticles.length) {
      _fxRAF = requestAnimationFrame(tick);
    } else {
      _fxCtx.clearRect(0, 0, W, H);
      _fxRAF = null;
      _fxBigMode = false;
    }
  };
  _fxRAF = requestAnimationFrame(tick);
}
let _fxBigMode = false;

function announce(title, sub, finale = false) {
  if (typeof document === "undefined") return;
  const el = document.getElementById("announce");
  if (!el) return;
  el.innerHTML =
    `<div class="ann-kicker">${finale ? "Legacy Complete" : "Objective Reached"}</div>` +
    `<div class="ann-title">${title}</div>` +
    `<div class="ann-sub">${sub}</div>`;
  el.classList.remove("hidden", "finale");
  if (finale) el.classList.add("finale");
  el.style.animation = "none";
  void el.offsetWidth;        // reflow to restart the pop animation
  el.style.animation = "";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), finale ? 7000 : 3400);
}

/* ============================================================
   LOG & TOAST
   ============================================================ */
function log(msg, type = "") {
  S.log.unshift({ msg, type, turn: S.turn });
  if (S.log.length > 60) S.log.pop();
  renderLog();
}
function toast(msg, type = "") {
  const c = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; }, 2200);
  setTimeout(() => el.remove(), 2700);
}

/* ============================================================
   RESOURCE HELPERS
   ============================================================ */
function canAfford(cost) {
  return Object.entries(cost).every(([k, v]) => S.res[k] >= v);
}
function pay(cost) {
  Object.entries(cost).forEach(([k, v]) => { S.res[k] -= v; });
}
function gain(reward) {
  Object.entries(reward).forEach(([k, v]) => {
    if (k === "perk") { S.perks[v] = true; return; }
    S.res[k] = (S.res[k] || 0) + v;
  });
}
function fmt(n) { return Math.round(n).toLocaleString("en-US"); }
function costString(cost) {
  return Object.entries(cost).map(([k, v]) => `${fmt(v)} ${RES[k].ico}`).join("  ");
}

/* ============================================================
   ACTIONS — local economy
   ============================================================ */
function actionsLeft() { return ACTIONS_PER_CYCLE - S.actionsUsed; }

function useAction() { S.actionsUsed++; }

function currentPlanet() { return PLANETS.find(p => p.id === S.location); }

function mine() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (cargoFree() <= 0) return toast("Cargo hold full!", "bad");
  const p = currentPlanet();
  let yld = 18 * p.richness;
  yld *= 1 + S.upgrades.miner * 0.35;
  if (S.techs.deepcore) yld *= 1.25;
  yld = Math.min(Math.round(yld), cargoFree());
  S.res.minerals += yld;
  useAction();
  log(`Mined <span class="c">${yld}</span> minerals on ${p.name}.`, "good");
  toast(`+${yld} 🪨 minerals`, "good");
  afterAction();
}

function farm() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (cargoFree() <= 0) return toast("Cargo hold full!", "bad");
  const p = currentPlanet();
  let yld = 18 * p.fertility;
  yld *= 1 + S.upgrades.hydro * 0.35;
  if (S.techs.geneseed) yld *= 1.25;
  yld = Math.min(Math.round(yld), cargoFree());
  S.res.food += yld;
  useAction();
  log(`Harvested <span class="c">${yld}</span> food on ${p.name}.`, "good");
  toast(`+${yld} 🌾 food`, "good");
  afterAction();
}

function manufacture() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  const mineralsPerBatch = 2 + (S.techs.automation ? 1 : 0); // minerals per good
  // output scales with planet industry + module, capped by minerals on hand.
  // Each batch consumes `mineralsPerBatch` cargo and yields 1 good, so the
  // hold never overflows — minerals are the only real constraint.
  let batches = Math.floor((4 + p.industry) * (1 + S.upgrades.factory * 0.30));
  batches = Math.min(batches, Math.floor(S.res.minerals / mineralsPerBatch));
  if (batches <= 0) return toast(`Need ${mineralsPerBatch}+ minerals to manufacture.`, "bad");
  const mineralsUsed = batches * mineralsPerBatch;
  S.res.minerals -= mineralsUsed;
  S.res.goods += batches;
  useAction();
  log(`Manufactured <span class="c">${batches}</span> goods from ${mineralsUsed} minerals on ${p.name}.`, "good");
  toast(`+${batches} 📦 goods`, "good");
  afterAction();
}

function refineFuel() {
  if (!S.techs.fusion) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const mineralsPer = 2;
  let out = Math.floor((6 + currentPlanet().industry) );
  out = Math.min(out, Math.floor(S.res.minerals / mineralsPer), fuelCap() - S.res.fuel);
  if (out <= 0) return toast("Cannot refine fuel (need minerals / tank space).", "bad");
  S.res.minerals -= out * mineralsPer;
  S.res.fuel += out;
  useAction();
  log(`Refined <span class="c">${out}</span> fuel from minerals.`, "good");
  toast(`+${out} ⛽ fuel`, "good");
  afterAction();
}

function research() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  let pts = Math.round((2 + p.tech) * (1 + S.upgrades.lab * 0.40));
  S.res.tech += pts;
  useAction();
  log(`Generated <span class="c">${pts}</span> tech points on ${p.name}.`, "good");
  toast(`+${pts} 🔬 tech`, "good");
  afterAction();
}

function doPolitics() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  // influence scales with planet tech/industry (civic weight) + envoy suite
  let inf = Math.round((2 + (p.tech + p.industry) / 3) * (1 + S.upgrades.envoy * 0.40));
  if (S.perks.senator) inf = Math.round(inf * 1.3);
  if (S.perks.governor) inf = Math.round(inf * 1.6);
  S.res.influence += inf;
  useAction();
  log(`Earned <span class="c">${inf}</span> influence lobbying on ${p.name}.`, "good");
  toast(`+${inf} 🏛️ influence`, "good");
  afterAction();
}

function afterAction() {
  checkWin();
  saveGame();
  renderAll();
}

/* ============================================================
   TRADE
   ============================================================ */
function buy(commodity, qty) {
  qty = Math.max(0, Math.floor(qty));
  if (qty <= 0) return;
  const price = buyPrice(S.location, commodity);
  const cost = price * qty;
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (commodity === "fuel") {
    if (S.res.fuel + qty > fuelCap()) return toast("Fuel tank too small.", "bad");
  } else {
    if (cargoUsed() + qty > cargoCap()) return toast("Cargo hold full.", "bad");
  }
  S.res.credits -= cost;
  S.res[commodity] += qty;
  S.stats.trades++;
  log(`Bought ${qty} ${RES[commodity].ico} ${RES[commodity].name} for <span class="c">${fmt(cost)}</span> cr.`);
  toast(`Bought ${qty} ${RES[commodity].name}`, "good");
  afterAction();
}

function sell(commodity, qty) {
  qty = Math.max(0, Math.floor(qty));
  if (qty <= 0) return;
  if (S.res[commodity] < qty) return toast("You don't have that many.", "bad");
  const price = sellPrice(S.location, commodity);
  const revenue = price * qty;
  S.res[commodity] -= qty;
  S.res.credits += revenue;
  S.stats.trades++;
  S.stats.profit += revenue;
  log(`Sold ${qty} ${RES[commodity].ico} ${RES[commodity].name} for <span class="c">${fmt(revenue)}</span> cr.`, "good");
  toast(`Sold ${qty} ${RES[commodity].name} (+${fmt(revenue)} cr)`, "good");
  afterAction();
}

/* ============================================================
   TRAVEL
   ============================================================ */
function fuelCost(destId) {
  const dist = currentPlanet().distances[destId];
  let cost = dist * 8;
  cost *= 1 - S.upgrades.engine * 0.12;
  if (S.techs.warpdrive) cost *= 0.80;
  return Math.max(1, Math.round(cost));
}

function travel(destId) {
  if (destId === S.location) return;
  const cost = fuelCost(destId);
  if (S.res.fuel < cost) return toast(`Not enough fuel (need ${cost}).`, "bad");
  const dest = PLANETS.find(p => p.id === destId);
  S.res.fuel -= cost;
  S.location = destId;
  S.visited[destId] = true;
  S.stats.jumps++;
  log(`Jumped to <span class="c">${dest.name}</span> (−${cost} ⛽).`, "event");
  toast(`Arrived at ${dest.name}`, "event");
  endTurn(true); // travelling advances a cycle
}

/* ============================================================
   UPGRADES
   ============================================================ */
function upgradeCost(u) {
  const tier = S.upgrades[u.id];
  return Math.round(u.baseCost * Math.pow(u.costMul, tier));
}
function buyUpgrade(uid) {
  const u = UPGRADES.find(x => x.id === uid);
  const tier = S.upgrades[uid];
  if (tier >= u.tiers) return;
  const cost = upgradeCost(u);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost;
  S.upgrades[uid]++;
  log(`Installed ${u.ico} ${u.name} (Tier ${S.upgrades[uid]}).`, "good");
  toast(`${u.name} → Tier ${S.upgrades[uid]}`, "good");
  afterAction();
}

/* ============================================================
   RESEARCH TECH
   ============================================================ */
function techUnlocked(t) { return !!S.techs[t.id]; }
function techAvailable(t) {
  return !techUnlocked(t) && t.req.every(r => S.techs[r]);
}
function researchTech(tid) {
  const t = TECHS.find(x => x.id === tid);
  if (!techAvailable(t)) return;
  if (S.res.tech < t.cost) return toast("Not enough tech points.", "bad");
  S.res.tech -= t.cost;
  S.techs[tid] = true;
  log(`Researched ${t.ico} <span class="c">${t.name}</span>!`, "event");
  toast(`Unlocked: ${t.name}`, "event");
  checkWin();
  afterAction();
}

/* ============================================================
   MISSIONS
   ============================================================ */
function missionAvailable(m) {
  if (S.missions[m.id]) return false;
  if (m.reqTech && !S.techs[m.reqTech]) return false;
  if (m.reqPerk && !S.perks[m.reqPerk]) return false;
  return true;
}
function doMission(mid) {
  const m = MISSIONS.find(x => x.id === mid);
  if (!missionAvailable(m)) return;
  if (!canAfford(m.cost)) return toast("Requirements not met.", "bad");
  pay(m.cost);
  gain(m.reward);
  S.missions[mid] = true;
  log(`Completed mission: <span class="c">${m.name}</span>.`, "event");
  toast(`Mission complete: ${m.name}`, "event");
  checkWin();
  afterAction();
}

/* ============================================================
   TURN / EVENTS
   ============================================================ */
const EVENTS = [
  { msg: "Solar flare scrambles markets across the sector.", type: "event",
    fn: () => { COMMODITIES.forEach(c => PLANETS.forEach(p => { S.prices[p.id][c] = Math.round(S.prices[p.id][c] * (0.7 + Math.random() * 0.7)); })); } },
  { msg: "Pirates ambush your convoy!", type: "bad",
    fn: () => {
      const mitig = 1 - S.upgrades.shield * 0.25;
      const loss = Math.round((S.res.goods * 0.2 + 50) * mitig);
      const stolen = Math.min(S.res.goods, Math.round(S.res.goods * 0.2 * mitig));
      S.res.goods -= stolen;
      const credLoss = Math.min(S.res.credits, Math.round(loss));
      S.res.credits -= credLoss;
      return ` They grabbed ${stolen} goods and ${fmt(credLoss)} credits.`;
    } },
  { msg: "A derelict freighter drifts by — salvage recovered.", type: "good",
    fn: () => { const c = 200 + Math.round(Math.random() * 800); S.res.credits += c; return ` +${fmt(c)} credits.`; } },
  { msg: "Bumper harvest reported — food prices crash.", type: "event",
    fn: () => { PLANETS.forEach(p => { S.prices[p.id].food = Math.round(S.prices[p.id].food * 0.6); }); } },
  { msg: "Mineral shortage — ore prices spike galaxy-wide.", type: "event",
    fn: () => { PLANETS.forEach(p => { S.prices[p.id].minerals = Math.round(S.prices[p.id].minerals * 1.5); }); } },
  { msg: "Scientific breakthrough! Bonus tech points awarded.", type: "good",
    fn: () => { const t = 5 + Math.round(Math.random() * 10); S.res.tech += t; return ` +${t} tech.`; } },
  { msg: "Diplomatic gala — your standing rises.", type: "good",
    fn: () => { const i = 4 + Math.round(Math.random() * 8); S.res.influence += i; return ` +${i} influence.`; } },
];

function maybeEvent() {
  if (Math.random() < 0.45) {
    const e = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const extra = e.fn() || "";
    log("📡 " + e.msg + extra, e.type);
    toast(e.msg, e.type === "bad" ? "bad" : "event");
  }
}

function endTurn(fromTravel = false) {
  S.turn++;
  S.actionsUsed = 0;
  rollPrices();
  maybeEvent();
  if (!fromTravel) log(`— Cycle ${S.turn} begins —`);
  checkWin();
  saveGame();
  renderAll();
}

/* ============================================================
   WIN CONDITION (legacy goal)
   ============================================================ */
function netWorth() {
  let w = S.res.credits;
  // value cargo at Terra Nova base prices, plus fuel
  w += S.res.minerals * 18 + S.res.food * 15 + S.res.goods * 28 + S.res.fuel * 12;
  // upgrade investment
  return Math.round(w);
}
const OBJECTIVE_META = {
  worth:     { emoji: "💰", title: "Tycoon",           sub: "Net worth has passed 50,000 credits!" },
  terraform: { emoji: "🌍", title: "Master Scientist", sub: "Terraforming researched — you can reshape worlds!" },
  governor:  { emoji: "👑", title: "Sector Governor",  sub: "You now rule the entire sector!" },
  explored:  { emoji: "🧭", title: "Master Explorer",  sub: "Every one of the six worlds has been charted!" },
};

function winProgress() {
  return {
    worth:    { have: netWorth() >= 50000,            label: "Amass 50,000 credits net worth" },
    terraform:{ have: !!S.techs.terraform,            label: "Research Terraforming" },
    governor: { have: !!S.perks.governor,             label: "Become Sector Governor" },
    explored: { have: PLANETS.every(p => S.visited[p.id]), label: "Visit all 6 worlds" },
  };
}

/* mark already-met objectives as achieved without celebrating (used on load) */
function syncObjectives() {
  S.achieved = S.achieved || {};
  const wp = winProgress();
  Object.keys(wp).forEach(k => { if (wp[k].have) S.achieved[k] = true; });
  if (Object.values(wp).every(x => x.have)) S.won = true;
}

function checkWin() {
  S.achieved = S.achieved || {};
  const wp = winProgress();

  // Celebrate each newly-completed objective
  Object.keys(wp).forEach(key => {
    if (wp[key].have && !S.achieved[key]) {
      S.achieved[key] = true;
      const m = OBJECTIVE_META[key];
      announce(`${m.emoji} ${m.title}`, m.sub, false);
      fireworks(2400, false);
      toast(`🎆 Objective reached: ${m.title}!`, "good");
      log(`🎆 Objective reached: <span class="c">${m.title}</span> — ${m.sub}`, "good");
    }
  });

  // Grand finale when all objectives are done
  if (!S.won && Object.values(wp).every(x => x.have)) {
    S.won = true;
    log("🏆 LEGACY COMPLETE — You have shaped the destiny of the sector!", "good");
    // delay slightly so the final objective's own burst leads into the finale
    setTimeout(() => {
      announce("🏆 LEGACY COMPLETE", "You have shaped the destiny of the sector. A legend is born!", true);
      fireworks(8000, true);
      toast("🏆 You win! Legacy complete!", "good");
    }, 1100);
  }
}

/* ============================================================
   RENDERING
   ============================================================ */
function renderResources() {
  const order = ["credits", "fuel", "minerals", "food", "goods", "tech", "influence"];
  const el = document.getElementById("resources");
  el.innerHTML = order.map(k => {
    let extra = "";
    if (k === "fuel") extra = `/${fuelCap()}`;
    return `<div class="res" data-res="${k}" title="${RES[k].name}">
      <span class="ico">${RES[k].ico}</span>
      <span class="val">${fmt(S.res[k])}${extra}</span>
    </div>`;
  }).join("");
}

function renderShip() {
  document.getElementById("currentPlanet").textContent = currentPlanet().name;
  const cu = cargoUsed(), cc = cargoCap();
  const stats = [
    ["Cargo", `${cu}/${cc}`, cu / cc],
    ["Fuel", `${S.res.fuel}/${fuelCap()}`, S.res.fuel / fuelCap()],
  ];
  const up = UPGRADES.map(u => {
    const t = S.upgrades[u.id];
    return t > 0 ? `${u.ico}${t}` : "";
  }).filter(Boolean).join(" ");
  document.getElementById("shipStats").innerHTML =
    stats.map(([k, v, frac]) => `
      <div class="ship-stat"><span class="k">${k}</span><span class="v">${v}</span></div>
      <div class="bar"><span style="width:${Math.min(100, frac*100)}%"></span></div>
    `).join("") +
    `<div class="ship-stat" style="margin-top:8px"><span class="k">Actions</span><span class="v">${actionsLeft()}/${ACTIONS_PER_CYCLE}</span></div>` +
    (up ? `<div class="ship-stat" style="margin-top:8px"><span class="k">Mods</span></div><div style="font-size:13px">${up}</div>` : "");
}

function renderLog() {
  const el = document.getElementById("log");
  if (!el) return;
  el.innerHTML = S.log.map(e =>
    `<div class="log-entry ${e.type}"><span style="opacity:.5">[${e.turn}]</span> ${e.msg}</div>`
  ).join("");
}

/* ----- Galaxy panel ----- */
function renderGalaxy() {
  const el = document.getElementById("panel-galaxy");
  const cards = PLANETS.map(p => {
    const isHere = p.id === S.location;
    const fc = isHere ? 0 : fuelCost(p.id);
    const canGo = !isHere && S.res.fuel >= fc;
    const visited = S.visited[p.id];
    return `
    <div class="planet-card ${isHere ? "current" : ""}">
      <div class="planet-orb" style="background:radial-gradient(circle at 35% 30%, ${p.color}, #000 130%)"></div>
      <div class="planet-name">${p.name} ${visited ? "" : '<span class="badge">unknown</span>'}</div>
      <div class="planet-tag">${p.tag}</div>
      <div class="planet-desc">${p.desc}</div>
      <div class="planet-levels">
        <span class="lvl-chip">⛏️ Mining ${"★".repeat(Math.round(p.richness*2.5)).padEnd(5,"·")}</span>
        <span class="lvl-chip">🌾 Fertility ${"★".repeat(Math.round(p.fertility*2.5)).padEnd(5,"·")}</span>
        <span class="lvl-chip">🏭 Industry ${p.industry}/10</span>
        <span class="lvl-chip">🔬 Tech ${p.tech}/10</span>
      </div>
      ${isHere
        ? `<div class="pill good">◉ You are here</div>`
        : `<div class="row">
            <button class="btn btn-primary" ${canGo ? "" : "disabled"} onclick="travel('${p.id}')">Travel ▸</button>
            <span class="distance">⛽ ${fc} fuel · ${currentPlanet().distances[p.id]} ly</span>
          </div>`}
    </div>`;
  }).join("");

  const wp = winProgress();
  const goals = Object.values(wp).map(g =>
    `<div class="ship-stat"><span class="k">${g.have ? "✅" : "⬜"} ${g.label}</span></div>`
  ).join("");

  el.innerHTML = `
    <h2>Galactic Map</h2>
    <div class="subtitle">Six worlds, each with its own economy. Jump between them to trade and build your empire. Travelling costs fuel and advances a cycle.</div>
    <div class="planet-grid">${cards}</div>
    <div class="section-title">🏆 Your Legacy (win conditions)</div>
    <div class="cards"><div class="card">${goals}
      <div class="hint">Net worth: ${fmt(netWorth())} cr</div>
    </div></div>`;
}

/* ----- Market panel ----- */
function renderMarket() {
  const el = document.getElementById("panel-market");
  const p = currentPlanet();
  const rows = COMMODITIES.map(c => {
    const bp = buyPrice(p.id, c), sp = sellPrice(p.id, c);
    const base = p.base[c];
    const trend = bp > base * 1.1 ? '<span class="price-up">▲ high</span>'
                : bp < base * 0.9 ? '<span class="price-down">▼ low</span>'
                : '<span class="hint">— avg</span>';
    const showTrend = S.techs.markets;
    return `
    <tr>
      <td>${RES[c].ico} ${RES[c].name}</td>
      <td class="num">${fmt(bp)}</td>
      <td class="num">${fmt(sp)}</td>
      <td class="num">${fmt(S.res[c])}</td>
      <td>${showTrend ? trend : '<span class="hint">?</span>'}</td>
      <td>
        <div class="trade-controls">
          <input class="qty" id="qty-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-good" onclick="buyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-bad" onclick="sellQty('${c}')">Sell</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  el.innerHTML = `
    <h2>${p.name} Market</h2>
    <div class="subtitle">${p.tag}. Buy low here, sell high elsewhere. ${S.techs.markets ? "Galactic Exchange reveals price trends." : "Research the Galactic Exchange to reveal price trends."}</div>
    <table>
      <thead><tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">You hold</th><th>Trend</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="row" style="margin-top:14px">
      <span class="hint">Cargo ${cargoUsed()}/${cargoCap()} · Fuel ${S.res.fuel}/${fuelCap()} · Credits ${fmt(S.res.credits)}</span>
    </div>`;
}
function buyQty(c)  { buy(c, +document.getElementById("qty-" + c).value); }
function sellQty(c) { sell(c, +document.getElementById("qty-" + c).value); }

/* ----- Industry panel (mining, farming, manufacturing) ----- */
function renderIndustry() {
  const el = document.getElementById("panel-industry");
  const p = currentPlanet();
  const al = actionsLeft();
  const ratio = 2 + (S.techs.automation ? 1 : 0);

  const acts = [
    { name: "⛏️ Mine Minerals", desc: `Extract ore. Yield scales with this world's richness and your Mining Laser.`,
      val: `≈ ${Math.round(18*p.richness*(1+S.upgrades.miner*0.35)*(S.techs.deepcore?1.25:1))} 🪨`,
      fn: "mine", on: al>0 && cargoFree()>0 },
    { name: "🌾 Harvest Food", desc: `Grow food. Yield scales with fertility and your Hydroponics Bay.`,
      val: `≈ ${Math.round(18*p.fertility*(1+S.upgrades.hydro*0.35)*(S.techs.geneseed?1.25:1))} 🌾`,
      fn: "farm", on: al>0 && cargoFree()>0 },
    { name: "🏭 Manufacture Goods", desc: `Refine ${ratio} minerals → 1 good. Output scales with planet industry & Fabricator.`,
      val: `up to ${Math.floor((4+p.industry)*(1+S.upgrades.factory*0.30))} 📦`,
      fn: "manufacture", on: al>0 && S.res.minerals>=ratio },
  ];
  if (S.techs.fusion) {
    acts.push({ name: "⛽ Refine Fuel", desc: `Fusion Refinement: convert 2 minerals → 1 fuel.`,
      val: `up to ${6+p.industry} ⛽`, fn: "refineFuel", on: al>0 && S.res.minerals>=2 && S.res.fuel<fuelCap() });
  }

  const cards = acts.map(a => `
    <div class="card">
      <h4>${a.name}</h4>
      <div class="desc">${a.desc}</div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">${a.val}</span></div>
      <button class="btn btn-primary" ${a.on ? "" : "disabled"} onclick="${a.fn}()">Work (1 action)</button>
    </div>`).join("");

  el.innerHTML = `
    <h2>Industry — ${p.name}</h2>
    <div class="subtitle">Produce raw resources and goods. Each task uses 1 of your ${ACTIONS_PER_CYCLE} actions per cycle. Actions left: <b>${al}</b>.</div>
    <div class="cards">${cards}</div>`;
}

/* ----- Research panel ----- */
function renderResearch() {
  const el = document.getElementById("panel-research");
  const p = currentPlanet();
  const al = actionsLeft();
  const techCards = TECHS.map(t => {
    const done = techUnlocked(t);
    const avail = techAvailable(t);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const reqTxt = t.req.length ? `Requires: ${t.req.map(r => TECHS.find(x=>x.id===r).name).join(", ")}` : "";
    return `
    <div class="${cls}">
      <h4>${t.ico} ${t.name} ${done ? '<span class="pill good">researched</span>' : ""}</h4>
      <div class="desc">${t.desc}</div>
      ${reqTxt ? `<div class="hint">${reqTxt}</div>` : ""}
      <div class="meta"><span class="cost">${t.cost} 🔬</span>
        ${done ? "" : `<button class="btn btn-primary" ${avail && S.res.tech>=t.cost ? "" : "disabled"} onclick="researchTech('${t.id}')">Research</button>`}
      </div>
    </div>`;
  }).join("");

  el.innerHTML = `
    <h2>Research & Technology</h2>
    <div class="subtitle">Generate tech points in the lab, then unlock permanent upgrades. You have <b>${fmt(S.res.tech)} 🔬</b>.</div>
    <div class="cards">
      <div class="card">
        <h4>🔬 Run Experiments</h4>
        <div class="desc">Generate tech points. Output scales with this world's tech level (${p.tech}/10) and your Research Lab.</div>
        <div class="meta"><span class="hint">Est. output</span><span class="cost">+${Math.round((2+p.tech)*(1+S.upgrades.lab*0.40))} 🔬</span></div>
        <button class="btn btn-primary" ${al>0 ? "" : "disabled"} onclick="research()">Research (1 action)</button>
      </div>
    </div>
    <div class="section-title">Technology Tree</div>
    <div class="cards">${techCards}</div>`;
}

/* ----- Politics panel ----- */
function renderPolitics() {
  const el = document.getElementById("panel-politics");
  const p = currentPlanet();
  const al = actionsLeft();
  const status = S.perks.governor ? "Sector Governor 👑" : S.perks.senator ? "Senator 🎖️" : "Free Trader";
  const missionCards = MISSIONS.map(m => {
    const done = S.missions[m.id];
    const avail = missionAvailable(m);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const lock = !avail && !done
      ? (m.reqPerk && !S.perks[m.reqPerk] ? `Requires: ${m.reqPerk}` : m.reqTech && !S.techs[m.reqTech] ? `Requires tech: ${TECHS.find(x=>x.id===m.reqTech).name}` : "")
      : "";
    return `
    <div class="${cls}">
      <h4>${m.name} <span class="badge">Tier ${m.tier}</span> ${done ? '<span class="pill good">done</span>' : ""}</h4>
      <div class="desc">${m.desc}</div>
      <div class="hint">Cost: ${costString(m.cost)}</div>
      <div class="hint">Reward: ${m.reward.perk ? "Title: " + m.reward.perk + " " : ""}${costString(Object.fromEntries(Object.entries(m.reward).filter(([k])=>k!=="perk")))}</div>
      ${lock ? `<div class="hint" style="color:var(--bad)">${lock}</div>` : ""}
      ${done ? "" : `<button class="btn btn-primary" ${avail && canAfford(m.cost) ? "" : "disabled"} onclick="doMission('${m.id}')">Undertake</button>`}
    </div>`;
  }).join("");

  el.innerHTML = `
    <h2>Politics & Influence</h2>
    <div class="subtitle">Status: <b>${status}</b>. Lobby for influence, then spend it on missions for credits, power and titles. You have <b>${fmt(S.res.influence)} 🏛️</b>.</div>
    <div class="cards">
      <div class="card">
        <h4>🏛️ Lobby & Network</h4>
        <div class="desc">Build political capital. Influence scales with this world's civic weight and your Diplomatic Suite${S.perks.senator?" + your title":""}.</div>
        <div class="meta"><span class="hint">Est. output</span><span class="cost">+${Math.round((2+(p.tech+p.industry)/3)*(1+S.upgrades.envoy*0.40)*(S.perks.governor?1.6:S.perks.senator?1.3:1))} 🏛️</span></div>
        <button class="btn btn-primary" ${al>0 ? "" : "disabled"} onclick="doPolitics()">Lobby (1 action)</button>
      </div>
    </div>
    <div class="section-title">Missions</div>
    <div class="cards">${missionCards}</div>`;
}

/* ----- Ship / upgrades panel ----- */
function renderShipPanel() {
  const el = document.getElementById("panel-ship");
  const cards = UPGRADES.map(u => {
    const tier = S.upgrades[u.id];
    const maxed = tier >= u.tiers;
    const cost = upgradeCost(u);
    const dots = Array.from({length: u.tiers}, (_, i) =>
      `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
    const cls = maxed ? "card maxed" : tier > 0 ? "card owned" : "card";
    return `
    <div class="${cls}">
      <h4>${u.ico} ${u.name} <span class="tier-dots">${dots}</span></h4>
      <div class="desc">${u.desc}</div>
      <div class="hint">Current: ${tier > 0 ? u.effect(tier) : "not installed"}</div>
      ${maxed ? `<div class="pill good">◉ Fully upgraded</div>`
        : `<div class="meta">
            <span class="hint">Next: ${u.effect(tier+1)}</span>
            <span class="cost">${fmt(cost)} 💰</span>
          </div>
          <button class="btn btn-primary" ${S.res.credits>=cost ? "" : "disabled"} onclick="buyUpgrade('${u.id}')">Install Tier ${tier+1}</button>`}
    </div>`;
  }).join("");

  el.innerHTML = `
    <h2>Ship Outfitting — S.S. Wanderer</h2>
    <div class="subtitle">Ten upgrade systems, three tiers each. Spend credits at any spacedock to push your vessel further.</div>
    <div class="cards">${cards}</div>`;
}

/* ----- master render ----- */
function renderAll() {
  renderResources();
  renderShip();
  renderGalaxy();
  renderMarket();
  renderIndustry();
  renderResearch();
  renderPolitics();
  renderShipPanel();
  renderLog();
}

/* ============================================================
   TABS
   ============================================================ */
function setTab(name) {
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("panel-" + name).classList.remove("hidden");
}

/* ============================================================
   PERSISTENCE
   ============================================================ */
const SAVE_KEY = "stellar-frontier-save-v1";
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {}
}
function loadGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) { S = JSON.parse(raw); return true; }
  } catch (e) {}
  return false;
}
function newGame() {
  if (!confirm("Start a new game? Current progress will be lost.")) return;
  S = freshState();
  rollPrices();
  log("Welcome, Captain. Your journey begins on Terra Nova.");
  saveGame();
  renderAll();
  setTab("galaxy");
}

/* ============================================================
   INIT
   ============================================================ */
function init() {
  if (!loadGame()) {
    S = freshState();
    rollPrices();
    log("Welcome, Captain. Your journey begins on Terra Nova.");
  }
  // ensure prices exist (older save / safety)
  if (!S.prices || !S.prices.terra) rollPrices();
  // backfill already-met objectives so we don't replay celebrations on load
  syncObjectives();

  document.querySelectorAll(".tab").forEach(t =>
    t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());

  // header: new game button + turn binding
  document.getElementById("turn").textContent = S.turn;
  // add a small new-game control into the brand
  const brand = document.querySelector(".brand");
  const ng = document.createElement("button");
  ng.className = "btn btn-sm";
  ng.style.marginLeft = "8px";
  ng.textContent = "⟲ New";
  ng.title = "New game";
  ng.addEventListener("click", newGame);
  brand.appendChild(ng);

  renderAll();
  setTab("galaxy");

  // keep turn counter live
  const obs = () => { document.getElementById("turn").textContent = S.turn; requestAnimationFrame(obs); };
  obs();
}

window.addEventListener("DOMContentLoaded", init);

/* expose handlers used by inline onclick */
Object.assign(window, {
  travel, buyQty, sellQty, mine, farm, manufacture, refineFuel,
  research, researchTech, doPolitics, doMission, buyUpgrade, newGame,
});

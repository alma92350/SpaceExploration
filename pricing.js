/* ============================================================
   STELLAR FRONTIER — market pricing
   Per-planet, supply/demand + reputation aware. planetPriceMul() sets each
   world's local price target from its deposits, reserves, industry and law;
   rollPrices() blends that with a distance-weighted regional mean (so a
   shortage bleeds into neighboring worlds without ever amplifying); buyPrice/
   sellPrice apply the market maker's spread (tightened by reputation, the
   Trade Computer and Fortunes, but never to zero — no arbitrage). Market
   depth & slippage model how a single trade moves the price it just traded
   at, healed back toward equilibrium by the next rollPrices() call.

   Loaded after state.js, before game.js. Reads reserveFrac/effIndustry/
   isIllegalAt/policyActive/fxAdd, which still live in game.js at this point
   in the split — safe, since every function here is only CALLED later, once
   every script has finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

function planetPriceMul(p, comId) {
  let m = 1;
  const c = COM[comId];
  const producesRaw = p.deposits && p.deposits[comId];
  if (producesRaw) {
    m *= 0.55;                                          // local raw → cheap…
    if (typeof S !== "undefined" && S && S.reserves)    // …until the deposit runs dry
      m *= 1 + (1 - reserveFrac(p.id, comId)) * 0.8;    // stripped world: 0.55 → ~0.99 (scarcity premium)
  }
  if (c.tier === "Raw" && !producesRaw) {
    m *= 1.25;                                          // imported raw → dear…
    if (typeof S !== "undefined" && S && S.reserves)    // …and dearer when the region's suppliers run dry
      m *= 1 + (1 - regionalSupply(p, comId)) * 0.6;
  }
  if (["Component", "Finished", "Luxury", "Strategic"].includes(c.tier))
    m *= 1 - (effIndustry(p) - 5) * 0.05;               // industrial worlds make goods cheaper
  if (isIllegalAt(comId, p.id)) m *= 1.35;              // scarce/black-market premium
  return Math.max(0.4, Math.min(1.9, m));
}

/* distance-weighted reserve health of the worlds that PRODUCE a raw good —
   an importing world's supply line. 1 = abundant nearby, 0 = region stripped. */
function regionalSupply(p, comId) {
  let wsum = 0, acc = 0;
  PLANETS.forEach(q => {
    if (q.id === p.id || !q.deposits || !q.deposits[comId]) return;
    const w = (q.deposits[comId]) / (1 + (p.distances[q.id] || 99));   // rich, close suppliers matter most
    wsum += w; acc += w * reserveFrac(q.id, comId);
  });
  return wsum > 0 ? acc / wsum : 1;
}

function rollPrices() {
  // pass 1: each world's local price target (deposits, scarcity, industry, law)
  const targets = {};
  PLANETS.forEach(p => {
    targets[p.id] = {};
    COM_IDS.forEach(c => { targets[p.id][c] = Math.min(COM[c].base * planetPriceMul(p, c) * crisisMul(p.id, c), COM[c].base * 2.8); });
  });
  // pass 2: markets are regional — blend toward a distance-weighted neighborhood mean,
  // so scarcity on one world bleeds into its neighbors. Averaging is contractive: it
  // spreads shocks but can never amplify them (no runaway prices).
  const DIFFUSION = 0.15;
  PLANETS.forEach(p => {
    S.prices[p.id] = S.prices[p.id] || {};
    COM_IDS.forEach(c => {
      let wsum = 0, acc = 0;
      PLANETS.forEach(q => {
        if (q.id === p.id) return;
        const w = 1 / (1 + (p.distances[q.id] || 99));
        wsum += w; acc += w * targets[q.id][c];
      });
      const regional = wsum > 0 ? acc / wsum : targets[p.id][c];
      const target = targets[p.id][c] * (1 - DIFFUSION) + regional * DIFFUSION;
      const stab = S.techs.markets ? 0.12 : 0.28;
      const cur = S.prices[p.id][c];
      let price = cur == null
        ? target * (1 + (Math.random() * 2 - 1) * stab)
        : cur + (target - cur) * 0.3 + target * (Math.random() * 2 - 1) * stab * 0.6;
      S.prices[p.id][c] = Math.max(2, Math.round(price));
    });
  });
}

function repPriceFactor(planet) {
  const r = S.rep[planet.faction] || 0;
  return Math.max(-0.12, Math.min(0.12, r / 100 * 0.12)); // friendly faction → up to ±12%
}
/* The market maker's half-spread (as a fraction of the mid price). The Trade
   Computer and free-trade lanes tighten it, but it never reaches zero — so the
   player's BUY price is always strictly above the SELL price (no arbitrage). */
function tradeHalfSpread() {
  let h = 0.10 - S.upgrades.trade * 0.012;
  if (policyActive("freetrade")) h -= 0.02;
  return Math.max(0.04, h);
}
/* the local mid price, including policy/decree level shifts that move BOTH the
   buy and sell sides together (a commodity is simply worth more/less here). */
function marketMid(pid, c) {
  let mid = S.prices[pid][c];
  if (policyActive("tariff")) mid *= 1.05;                          // protectionism lifts local prices
  if (policyActive("mining") && COM[c].tier === "Raw") mid *= 1.10; // raw-material windfall
  if (S.decrees.tariff === c) mid *= 1.07;                          // your governor's tariff
  return mid;
}
// faction standing tightens YOUR side of the spread (better buy & sell), bounded
// so it can never flip buy below sell.
function repSpreadBonus(p, h) { return Math.max(-0.8 * h, Math.min(0.8 * h, repPriceFactor(p))); }
function buyPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  const h = tradeHalfSpread();
  return Math.max(2, Math.round(marketMid(pid, c) * (1 + h - repSpreadBonus(p, h)) * (1 - fxAdd("buyDisc"))));  // friendly/Fortunes → buy cheaper
}
function sellPrice(pid, c) {
  const p = PLANETS.find(x => x.id === pid);
  const h = tradeHalfSpread();
  const raw = Math.round(marketMid(pid, c) * (1 - h + repSpreadBonus(p, h)) * (1 + fxAdd("sellPrem")));   // friendly/Fortunes → sell dearer
  return Math.max(1, Math.min(raw, buyPrice(pid, c) - 1));                              // always at least 1 below buy (rounding-proof: no arbitrage)
}

/* ---------- Market depth & slippage ----------
   Big trades move the local price: dumping floods the market (price falls),
   bulk buying drains supply (price rises). Markets heal toward equilibrium
   each cycle via rollPrices(). This is what keeps arbitrage from compounding
   forever — you must spread trades across worlds and cycles.
*/
function marketDepth(p, c) {
  let d = 140;
  const t = COM[c].tier;
  if (t === "Luxury" || t === "Strategic") d = 70;
  else if (t === "Finished" || t === "Component") d = 100;
  if (p.deposits && p.deposits[c]) d *= 1.8; // local producers run deep markets
  if (S.techs.markets) d *= 1.4;             // Galactic Exchange = more liquidity
  return d;
}
/* fraction the price shifts for trading `qty` units (0..0.5) */
function tradeSlippage(p, c, qty) {
  return Math.min(0.5, (qty / marketDepth(p, c)) * 0.35);
}
function applyMarketMove(pid, c, slip, isSell) {
  const f = isSell ? (1 - slip) : (1 + slip);
  S.prices[pid][c] = Math.max(2, Math.round(S.prices[pid][c] * f));
}

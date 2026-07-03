/* ============================================================
   STELLAR FRONTIER — rendering: Market, Industry, Research,
   Politics & Missions
   Second slice of the rendering layer (see renderCore.js for the
   first): the panel-render functions for five tabs — the Market
   (buy/sell/fence/customs), Industry (production recipes), Research
   (the tech tree), Politics (organizations, the Senate, trade-law
   lobbying, corruption investigations, the Office ladder), and
   Missions (long-term goals, milestones, and time-bound contracts).
   Ship, Raid, Contacts, Bases, Colonies, Escort rendering and
   renderAll() the master dispatcher stay in game.js for their own
   future slice(s), along with the generic subView/subTabBar sub-tab
   infrastructure those panels share.

   Loaded after renderCore.js, before game.js. S, subView, subTabBar
   and every render* function not listed above still live in game.js
   at this point in the split — safe, since every function here is
   only CALLED later (by renderAll(), itself only ever called after a
   player action, once every script has finished loading), same
   pattern as every prior slice.
   ============================================================ */

"use strict";

/* ----- Market ----- */
// ---- quick-trade state (session-only UI, not saved — same convention as subViews) ----
let marketQty = {};      // remembers the last quantity typed per commodity, so re-renders don't reset it to 10
let marketSort = "default";
function setMarketSort(mode) { marketSort = mode; renderMarket(); }
// the best KNOWN world to sell a commodity bought here, ranked by profit per light-year of travel
function bestFlipFor(c) {
  const here = currentPlanet();
  let best = null;
  PLANETS.filter(galaxyKnown).forEach(p => {
    if (p.id === here.id) return;
    const dist = (here.distances && here.distances[p.id]) || 0;
    if (!dist) return;
    const there = sellPrice(p.id, c);
    const profitPerLy = (there - buyPrice(here.id, c)) / dist;
    if (!best || profitPerLy > best.profitPerLy) best = { p, there, dist, profitPerLy };
  });
  return best;
}
// everything sellable (legal) in your hold at this market, for the one-click "Sell hold" action
function sellableHoldPreview() {
  const p = currentPlanet();
  const parts = [];
  CARGO_IDS.forEach(c => {
    const qty = S.res[c] || 0;
    if (qty <= 0 || isIllegalAt(c, p.id)) return;
    const slip = tradeSlippage(p, c, qty);
    const rev = Math.round(sellPrice(p.id, c) * (1 - slip / 2) * qty);
    parts.push({ c, qty, slip, rev });
  });
  const illegalHeld = CARGO_IDS.filter(c => (S.res[c] || 0) > 0 && isIllegalAt(c, p.id));
  return { total: parts.reduce((s, x) => s + x.rev, 0), parts, illegalHeld };
}
function sellEntireHold() {
  const { parts, illegalHeld, total } = sellableHoldPreview();
  if (!parts.length) return toast(illegalHeld.length ? "Only illegal goods in hold here — sell those individually (risks a customs check)." : "Your hold is empty.", "bad");
  const p = currentPlanet();
  const summary = [];
  parts.forEach(({ c, qty, slip, rev }) => {
    S.res[c] -= qty; S.res.credits += rev;
    summary.push(`${qty}${COM[c].ico}`);
    applyMarketMove(p.id, c, slip, true);
  });
  S.stats.trades++; S.stats.profit += total; S.stats.sales = (S.stats.sales || 0) + total; addRep(p.faction, 1);
  log(`Sold your hold — ${summary.join(" ")} for <span class="c">${fmt(total)}</span> cr${illegalHeld.length ? ` (${illegalHeld.length} illegal good(s) held back)` : ""}.`, "good");
  toast(`Sold hold (+${fmt(total)} cr)`, "good"); sfx("sell");
  afterAction();
}
function renderMarket() {
  const el = document.getElementById("panel-market");
  const p = currentPlanet();
  const showTrend = S.techs.markets;
  const flipCache = {};
  const flipFor = c => (c in flipCache) ? flipCache[c] : (flipCache[c] = bestFlipFor(c));
  let rows = "";
  TIERS.forEach(tier => {
    let ids = COM_IDS.filter(c => COM[c].tier === tier);
    if (!ids.length) return;
    if (!tierRevealed(tier) && !ids.some(c => (S.res[c] || 0) > 0)) return;   // hidden until disclosed (unless you carry some)
    if (marketSort === "margin") ids = ids.slice().sort((a, b) => (flipFor(b) ? flipFor(b).profitPerLy : -Infinity) - (flipFor(a) ? flipFor(a).profitPerLy : -Infinity));
    rows += `<tr><td colspan="6" class="section-title" style="padding-top:14px">${tier}</td></tr>`;
    ids.forEach(c => {
      const bp = buyPrice(p.id, c), sp = sellPrice(p.id, c), base = COM[c].base;
      const trend = bp > base * 1.12 ? '<span class="price-up">▲</span>' : bp < base * 0.88 ? '<span class="price-down">▼</span>' : '<span class="hint">—</span>';
      const illegal = isIllegalAt(c, p.id) ? ' <span class="pill bad" title="Contraband here">illegal</span>' : '';
      const flip = flipFor(c);
      const flipHint = (flip && flip.profitPerLy > 0 && flip.there > sp * 1.15)
        ? ` <span class="hint" title="Best flip: buy here, sell at ${flip.p.name} for ${fmt(flip.there)} cr (${flip.dist} ly) — ~${fmt(Math.round(flip.profitPerLy))} cr/ly profit">💡${flip.p.name}</span>` : "";
      rows += `<tr>
        <td>${COM[c].ico} ${COM[c].name}${illegal}</td>
        <td class="num">${fmt(bp)}</td><td class="num">${fmt(sp)}${flipHint}</td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td>${showTrend ? trend : '<span class="hint">?</span>'}</td>
        <td><div class="trade-controls">
          <input class="qty" id="qty-${c}" type="number" min="1" value="${marketQty[c] || 10}" />
          <button class="btn btn-sm btn-good" onclick="buyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-good" title="Buy until cargo/tank is full" onclick="buyMax('${c}')">Fill</button>
          <button class="btn btn-sm btn-bad" onclick="sellQty('${c}')">Sell</button>
          <button class="btn btn-sm btn-bad" title="Sell your entire stock" onclick="sellAll('${c}')">All</button>
        </div></td></tr>`;
    });
  });
  if (TIERS.some(t => !tierRevealed(t))) rows += `<tr><td colspan="6" class="hint" style="padding-top:12px">🔒 Advanced markets (components, finished goods, luxuries, strategics) open once you <b>manufacture your first Medicine</b> — see Missions → Next Steps.</td></tr>`;
  // ---- Black market: fence held cargo off the books (no customs, no Wanted) ----
  let blackMarket = "";
  if (hasBlackMarket(p)) {
    const held = CARGO_IDS.filter(c => (S.res[c] || 0) > 0);
    let frows = held.map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name}${isIllicit(c) ? ' <span class="pill bad" title="Hot goods — fences pay a premium">hot</span>' : ''}</td>
        <td class="num">${fmt(fencePrice(p.id, c))}</td>
        <td class="num">${fmt(S.res[c])}</td>
        <td><div class="trade-controls">
          <input class="qty" id="fq-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-bad" onclick="fenceQty('${c}')">Fence</button>
          <button class="btn btn-sm btn-bad" title="Fence your entire stock" onclick="fenceAll('${c}')">All</button>
        </div></td></tr>`).join("");
    if (!held.length) frows = `<tr><td colspan="4" class="hint">Your hold is empty — bring plunder to fence.</td></tr>`;
    blackMarket = `<div class="card" style="border-color:var(--accent-2);margin-top:18px">
      <h4>🕴️ Black Market <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">no questions asked</span></h4>
      <div class="hint">Fences here buy off the books — no customs, no Wanted. <b>Hot</b> goods fetch a premium; mundane cargo takes a haircut. Your Dread sweetens every deal.</div>
      <table style="margin-top:8px"><thead><tr><th>Commodity</th><th class="num">Fence</th><th class="num">Hold</th><th></th></tr></thead><tbody>${frows}</tbody></table>
      ${held.length ? `<button class="btn btn-bad" style="margin-top:10px" onclick="fenceAllPlunder()">🕴️ Fence entire hold</button>` : ""}
    </div>`;
  }
  const _mcr = S.crises && S.crises[p.id];
  let crisisBanner = "";
  if (_mcr) {
    const cdef = CRISES[_mcr.type];
    const needRows = Object.keys(cdef.spike).map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name} <span class="pill bad">×${cdef.spike[c].toFixed(1)} demand</span></td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td><div class="trade-controls">
          <input class="qty" id="relief-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm btn-good" title="Give it away — earn gratitude: rep, influence, popularity. Big shipments speed recovery." onclick="donateReliefQty('${c}')">🩹 Donate</button>
          <button class="btn btn-sm btn-bad" title="Sell at a vulture's premium (+35% on crisis prices) — costs rep, legitimacy, heat" onclick="gougeSellQty('${c}')">🦅 Gouge</button>
        </div></td></tr>`).join("");
    crisisBanner = `<div class="card" style="border-color:var(--bad)">
      <h4>${cdef.ico} ${cdef.name} — ${p.name} in crisis <span class="pill bad">${_mcr.cyclesLeft} cyc left</span></h4>
      <div class="hint">The world is desperate for the goods below. <b>Donate</b> to be the hero (reputation, influence, popularity — and the crisis shortens), <b>Gouge</b> to profiteer at a premium (and be remembered for it), or <b>Loot</b> the chaos outright.</div>
      <table style="margin-top:8px"><thead><tr><th>Needed</th><th class="num">Hold</th><th></th></tr></thead><tbody>${needRows}</tbody></table>
      <button class="btn btn-bad btn-sm" style="margin-top:8px" ${actionsLeft() > 0 ? "" : "disabled"} title="Scavenge valuables from the disorder — credits and goods, at the cost of standing and heat" onclick="lootCrisis()">🦅 Loot the chaos (1 action)</button>
    </div>`;
  }
  const sortBtns = `<span class="hint">Sort:</span> <button class="btn btn-sm ${marketSort === "default" ? "btn-primary" : ""}" onclick="setMarketSort('default')">Default</button> <button class="btn btn-sm ${marketSort === "margin" ? "btn-primary" : ""}" title="Rank each tier by its best known cross-world profit per light-year" onclick="setMarketSort('margin')">💡 Best margin</button>`;
  const holdPreview = sellableHoldPreview();
  const sellHoldBtn = holdPreview.parts.length
    ? `<button class="btn btn-bad" style="margin-top:10px" title="Sell every legal good in your hold at today's prices${holdPreview.illegalHeld.length ? ` (${holdPreview.illegalHeld.length} illegal good(s) here will be held back)` : ""}" onclick="sellEntireHold()">💰 Sell entire hold (+${fmt(holdPreview.total)} cr)</button>` : "";
  el.innerHTML = `<h2>${p.name} Market ${_mcr ? `<span class="pill bad">${CRISES[_mcr.type].ico} crisis</span>` : ""}</h2>
    <div class="subtitle">${p.tag}. ${showTrend ? "Galactic Exchange reveals trends &amp; deepens liquidity." : "Research the Galactic Exchange to reveal price trends."} Large trades move the price — dumping a lot crashes it, bulk buying spikes it; markets recover over cycles. Items marked <span class="pill bad">illegal</span> risk a customs bust here.${hasBlackMarket(p) ? ' A <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">black market</span> operates here.' : ''} 💡 hints show the best known world to flip a good you buy here.</div>
    ${crisisBanner}
    <div class="row" style="margin:8px 0;flex-wrap:wrap;gap:6px;align-items:center">${sortBtns}</div>
    <table><thead><tr><th>Commodity</th><th class="num">Buy</th><th class="num">Sell</th><th class="num">Hold</th><th>Trend</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${blackMarket}
    <div class="row" style="margin-top:14px"><span class="hint">Cargo ${cargoUsed()}/${cargoCap()} · Fuel ${S.res.fuel}/${fuelCap()} · Credits ${fmt(S.res.credits)}</span></div>
    ${sellHoldBtn}`;
}
function buyQty(c) { const v = +document.getElementById("qty-" + c).value; marketQty[c] = v; buy(c, v); }
function sellQty(c) { const v = +document.getElementById("qty-" + c).value; marketQty[c] = v; sell(c, v); }
function sellAll(c) {
  if ((S.res[c] || 0) <= 0) return toast(`No ${COM[c].name} to sell.`, "bad");
  sell(c, S.res[c]); // sell() handles slippage & contraband checks
}
function buyMax(c) {
  const p = currentPlanet();
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();
  if (space <= 0) return toast(COM[c].isFuel ? "Fuel tank is full." : "Cargo hold is full.", "bad");
  // most we could fit, capped by credits; trim down for slippage raising the avg price
  let qty = Math.min(space, Math.floor(S.res.credits / buyPrice(S.location, c)));
  while (qty > 0) {
    const slip = tradeSlippage(p, c, qty);
    if (Math.round(buyPrice(S.location, c) * (1 + slip / 2) * qty) <= S.res.credits) break;
    qty--;
  }
  if (qty <= 0) return toast("Not enough credits to buy any.", "bad");
  marketQty[c] = qty;
  buy(c, qty);
}

/* ----- Industry ----- */
function renderIndustry() {
  const el = document.getElementById("panel-industry");
  const p = currentPlanet();
  const al = actionsLeft();

  // Extraction cards (location bound)
  let extractCards = "";
  Object.keys(p.deposits || {}).forEach(c => {
    const { mod, tech, ok, blockMsg } = extractMods(c);
    const frac = reserveFrac(p.id, c);
    const est = Math.round(14 * p.deposits[c] * mod * tech * depletionMult(p.id, c) * pollutionYieldMult(p.id));
    const verb = { mine: "Mine", forage: "Forage", capture: "Capture", exploit: "Recover" }[COM[c].extract];
    const illegal = COM[c].illegalAt ? ' <span class="pill bad">hot cargo</span>' : '';
    const resCol = frac >= 0.6 ? "var(--good)" : frac >= 0.3 ? "var(--warn)" : "var(--bad)";
    const renew = RENEWABLE_RES[c] ? ' <span class="hint">(renews)</span>' : '';
    extractCards += `<div class="card ${ok ? "" : "locked"}">
      <h4>${COM[c].ico} ${verb} ${COM[c].name}${illegal}</h4>
      <div class="desc">${({mine:"Mining",forage:"Foraging",capture:"Gas capture",exploit:"Ruin salvage"})[COM[c].extract]} — yield scales with this world's deposit, your gear, and remaining reserves.</div>
      <div class="meta"><span class="hint">Reserves${renew}</span><span class="cost" style="color:${resCol}">${Math.round(frac * 100)}%</span></div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">≈ ${est} ${COM[c].ico}</span></div>
      ${ok ? `<button class="btn btn-primary" ${al>0 && cargoFree()>0 ? "" : "disabled"} onclick="extract('${c}')">Extract (1 action)</button>`
           : `<div class="hint" style="color:var(--bad)">${blockMsg}</div>`}
    </div>`;
  });
  if (p.salvage) {
    const ok = S.upgrades.salvager >= 1;
    extractCards += `<div class="card ${ok ? "" : "locked"}">
      <h4>🧲 Salvage Wrecks</h4>
      <div class="desc">Strip derelicts for metals & electronics — chance of rare finds. Needs a Salvage Rig.</div>
      ${ok ? `<button class="btn btn-primary" ${al>0 && cargoFree()>0 ? "" : "disabled"} onclick="salvage()">Salvage (1 action)</button>`
           : `<div class="hint" style="color:var(--bad)">Requires a Salvage Rig module.</div>`}
    </div>`;
  }
  const _pl = pirateLevel(p.id);
  if (_pl > 0) {
    const threat = _pl >= 4 ? "infested" : _pl >= 2 ? "high" : "low";
    extractCards += `<div class="card" style="border-color:var(--warn)">
      <h4>⚠️ Pirate Activity <span class="pill ${_pl >= 2 ? "bad" : ""}">${threat} (level ${_pl})</span></h4>
      <div class="desc">Raiders prowl this system — they prey on convoys, colonies and travellers. Hunt them down from the <b>⚔️ Raider</b> tab: bounties scale with the pirate's rank, and every kill calms the lanes.</div>
      <button class="btn btn-primary" onclick="setTab('raid')">Go hunting ⚔️</button>
    </div>`;
  }

  // Production cards
  const prodCards = RECIPES.map(r => {
    const avail = recipeAvailable(r);
    const inStr = Object.entries(r.in).map(([k, v]) => `${v}${COM[k].ico}`).join(" + ");
    let cap = Math.floor((3 + p.industry) * (1 + S.upgrades.factory * 0.30));
    if (r.reactor) cap = Math.floor(cap * (1 + S.upgrades.reactor * 0.40));
    const batches = Math.min(cap, recipeMaxBatches(r));
    const canRun = avail && batches > 0 && al > 0;
    const reqName = r.req ? TECHS.find(t => t.id === r.req).name : "";
    return `<div class="card ${avail ? "" : "locked"}">
      <h4>${COM[r.out].ico} ${COM[r.out].name}</h4>
      <div class="desc">${inStr} → ${r.qty} ${COM[r.out].ico} per batch.</div>
      ${avail ? `<div class="meta"><span class="hint">This run</span><span class="cost">${batches>0 ? "×"+batches+" batch"+(batches>1?"es":"") : "missing inputs"}</span></div>
        <button class="btn btn-primary" ${canRun ? "" : "disabled"} onclick="produce('${r.id}')">Produce (1 action)</button>`
        : `<div class="hint" style="color:var(--bad)">Requires tech: ${reqName}</div>`}
    </div>`;
  }).join("");

  const IND_VIEWS = [["extract", "⛏️ Extraction"], ["produce", "🏭 Production"]];
  const body = subView("industry", IND_VIEWS) === "produce"
    ? `<div class="section-title">🏭 Production</div>
       <div class="cards">${prodCards}</div>`
    : `<div class="section-title">⛏️ Extraction (here)</div>
       <div class="cards">${extractCards || '<div class="hint">No raw deposits on this world — trade or produce instead.</div>'}</div>`;
  el.innerHTML = `<h2>Industry — ${p.name}</h2>
    <div class="subtitle">Industry level ${p.industry}/10. Extract raw materials (only what this world holds), then refine and manufacture them. Each task uses 1 action. Actions left: <b>${al}</b>.</div>
    ${subTabBar("industry", IND_VIEWS)}
    ${body}`;
}

/* ----- Research ----- */
function renderResearch() {
  const el = document.getElementById("panel-research");
  const p = currentPlanet();
  const al = actionsLeft();
  const techCards = TECHS.map(t => {
    const done = techUnlocked(t), avail = techAvailable(t);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const reqTxt = t.req.length ? `Requires: ${t.req.map(r => TECHS.find(x => x.id === r).name).join(", ")}` : "";
    const r = TECH_RESEARCH[t.id];
    const mats = techMatCost(t);
    const affine = r && worldAffinity(p, r.domain);
    const gateOk = techMinTechMet(t);
    const canPts = S.res.tech >= t.cost, canMat = canAfford(mats);
    const domainLine = r ? `<div class="hint">${TECH_DOMAINS[r.domain] || r.domain} research${affine ? ' · <span style="color:var(--good)">local expertise (materials halved)</span>' : '<span style="opacity:.7"> · no local expertise here</span>'}</div>` : "";
    const matLine = (!done && Object.keys(mats).length) ? `<div class="hint">Materials: ${matsString(mats)}</div>` : "";
    const gateLine = (!done && r && r.minTech && !gateOk) ? `<div class="hint" style="color:var(--bad)">🔒 needs a Tech ${r.minTech}+ world (here: ${effTech(p)})</div>` : "";
    return `<div class="${cls}">
      <h4>${t.ico} ${t.name} ${done ? '<span class="pill good">researched</span>' : ""}</h4>
      <div class="desc">${t.desc}</div>
      ${reqTxt ? `<div class="hint">${reqTxt}</div>` : ""}
      ${done ? "" : domainLine + matLine + gateLine}
      <div class="meta"><span class="cost">${t.cost} 🔬${Object.keys(mats).length ? " + materials" : ""}</span>
        ${done ? "" : `<button class="btn btn-primary" ${avail && canPts && canMat && gateOk ? "" : "disabled"} onclick="researchTech('${t.id}')">Research</button>`}</div>
    </div>`;
  }).join("");
  const researched = TECHS.filter(techUnlocked).length;
  const RES_VIEWS = [["lab", "🔬 Laboratory"], ["tree", `🌳 Tech Tree (${researched}/${TECHS.length})`]];
  const expPts = Math.round((2 + effTech(p)) * (1 + S.upgrades.lab * 0.40));
  const haveEnergy = (S.res.energy || 0) >= RESEARCH_ENERGY;
  const labBody = `<div class="cards"><div class="card">
      <h4>🔬 Run Experiments</h4>
      <div class="desc">Burns <b>${RESEARCH_ENERGY} ⚡ energy</b> to power the lab. Output scales with this world's tech level (${effTech(p)}/10) and your Research Lab — research at a tech hub for far more.</div>
      <div class="meta"><span class="hint">Est. output</span><span class="cost">+${expPts} 🔬 · −${RESEARCH_ENERGY}⚡</span></div>
      ${haveEnergy ? "" : `<div class="hint" style="color:var(--bad)">Not enough energy (have ${fmt(S.res.energy || 0)}⚡) — refine or buy some.</div>`}
      <button class="btn btn-primary" ${al > 0 && haveEnergy ? "" : "disabled"} onclick="research()">Research (1 action)</button>
    </div>
    <div class="card"><h4>📈 Knowledge</h4>
      <div class="ship-stat"><span class="k">🔬 Tech points</span><span class="v">${fmt(S.res.tech)}</span></div>
      <div class="ship-stat"><span class="k">🧪 Researched</span><span class="v">${researched} / ${TECHS.length}</span></div>
      <div class="ship-stat"><span class="k">🔬 Lab tier</span><span class="v">${S.upgrades.lab ? "Tier " + S.upgrades.lab : "none"}</span></div>
      <div class="hint" style="margin-top:6px">Switch to the 🌳 Tech Tree to spend points.</div>
    </div></div>`;
  const body = subView("research", RES_VIEWS) === "tree"
    ? `<div class="section-title">Technology Tree</div><div class="cards">${techCards}</div>`
    : labBody;
  el.innerHTML = `<h2>Research & Technology</h2>
    <div class="subtitle">Generate tech points, then unlock new extraction, production and strategic tech. You have <b>${fmt(S.res.tech)} 🔬</b>.</div>
    ${subTabBar("research", RES_VIEWS)}
    ${body}`;
}

/* ----- Politics ----- */
function polMeter(label, ico, val, max, col, note) {
  const pct = Math.max(0, Math.min(100, (val / max) * 100));
  return `<div class="ship-stat"><span class="k">${ico} ${label}</span><span class="v">${note != null ? note : Math.round(val)}</span></div>
    <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}
/* ---- The Concordat Spire — a late-game mega-project, hidden until Terraforming is
   researched (spireUnlocked(), sector4x.js). Three states: no site chosen yet (a
   colony picker + groundbreaking cost), under construction (per-resource polMeter()
   bars + contribution rows, docked-colony-only for materials, tech from anywhere),
   complete (a capstone card mirroring lordCard/marshalCard in renderCombat.js). ---- */
function renderSpireProject() {
  if (!spireUnlocked()) return "";
  if (!S.spire) {
    const cols = Object.keys(S.colonies || {});
    if (!cols.length) return `<div class="section-title">🏛️ The Concordat Spire</div>
      <div class="cards"><div class="card"><div class="hint">Terraforming is researched — a mega-project is within reach, but it needs a colony to break ground at. Found one first.</div></div></div>`;
    const afford = (S.res.credits || 0) >= SPIRE_SITE_COST.credits && canAfford({ metals: SPIRE_SITE_COST.metals });
    const rows = cols.map(pid => `<button class="btn btn-sm" ${afford ? "" : "disabled"} onclick="launchSpireProject('${pid}')">${mdPlanetName(pid)}</button>`).join(" ");
    return `<div class="section-title">🏛️ The Concordat Spire</div>
      <div class="cards"><div class="card" style="border-color:var(--accent-2)">
        <h4>🏛️ Break Ground</h4>
        <div class="desc">Terraforming is researched — the sector's science has nowhere left to go but into something permanent. Designate one of your colonies as the Spire's site: a monument funded from anywhere in your empire, over as long as it takes.</div>
        <div class="meta"><span class="hint">Groundbreaking</span><span class="cost">${fmt(SPIRE_SITE_COST.credits)} cr + ${SPIRE_SITE_COST.metals} ⛓️</span></div>
        <div class="row" style="flex-wrap:wrap;gap:4px;margin-top:6px">${rows}</div>
      </div></div>`;
  }
  const siteName = mdPlanetName(S.spire.site);
  if (S.spire.complete) {
    const ready = spireReady(), dom = spireDominantFaction();
    return `<div class="section-title">🏛️ The Concordat Spire</div>
      <div class="cards"><div class="card maxed">
        <h4>🏛️ The Concordat Spire Stands</h4>
        <div class="pill good">Complete — raised at ${siteName}</div>
        <div class="hint" style="margin-top:6px">${dom ? `A monument to ${FACTIONS[dom].name} alone.` : "A monument to every faction's shared work."}</div>
        ${ready ? `<button class="btn btn-primary" style="margin-top:8px" onclick="spireLegacy()">🏛️ Claim your legacy</button>`
          : S.legacyTitle ? `<div class="pill good" style="margin-top:8px">${S.legacyTitle}</div>` : ""}
      </div></div>`;
  }
  const here = S.colonies[S.location];
  const meters = Object.keys(SPIRE_TARGETS).map(c => {
    const meta = c === "tech" ? { name: "Tech", ico: "🔬" } : COM[c];
    return polMeter(meta.name, meta.ico, S.spire.contributed[c], SPIRE_TARGETS[c], "var(--accent)", `${fmt(S.spire.contributed[c])}/${fmt(SPIRE_TARGETS[c])}`);
  }).join("");
  const dom = spireDominantFaction();
  const mood = dom ? `<span style="color:var(--bad)">⚠️ ${FACTIONS[dom].name} is seen as claiming this project — its rivals grow tenser.</span>`
    : `<span class="hint">Contributions are broadly shared so far — a common cause, easing tensions sector-wide.</span>`;
  const techRow = `<div class="ship-stat" style="align-items:center"><span class="k">🔬 Contribute tech <span class="hint">${fmt(S.res.tech || 0)} on hand</span></span>
    <span class="v"><input class="qty" id="spire-techqty" type="number" min="1" value="${Math.min(100, S.res.tech || 0)}" style="width:70px" />
    <button class="btn btn-sm" ${(S.res.tech || 0) > 0 ? "" : "disabled"} onclick="contributeSpireTech(+document.getElementById('spire-techqty').value)">Send ▸</button></span></div>`;
  const matRows = here ? ["alloys", "electronics", "antimatter"].map(c => {
    const stock = here.storage[c] || 0;
    return `<div class="ship-stat" style="align-items:center"><span class="k">${COM[c].ico} ${COM[c].name} <span class="hint">${fmt(stock)} in ${currentPlanet().name}</span></span>
      <span class="v"><input class="qty" id="spire-${c}" type="number" min="1" value="${Math.min(50, stock) || 1}" style="width:70px" />
      <button class="btn btn-sm" ${stock > 0 ? "" : "disabled"} onclick="contributeToSpire('${c}')">Ship ▸</button></span></div>`;
  }).join("") : `<div class="hint">Dock at one of your colonies to ship its stocked materials to the Spire.</div>`;
  return `<div class="section-title">🏛️ The Concordat Spire <span class="hint">${spirePctComplete()}% complete — rising at ${siteName}</span></div>
    <div class="cards"><div class="card">
      <h4>🏛️ Under Construction</h4>
      <div class="hint">${mood}</div>
      <div style="margin:8px 0">${meters}</div>
      ${techRow}
      ${matRows}
    </div></div>`;
}
function abilityCostStr(c) {
  c = c || {}; const parts = [];
  if (c.credits)   parts.push(`${fmt(c.credits)} 💰`);
  if (c.influence) parts.push(`${c.influence} 🏛️`);
  if (c.slush)     parts.push(`${fmt(c.slush)} 💼`);
  return parts.length ? parts.join(" + ") : "free";
}
function renderPower() {
  if (!canPolitick()) {
    return `<div class="section-title">🏛️ Power & Organizations</div>
      <div class="cards"><div class="card"><h4>🏛️ Organizations locked</h4>
        <div class="desc">Research <b>📜 Galactic Charter</b> (Research tab) to found political organizations and wield public power — parties, media, foundations, security and more.</div></div></div>`;
  }
  const P = S.pol;
  const legLabel = P.legitimacy >= 40 ? "Statesman" : P.legitimacy <= -40 ? "Notorious"
                 : P.legitimacy > 0 ? "Respected" : P.legitimacy < 0 ? "Shady" : "Neutral";
  const heatCol = P.heat >= 65 ? "var(--bad)" : P.heat >= 35 ? "var(--warn)" : "var(--good)";
  const meters = `<div class="card"><h4>📊 Standing</h4>
    ${polMeter("Popularity", "📣", P.popularity, 100, "var(--accent)")}
    ${polMeter("Legitimacy", "⚖️", P.legitimacy + 100, 200, P.legitimacy >= 0 ? "var(--good)" : "var(--bad)", `${legLabel} (${P.legitimacy > 0 ? "+" : ""}${Math.round(P.legitimacy)})`)}
    ${polMeter("Heat", "🔥", P.heat, 100, heatCol)}
    <div class="ship-stat"><span class="k">🏛️ Influence</span><span class="v">${fmt(S.res.influence)}</span></div>
    <div class="ship-stat"><span class="k">💼 Slush fund</span><span class="v">${fmt(P.slush)}</span></div>
    <div class="ship-stat"><span class="k">🧾 Org upkeep</span><span class="v">${fmt(orgUpkeepTotal())}/cyc</span></div>
  </div>`;
  const al = actionsLeft();
  const cards = ORGS.map(def => {
    const o = S.orgs[def.id];
    const tonePill = `<span class="pill ${POL_TONE_CLS[def.tone]}">${def.tone}</span>`;
    if (!o) {
      const can = S.res.credits >= def.foundCost;
      return `<div class="card"><h4>${def.ico} ${def.name} ${tonePill}</h4>
        <div class="desc">${def.blurb}</div>
        <div class="meta"><span class="hint">Found</span><span class="cost">${fmt(def.foundCost)} 💰 · upkeep ${fmt(def.upkeep)}/cyc</span></div>
        <button class="btn btn-primary" ${can ? "" : "disabled"} onclick="foundOrg('${def.id}')">Found</button></div>`;
    }
    const dots = Array.from({ length: def.tiers }, (_, i) => `<span class="dot ${i < o.tier ? "on" : ""}"></span>`).join("");
    const maxed = o.tier >= def.tiers, up = orgUpgradeCost(def, o.tier);
    const abil = def.abilities.map(a =>
      `<button class="btn btn-sm" ${al > 0 ? "" : "disabled"} title="${a.desc}" onclick="runOrgAbility('${def.id}','${a.id}')">${a.ico} ${a.name} · ${abilityCostStr(a.cost)}</button>`
    ).join(" ");
    return `<div class="card owned"><h4>${def.ico} ${def.name} <span class="tier-dots">${dots}</span> ${tonePill}</h4>
      <div class="hint">${def.blurb}</div>
      <div class="hint">Upkeep ${fmt(def.upkeep * o.tier)}/cyc · abilities cost 1 action</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin:6px 0">${abil}</div>
      ${maxed ? `<div class="pill good">◉ Max tier</div>`
        : `<button class="btn btn-good" ${S.res.credits >= up ? "" : "disabled"} onclick="upgradeOrg('${def.id}')">Upgrade → T${o.tier + 1} (${fmt(up)} 💰)</button>`}
    </div>`;
  }).join("");
  return `<div class="section-title">🏛️ Power & Organizations</div>
    <div class="cards">${meters}${cards}</div>`;
}
function renderInvestigation() {
  if (S.jail > 0) {
    return `<div class="card" style="border-color:var(--bad)"><h4>⛓️ Imprisoned</h4>
      <div class="desc">You're serving time — <b>${S.jail} cycle(s)</b> remain. You cannot act or travel; your organizations and laws run on without you. End the cycle to serve your sentence.</div></div>`;
  }
  if (!S.invest) return "";
  const inv = S.invest, pct = Math.round(inv.evidence), al = actionsLeft();
  const col = pct >= 70 ? "var(--bad)" : pct >= 40 ? "var(--warn)" : "var(--good)";
  const btn = (fn, label, hint) => `<button class="btn btn-sm" ${al > 0 ? "" : "disabled"} title="${hint}" onclick="${fn}">${label}</button>`;
  const cms = [
    btn("investLawyer()", "⚖️ Lawyer Up", "1,500 cr: build your defense, shave evidence (clean)"),
    btn("investBribe()", "💼 Bribe", "800 slush: cut evidence — risk of backfire"),
  ];
  if (S.orgs.media) cms.push(btn("investSpin()", "🧼 Spin", "600 cr (Media): evidence & heat down"));
  if (S.orgs.intel) cms.push(btn("investBury()", "🗄️ Bury", "1,000 cr (Intel): big evidence cut — risky"));
  if (S.orgs.pmc)   cms.push(btn("investStrongarm()", "😠 Strong-arm", "8 inf (PMC): lean on witnesses — risky"));
  if (Object.keys(S.orgs || {}).length) cms.push(btn("investScapegoat()", "🪤 Scapegoat", "sacrifice an org to drop evidence"));
  cms.push(btn("faceTrial()", "🏛️ Face Trial", "gamble on the current evidence now"));
  return `<div class="card" style="border-color:var(--bad)">
    <h4>🚨 Under Investigation <span class="pill bad">${FACTIONS[inv.lead].ico} ${FACTIONS[inv.lead].name}</span></h4>
    <div class="hint">A corruption case is building. Drive the evidence down — or it reaches trial at 100.</div>
    ${polMeter("Evidence", "📁", inv.evidence, 100, col)}
    <div class="hint">Defense built: ${Math.round(inv.defense || 0)}</div>
    <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px">${cms.join("")}</div>
  </div>`;
}
function renderOffice() {
  if (!canPolitick()) return "";
  const lvl = S.office || 0, cur = OFFICES[lvl], next = OFFICES[lvl + 1];
  const curName = cur ? `${cur.ico} ${cur.name}` : "🧑 Private Citizen";
  const termTxt = lvl <= 0 ? "" : lvl >= 4 ? "life tenure" : `${S.term} cyc term`;
  if (!next) {
    const leg = S.legacyTitle ? `<div class="pill good">Legacy: ${S.legacyTitle}</div>` : "";
    return `<div class="section-title">🏛️ Office</div><div class="cards"><div class="card owned">
      <h4>${curName}</h4><div class="desc">You hold supreme power over the sector.</div>${leg}</div></div>`;
  }
  const al = actionsLeft(), tgt = lvl + 1;
  const head = `<div class="card"><h4>${curName} ${termTxt ? `<span class="pill">${termTxt}</span>` : ""}${S.officePath && lvl > 0 ? ` <span class="hint">${S.officePath}</span>` : ""}</h4>
    <div class="hint">Rise by ballot, by backroom, or by force. Terms expire — keep your support up or be removed.</div></div>`;
  const ePop = ELECT_POP[tgt], eChest = 2000 * tgt;
  const eOk = S.pol.popularity >= ePop && S.res.credits >= eChest && al > 0;
  const eCard = `<div class="card"><h4>🗳️ Run for ${next.name}</h4>
    <div class="desc">Win at the ballot box — your popularity and money against the field. Clean: builds legitimacy.</div>
    <div class="hint">Need ${ePop}+ 📣 popularity · ${fmt(eChest)} 💰 chest</div>
    <button class="btn btn-primary" ${eOk ? "" : "disabled"} onclick="runForElection()">Campaign (1 action)</button></div>`;
  const aInf = APPOINT_INF[tgt], aRep = APPOINT_REP[tgt], aCost = 3000 * tgt;
  const patron = Object.keys(FACTIONS).filter(f => (S.rep[f] || 0) >= aRep).sort((a, b) => (S.rep[b] || 0) - (S.rep[a] || 0))[0];
  const aOk = (S.res.influence || 0) >= aInf && patron && S.res.credits >= aCost && al > 0;
  const aCard = `<div class="card"><h4>🤝 Seek Appointment</h4>
    <div class="desc">Let an allied faction install you. Backroom power, no public mandate.</div>
    <div class="hint">Need ${aInf} 🏛️ · a faction ally at ${aRep}+ rep ${patron ? `(✅ ${FACTIONS[patron].name})` : "(none yet)"} · ${fmt(aCost)} 💰</div>
    <button class="btn btn-primary" ${aOk ? "" : "disabled"} onclick="seekAppointment()">Lobby for Post (1 action)</button></div>`;
  const cPmc = COUP_PMC[tgt], pmcTier = (S.orgs.pmc && S.orgs.pmc.tier) || 0, cInf = 20 * tgt, cSlush = 1000 * tgt;
  const cOk = pmcTier >= cPmc && (S.res.influence || 0) >= cInf && S.pol.slush >= cSlush && al > 0;
  const cCard = `<div class="card"><h4>⚔️ Stage a Coup</h4>
    <div class="desc">Take power by force. Tanks legitimacy, enrages the factions, spikes Heat — and it can fail.</div>
    <div class="hint">Need 🛡️ Security tier ${cPmc} (have ${pmcTier}) · ${cInf} 🏛️ · ${fmt(cSlush)} 💼 slush</div>
    <button class="btn btn-bad" ${cOk ? "" : "disabled"} onclick="stageCoup()">Seize Power (1 action)</button></div>`;
  return `<div class="section-title">🏛️ Office — next: ${next.ico} ${next.name}</div><div class="cards">${head}${eCard}${aCard}${cCard}</div>`;
}
function renderLocalLaws() {
  if (!canPolitick()) return "";
  const p = currentPlanet(), pid = p.id, al = actionsLeft();
  const cost = 14 + Math.round(p.enforce * 20);
  const pm = S.planetLaws[pid] || {};
  const laws = Object.keys(pm).map(c =>
    `<span class="pill ${pm[c].type === "ban" ? "bad" : "good"}">${COM[c].ico} ${COM[c].name}: ${pm[c].type === "ban" ? "outlawed" : "legalized"} (${pm[c].until - S.turn} cyc)</span>`).join(" ");
  const opts = COM_IDS.map(c => `<option value="${c}">${COM[c].ico} ${COM[c].name}</option>`).join("");
  return `<div class="section-title">🏴 Local Trade Laws — ${p.name}</div>
    <div class="cards"><div class="card">
      <h4>Lobby the ${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name} authority</h4>
      <div class="desc"><b>Outlaw</b> a good to choke supply and drive up its (now contraband) price, or <b>legalize</b> a restricted good to open the market and soften it. Local, lasts ${LAW_DURATION} cycles, costs ${cost} 🏛️ influence — and it's a little shady.</div>
      <div class="hint">In force here: ${laws || "none"}</div>
      <div class="row" style="margin-top:6px">
        <select id="lawSel" class="lawsel">${opts}</select>
        <button class="btn btn-bad" ${al > 0 ? "" : "disabled"} onclick="lobbyLaw(document.getElementById('lawSel').value,'ban')">Outlaw</button>
        <button class="btn btn-good" ${al > 0 ? "" : "disabled"} onclick="lobbyLaw(document.getElementById('lawSel').value,'legal')">Legalize</button>
      </div>
    </div></div>`;
}
const VOTE_PILL = { yes: `<span class="pill good">YES</span>`, no: `<span class="pill bad">NO</span>`, abstain: `<span class="pill">abstain</span>` };
function renderSenate() {
  if (!canLegislate()) {
    return `<div class="section-title">⚖️ The Senate</div>
      <div class="cards"><div class="card"><h4>⚖️ No seat in the Senate</h4>
        <div class="desc">Win a <b>Senate Seat</b> (the Office & Elections card above) to propose legislation. Senators reshape the sector economy by passing <b>bills</b> the faction blocs vote on — including outlawing or legalizing a good sector-wide.</div></div></div>`;
  }
  // enacted policies
  let policyCards = "";
  const active = Object.keys(S.policies || {});
  if (active.length) {
    policyCards = `<div class="section-title">📐 Standing Laws</div>` +
      `<div class="cards">` + active.map(id => {
        const b = billDef(id), tgt = S.policies[id] && S.policies[id].target;
        const name = (b ? b.name : id) + (tgt ? `: ${COM[tgt].ico} ${COM[tgt].name}` : "");
        return `<div class="card owned"><h4>${name} <span class="pill ${POL_TONE_CLS[b ? b.tone : "grey"]}">${b ? b.tone : ""}</span></h4>
          <div class="hint">${b ? b.desc : ""}</div>
          <button class="btn btn-sm btn-bad" onclick="repealPolicy('${id}')">Repeal (15 🏛️)</button></div>`;
      }).join("") + `</div>`;
  }
  // the floor
  let floorHtml;
  const al = actionsLeft();
  if (S.floor) {
    const bill = billDef(S.floor.billId);
    const t = tallyFloor();
    const passing = t.yes > t.no;
    const rows = Object.keys(FACTIONS).map(f => {
      const v = factionVote(f, bill), seats = factionSeats(f), bought = (S.floor.sway[f] || 0) >= 3;
      return `<div class="ship-stat" style="align-items:center">
        <span class="k">${FACTIONS[f].ico} ${FACTIONS[f].name} <span class="hint">(${seats} seats)</span></span>
        <span class="v">${VOTE_PILL[v]}
          <button class="btn btn-sm" ${bought ? "disabled" : ""} title="Lobby: 8 influence" onclick="lobbyFaction('${f}')">Lobby</button>
          <button class="btn btn-sm" ${bought ? "disabled" : ""} title="Bribe: 600 slush" onclick="bribeFaction('${f}')">Bribe</button>
        </span></div>`;
    }).join("");
    floorHtml = `<div class="card" style="border-color:${passing ? "var(--good)" : "var(--warn)"}">
      <h4>📜 On the floor: ${bill.name}${S.floor.target ? `: ${COM[S.floor.target].ico} ${COM[S.floor.target].name}` : ""} <span class="pill ${POL_TONE_CLS[bill.tone]}">${bill.tone}</span></h4>
      <div class="hint">${bill.desc}</div>
      <div style="margin:8px 0">${rows}</div>
      <div class="meta"><span class="hint">Tally</span><span class="cost" style="color:${passing ? "var(--good)" : "var(--bad)"}">YES ${t.yes} – ${t.no} NO · ${t.abstain} abstain → <b>${passing ? "PASSING" : "FAILING"}</b></span></div>
      <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="callVote()">Call the Vote</button>
    </div>`;
  } else {
    const proposable = BILLS.filter(b => b.oneShot || !policyActive(b.id)).map(b => {
      const locked = b.reqPerk && !S.perks[b.reqPerk];
      const cstr = `${b.proposeCost || 20} 🏛️${b.proposeCredits ? " + " + fmt(b.proposeCredits) + " 💰" : ""}`;
      const sel = b.targeted ? `<select id="billtgt-${b.id}" class="lawsel">${COM_IDS.map(c => `<option value="${c}">${COM[c].ico} ${COM[c].name}</option>`).join("")}</select> ` : "";
      const onclick = b.targeted ? `proposeBill('${b.id}', document.getElementById('billtgt-${b.id}').value)` : `proposeBill('${b.id}')`;
      return `<div class="card"><h4>${b.name} <span class="pill ${POL_TONE_CLS[b.tone]}">${b.tone}</span></h4>
        <div class="desc">${b.desc}</div>
        <div class="meta"><span class="hint">Propose</span><span class="cost">${cstr}</span></div>
        ${locked ? `<div class="hint" style="color:var(--bad)">Requires Sector Governor</div>`
          : `<div class="row">${sel}<button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="${onclick}">Propose (1 action)</button></div>`}</div>`;
    }).join("");
    floorHtml = `<div class="hint">The floor is open — propose a bill (one at a time). The blocs vote on its merits, your standing, the public mood, and any lobbying you do.</div>
      <div class="cards">${proposable}</div>`;
  }
  return `${policyCards}<div class="section-title">⚖️ The Senate <span class="hint">(${senateSize()} seats)</span></div>${S.floor ? `<div class="cards">${floorHtml}</div>` : floorHtml}`;
}
function renderPolitics() {
  const el = document.getElementById("panel-politics");
  const p = currentPlanet();
  const al = actionsLeft();
  const status = (S.office && currentOffice()) ? `${currentOffice().ico} ${currentOffice().name}` : "Free Trader";
  const reps = Object.keys(FACTIONS).map(repBar).join("");

  // Governor decrees
  let decrees = "";
  if (S.perks.governor) {
    const opts = COM_IDS.map(c => `<button class="btn btn-sm ${S.decrees.monopoly===c?"btn-good":""}" onclick="setDecree('monopoly','${c}')">${COM[c].ico}</button>`).join(" ");
    const topts = COM_IDS.map(c => `<button class="btn btn-sm ${S.decrees.tariff===c?"btn-good":""}" onclick="setDecree('tariff','${c}')">${COM[c].ico}</button>`).join(" ");
    decrees = `<div class="section-title">👑 Governor Decrees</div>
      <div class="cards"><div class="card">
        <h4>Trade Monopoly ${S.decrees.monopoly ? COM[S.decrees.monopoly].ico + " " + COM[S.decrees.monopoly].name : ""}</h4>
        <div class="desc">Claim a commodity monopoly for passive credits every cycle. Click to set/clear.</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${opts}</div>
      </div><div class="card">
        <h4>Sell Tariff ${S.decrees.tariff ? COM[S.decrees.tariff].ico + " " + COM[S.decrees.tariff].name : ""}</h4>
        <div class="desc">Your political clout lifts YOUR sell price (+15%) for one commodity. Click to set/clear.</div>
        <div style="display:flex;flex-wrap:wrap;gap:4px">${topts}</div>
      </div></div>`;
  }

  el.innerHTML = `<h2>Politics, Factions & Trade Law</h2>
    <div class="subtitle">Status: <b>${status}</b>. Build a political machine: found organizations, sway the public, write law, and raise funds (clean and dirty). Contracts &amp; missions now live in the 🎯 Missions tab. You have <b>${fmt(S.res.influence)} 🏛️</b> influence.</div>
    <div class="cards">
      <div class="card"><h4>🏛️ Lobby & Network</h4>
        <div class="desc">Earn influence and reputation with <b>${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}</b> (controls ${p.name}).</div>
        <div class="meta"><span class="hint">Est.</span><span class="cost">+${Math.round((2 + (p.tech + p.industry) / 3) * (1 + S.upgrades.envoy * 0.40) * (S.perks.governor ? 1.6 : S.perks.senator ? 1.3 : 1))} 🏛️</span></div>
        <button class="btn btn-primary" ${al > 0 ? "" : "disabled"} onclick="doPolitics()">Lobby (1 action)</button>
      </div>
      <div class="card"><h4>🤝 Faction Standing</h4>${reps}</div>
      ${renderSectorRelations()}
      ${renderTerritoryContests()}
      ${(!S.office && !S.orgs.party) ? `<div class="card" style="border-color:var(--accent-2)">
        <h4>🚀 Enter Public Life</h4>
        <div class="desc">Launch a political career without leaving the cockpit: found your own <b>📣 People's Movement</b>, seed a war chest of clout (+15 🏛️, +10 popularity), and start the climb — rally, then run for Councillor.</div>
        <div class="meta"><span class="hint">One-time</span><span class="cost">${fmt(PUBLIC_LIFE_COST)} 💰 + 1 action</span></div>
        <button class="btn btn-primary" ${al > 0 && S.res.credits >= PUBLIC_LIFE_COST ? "" : "disabled"} onclick="enterPublicLife()">Enter Public Life</button>
      </div>` : ""}
    </div>
    ${(() => { const ic = renderInvestigation(); return ic ? `<div class="cards">${ic}</div>` : ""; })()}
    ${renderOffice()}
    ${renderPower()}
    ${renderLocalLaws()}
    ${renderSenate()}
    ${decrees}
    ${renderSpireProject()}`;
}

/* ----- Missions (long-term goals + time-bound contracts) ----- */
function renderMissions() {
  const el = document.getElementById("panel-missions");
  if (!el) return;

  // Long-term: the legacy goals that win the game
  const wp = winProgress();
  const goals = Object.values(wp).map(g => `<div class="ship-stat"><span class="k">${g.have ? "✅" : "⬜"} ${g.label}</span></div>`).join("");

  // Long-term: career missions (requirement-gated, no clock)
  const missionCards = MISSIONS.map(m => {
    const done = S.missions[m.id], avail = missionAvailable(m), can = avail && missionCanDo(m);
    const cls = done ? "card owned" : avail ? "card" : "card locked";
    const needTxt = m.need ? `Deliver: ${m.need.qty} ${COM[m.need.commodity].ico} ${COM[m.need.commodity].name}. ` : "";
    const repTxt = m.needRep ? `Needs rep: ${Object.entries(m.needRep).map(([f, n]) => `${FACTIONS[f].ico}≥${n}`).join(", ")}. ` : "";
    const lock = !avail && !done ? (m.reqPerk && !S.perks[m.reqPerk] ? `Requires: ${m.reqPerk}` : m.reqTech && !S.techs[m.reqTech] ? `Requires tech: ${TECHS.find(x => x.id === m.reqTech).name}` : "") : "";
    return `<div class="${cls}">
      <h4>${m.name} <span class="badge">T${m.tier}</span> ${m.faction ? FACTIONS[m.faction].ico : ""} ${done ? '<span class="pill good">done</span>' : ""}</h4>
      <div class="desc">${m.desc}</div>
      <div class="hint">${needTxt}${repTxt}Cost: ${costString(m.cost)}</div>
      <div class="hint">Reward: ${costString(m.reward)}</div>
      ${lock ? `<div class="hint" style="color:var(--bad)">${lock}</div>` : ""}
      ${done ? "" : `<button class="btn btn-primary" ${can ? "" : "disabled"} onclick="doMission('${m.id}')">Undertake</button>`}
    </div>`;
  }).join("");

  // Time-bound: faction contracts with a deadline
  const contractCards = S.contracts.length ? S.contracts
    .slice().sort((a, b) => a.deadline - b.deadline).map(c => {
      const dest = PLANETS.find(p2 => p2.id === c.planetId);
      const left = c.deadline - S.turn;
      const here = S.location === c.planetId;
      const have = (S.res[c.commodity] || 0) >= c.qty;
      const urgent = left <= 2;
      return `<div class="card" ${urgent ? 'style="border-color:var(--warn)"' : ""}>
        <h4>${FACTIONS[c.faction].ico} ${c.kind === "relief" ? "🆘 Relief Appeal" : c.kind === "smuggle" ? "Smuggling Job" : "Supply Contract"}
          <span class="pill ${urgent ? "bad" : ""}">${left} cyc left</span></h4>
        <div class="desc">Deliver <b>${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name}</b> to <b>${dest.name}</b> for the ${FACTIONS[c.faction].name}.</div>
        <div class="hint">Reward: ${costString(c.reward)}</div>
        <div class="hint">${here ? (have ? "Ready to deliver." : `You hold ${fmt(S.res[c.commodity] || 0)}/${c.qty}.`) : `Travel to ${dest.name}.`}</div>
        <button class="btn btn-primary" ${here && have ? "" : "disabled"} onclick="fulfilContract('${c.id}')">Fulfil</button>
      </div>`;
    }).join("") : '<div class="hint">No active contracts. New ones are posted by the factions as cycles pass.</div>';

  const gateSteps = DISCLOSURE_GATES.filter(g => !(S.disc && S.disc[g.id])).map(g =>
    `<div class="card" style="border-color:var(--accent)"><h4>${g.icon} ${g.goal}</h4><div class="hint">🔓 ${g.reward}${g.fallbackTurn ? ` · or automatically by cycle ${g.fallbackTurn}` : ""}</div></div>`).join("");
  const tabSteps = (typeof TAB_LADDER !== "undefined" ? TAB_LADDER : []).filter(g => !(S.unlocked && S.unlocked[g.id])).map(g =>
    `<div class="card"><h4>🔓 ${tabLabel(g.id)}</h4><div class="hint">${g.blurb} — ${g.hint}</div></div>`).join("");
  const nextSteps = gateSteps + tabSteps;
  const nextStepsSection = nextSteps ? `<div class="section-title">🧭 Next Steps — unlock new features</div><div class="cards">${nextSteps}</div>` : "";

  // Milestones: a broader completionist checklist, shown as earned/locked chips
  const milestonesEarned = MILESTONES.filter(m => S.milestones && S.milestones[m.id]).length;
  const milestoneChips = MILESTONES.map(m => {
    const earnedTurn = S.milestones && S.milestones[m.id];
    return earnedTurn
      ? `<span class="pill good" title="${m.desc} — earned cycle ${earnedTurn}">${m.ico} ${m.name}</span>`
      : `<span class="pill" style="opacity:.5" title="${m.desc}">🔒 ${m.name}</span>`;
  }).join(" ");

  el.innerHTML = `<h2>🎯 Missions</h2>
    <div class="subtitle">Everything with an objective in one place: <b>time-bound contracts</b> race the clock, <b>career missions</b> unlock as you grow, and your <b>legacy goals</b> are the long game that wins it all.</div>
    ${nextStepsSection}
    <div class="section-title">📋 Contracts (time-bound)</div>
    <div class="cards">${contractCards}</div>
    <div class="section-title">🧭 Career Missions (long-term)</div>
    <div class="cards">${missionCards}</div>
    <div class="section-title">🏆 Your Legacy (win conditions)</div>
    <div class="cards"><div class="card">${goals}<div class="hint">Net worth: ${fmt(netWorth())} cr</div></div></div>
    <div class="section-title">🏅 Milestones <span class="hint">${milestonesEarned}/${MILESTONES.length}</span></div>
    <div class="card"><div style="display:flex;flex-wrap:wrap;gap:4px">${milestoneChips}</div></div>`;
}

/* ============================================================
   STELLAR FRONTIER — rendering: Bases, Colonies & Escort
   Fourth (and last tab-specific) slice of the rendering layer: the
   panel-render functions for the Bases tab (module construction,
   storage transfer, the base's own market stall, the base<->colony
   trade network controls) and the Colonies tab (founding, building,
   faction alignment, tax/deposit/withdraw). Convoy Escort's
   renderEscort() rides along in this same file too — it's the last
   render* function left in game.js by file position, with no closer
   thematic fit among the render slices already split out, same
   reasoning as bundling the Logistics Network into frontier.js.
   renderAll(), the master dispatcher that ties every render* function
   together, stays in game.js — it's the final piece of the rendering
   layer, extracted last alongside TABS/PERSISTENCE/INIT.

   Loaded after renderCombat.js, before game.js. S, subView, subTabBar,
   afterAction, saveGame and renderAll() still live in
   renderCombat.js/game.js at this point in the split — safe, since
   every function here is only CALLED later (by renderAll(), itself
   only ever called after a player action, once every script has
   finished loading), same pattern as every prior slice.
   ============================================================ */

"use strict";

/* ----- Bases ----- */
// a compact "Travel here" button for outpost/colony cards (or a "here" pill)
function cardTravelBtn(id) {
  if (id === S.location) return '<span class="pill good">◉ here</span>';
  const pl = PLANETS.find(p => p.id === id);
  if (!pl || !isVisible(pl)) return "";
  const fc = fuelCost(id);
  const can = S.res.fuel >= fc && !S.encounter && !S.interdiction && S.jail <= 0;
  return `<button class="btn btn-sm" ${can ? "" : "disabled"} title="Jump to ${pl.name} (⛽ ${fc})" onclick="travel('${id}')">Travel ▸ <span class="hint">⛽${fc}</span></button>`;
}
// what a colony can produce (icons only, deduped) — its built producers + recipe outputs
function colonyOutputs(col, planet) {
  const set = new Set();
  colonyBuildingList(planet).forEach(b => {
    if ((col.buildings[b.id] || 0) <= 0) return;
    if (b.produces) set.add(b.produces);
    if (b.recipe && b.recipe.out) set.add(b.recipe.out);
  });
  return Array.from(set);
}
function ensureTrade(b) { if (!b.trade || typeof b.trade !== "object") b.trade = { on: false, exp: {}, imp: {}, cols: {} }; b.trade.exp = b.trade.exp || {}; b.trade.imp = b.trade.imp || {}; b.trade.cols = b.trade.cols || {}; return b.trade; }
function toggleBaseTrade(pid) {
  const b = S.bases[pid]; if (!b) return;
  if (!(b.modules.warehouse || 0)) return toast("Build a Storage Depot first to run a trade route.", "bad");
  if (!Object.keys(S.colonies || {}).length) return toast("You need at least one colony to trade with.", "bad");
  const t = ensureTrade(b); t.on = !t.on;
  toast(t.on ? "Trade route enabled — pick what to ship per colony below." : "Trade route disabled.", t.on ? "good" : "");
  saveGame(); renderAll();
}
function setBaseTradeGood(pid, dir, c) {
  const b = S.bases[pid]; if (!b) return; const t = ensureTrade(b);
  const isExp = dir === "exp";
  const on = isExp ? baseExporting(b, c) : baseImporting(b, c);   // current EFFECTIVE direction
  if (on) {                                          // turn this direction off — the good is no longer traded that way
    if (isExp) t.exp[c] = false; else t.imp[c] = false;
  } else {                                           // turn it on, and disable the opposite so it can't loop
    if (isExp) { delete t.exp[c]; if (baseImportable(c)) t.imp[c] = false; }
    else       { delete t.imp[c]; t.exp[c] = false; }
  }
  saveGame(); renderBases();
}
function setBaseTradeColony(pid, cid) {
  const b = S.bases[pid]; if (!b) return; const t = ensureTrade(b);
  if (t.cols[cid] === false) delete t.cols[cid]; else t.cols[cid] = false;
  saveGame(); renderBases();
}
function renderBases() {
  const el = document.getElementById("panel-bases");
  const pid = S.location, planet = currentPlanet(), b = S.bases[pid];

  // Overview of every base you own (they run while you're away)
  const baseIds = Object.keys(S.bases);
  let overview;
  if (baseIds.length) {
    overview = baseIds.map(id => {
      const bb = S.bases[id], pl = PLANETS.find(p => p.id === id);
      const prod = baseModuleList(pl)
        .map(m => { const o = moduleOutput(pl, m, bb.modules[m.id] || 0); return o > 0 ? o + COM[m.produces].ico : ""; })
        .filter(Boolean).join(" ") || "—";
      const stored = Object.entries(bb.storage).filter(([, q]) => q > 0)
        .map(([c, q]) => q + COM[c].ico).join(" ") || "empty";
      return `<div class="card ${id === pid ? "owned" : ""}">
        <h4>${pl.name} ${id === pid ? '<span class="pill good">here</span>' : ""}</h4>
        <div class="hint">Storage ${baseStorageUsed(bb)}/${baseStorageCap(id)}</div>
        <div class="ship-stat"><span class="k">Produces/cycle</span><span class="v">${prod}</span></div>
        <div class="ship-stat"><span class="k">Stored</span></div><div style="font-size:12px;line-height:1.7">${stored}</div>
        <div class="row" style="margin-top:6px">${cardTravelBtn(id)}</div>
      </div>`;
    }).join("");
  } else {
    overview = '<div class="hint">You have no bases yet. Bases produce and store resources every cycle — even while you are light-years away.</div>';
  }

  // Current-planet management
  let here;
  if (!b) {
    const fMats = BASE_FOUNDATION_MATS;
    const fOk = S.res.credits >= BASE_FOUNDATION_COST && canAfford(fMats);
    here = `<div class="section-title">📍 ${planet.name}</div><div class="cards"><div class="card">
      <h4>🏗️ Establish a Base on ${planet.name}</h4>
      <div class="desc">Found a permanent outpost. Build farms, mines and depots that work automatically every cycle, and stockpile goods for later. Construction consumes materials from your hold.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(BASE_FOUNDATION_COST)} 💰 + ${matsString(fMats)}</span></div>
      <button class="btn btn-primary" ${fOk ? "" : "disabled"} onclick="buildBase()">Establish Base</button>
    </div></div>`;
  } else {
    const modCards = baseModuleList(planet).map(m => {
      const tier = b.modules[m.id] || 0, maxed = tier >= m.tiers;
      const cost = Math.round(m.baseCost * Math.pow(m.costMul, tier));
      const mats = moduleMats(m, tier + 1);
      const ok = S.res.credits >= cost && canAfford(mats);
      const dots = Array.from({ length: m.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
      const cur = m.storage ? (tier > 0 ? `+${tier * 250} storage` : "not built")
        : m.shipyard ? (tier > 0 ? `Tier ${tier} · ${tier} slipway${tier > 1 ? "s" : ""}` : "not built")
        : (tier > 0 ? `+${moduleOutput(planet, m, tier)} ${COM[m.produces].ico}/cycle` : "not built");
      const nxt = m.storage ? "+250 storage"
        : m.shipyard ? `Tier ${tier + 1} · ${tier + 1} slipway${tier + 1 > 1 ? "s" : ""}`
        : `+${moduleOutput(planet, m, tier + 1) - moduleOutput(planet, m, tier)} ${COM[m.produces].ico}/cycle`;
      return `<div class="card ${tier > 0 ? (maxed ? "maxed" : "owned") : ""}">
        <h4>${m.ico} ${m.name} <span class="tier-dots">${dots}</span></h4>
        <div class="desc">${m.desc}</div>
        <div class="hint">Current: ${cur}</div>
        ${maxed ? '<div class="pill good">◉ Fully built</div>'
          : `<div class="meta"><span class="hint">Next: ${nxt}</span><span class="cost">${fmt(cost)} 💰 + ${matsString(mats)}</span></div>
             <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="buildModule('${m.id}')">${tier > 0 ? "Upgrade" : "Build"} (Tier ${tier + 1})</button>`}
      </div>`;
    }).join("");
    // ===== Sub-tabs: Modules / Inventory / Trade =====
    const hasColonies = Object.keys(S.colonies || {}).length > 0;
    const BASE_VIEWS = [["modules", "🛠️ Modules"], ["inventory", "📦 Inventory"]];
    if (hasColonies) BASE_VIEWS.push(["trade", "🔄 Import/Export"]);   // trade routes appear once you have a colony to trade with
    const view = subView("bases", BASE_VIEWS);
    let body;
    if (view === "modules") {
      body = `<div class="cards">${modCards}</div>`;
    } else if (view === "inventory") {
      const ids = STORE_IDS.filter(c => (S.res[c] || 0) > 0 || (b.storage[c] || 0) > 0);
      const rows = ids.length ? ids.map(c => `<tr>
        <td>${COM[c].ico} ${COM[c].name} <span class="hint">@ ${fmt(sellPrice(pid, c))}</span></td>
        <td class="num">${fmt(S.res[c] || 0)}</td>
        <td class="num">${fmt(b.storage[c] || 0)}</td>
        <td><div class="trade-controls">
          <input class="qty" id="xfer-${c}" type="number" min="1" value="10" />
          <button class="btn btn-sm" onclick="depositQty('${c}')">Store ▸</button>
          <button class="btn btn-sm" onclick="withdrawQty('${c}')">◂ Take</button>
          <button class="btn btn-sm btn-good" title="Buy into the base at market (${fmt(buyPrice(pid, c))}/u)" onclick="baseBuyQty('${c}')">Buy</button>
          <button class="btn btn-sm btn-bad" title="Sell from the base at market (${fmt(sellPrice(pid, c))}/u)" onclick="baseSellQty('${c}')">Sell</button>
        </div></td></tr>`).join("")
        : '<tr><td colspan="4" class="hint">Nothing in your hold or this base yet.</td></tr>';
      body = `<div class="section-title">📦 Inventory (${baseStorageUsed(b)}/${baseStorageCap(pid)})</div>
        <div class="hint" style="margin-bottom:8px">Move goods between your ship and this base's stockpile.</div>
        <div class="row" style="margin-bottom:8px"><button class="btn btn-sm" onclick="storeAllCargo()">Store all cargo ▸</button></div>
        <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In base</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    } else {
      // ----- Import / Export -----
      const hasWarehouse = (b.modules.warehouse || 0) > 0;
      const cols = Object.entries(S.colonies || {});
      const t = (b.trade && typeof b.trade === "object") ? b.trade : { on: false, exp: {}, imp: {}, cols: {} };
      const lc = S.tradeLastCycle;
      const contrabandHeld = CARGO_IDS.filter(c => (b.storage[c] || 0) > 0 && isIllegalAt(c, pid));
      if (!hasWarehouse) {
        body = `<div class="card"><div class="hint">Build a 🏬 <b>Storage Depot</b> (Modules tab) to turn this base into a trade hub.</div></div>`;
      } else if (!cols.length) {
        body = `<div class="card"><div class="hint">Found a colony to trade with — your base will ship it raw materials and import its manufactured goods.</div></div>`;
      } else {
        // eligible commodities to offer as toggles
        const expGoods = STORE_IDS.filter(c => (b.storage[c] || 0) > 0 || cols.some(([, col]) => (col.orders[c] || 0) > 0));
        const impGoods = STORE_IDS.filter(baseImportable).filter(c => (b.storage[c] || 0) > 0 || cols.some(([, col]) => (col.storage[c] || 0) > 0));
        const chip = (dir, c) => {
          const on = dir === "imp" ? baseImporting(b, c) : baseExporting(b, c);
          const otherActive = !on && (dir === "imp" ? baseExporting(b, c) : baseImporting(b, c));   // locked by the opposite direction
          const title = on ? `Trading ${COM[c].name}`
            : otherActive ? `${dir === "imp" ? "Exporting" : "Importing"} ${COM[c].name} instead — click to ${dir === "imp" ? "import" : "export"} it (the other direction turns off)`
            : `Skipping ${COM[c].name}`;
          return `<button class="btn btn-sm ${t.on && on ? "btn-good" : ""}" ${t.on ? "" : "disabled"} title="${title}" onclick="setBaseTradeGood('${pid}','${dir}','${c}')">${COM[c].ico} ${COM[c].name} ${on ? "✓" : otherActive ? "⇄" : "✗"}</button>`;
        };
        const colRows = cols.map(([cid, col]) => {
          const cpl = PLANETS.find(p => p.id === cid), on = tradeColOk(b, cid), dist = worldDist(pid, cid);
          const needs = STORE_IDS.filter(c => (col.orders[c] || 0) > (col.storage[c] || 0)).map(c => COM[c].ico).join("") || "—";
          const offers = STORE_IDS.filter(c => baseImportable(c) && (col.storage[c] || 0) > colonyFinishedReserve(col, c) + (col.orders[c] || 0)).map(c => COM[c].ico).join("") || "—";
          return `<div class="ship-stat" style="align-items:center"><span class="k"><button class="btn btn-sm ${t.on && on ? "btn-good" : ""}" ${t.on ? "" : "disabled"} onclick="setBaseTradeColony('${pid}','${cid}')">${on ? "✓" : "✗"} ${cpl.name}</button> <span class="hint">${dist} ly${col.faction ? " · " + FACTIONS[col.faction].ico + " tariff" : ""}</span></span>
            <span class="v hint">needs ${needs} · offers ${offers}</span></div>`;
        }).join("");
        body = `<div class="card">
          <div class="hint" style="margin-bottom:6px">Each cycle this base ships the <b>raws you select</b> to fill colony orders, and imports the <b>finished goods you select</b> from colonies' surplus. A good flows <b>either in or out, never both</b> — picking one direction locks the other (shown as ⇄; click to flip). Amounts are automatic (colony need / excess) — you just pick what flows and with which colony. Freight scales with distance; aligned colonies add a tariff; contraband risks customs; pirates ambush convoys.</div>
          <button class="btn ${t.on ? "btn-bad" : "btn-primary"} btn-sm" onclick="toggleBaseTrade('${pid}')">${t.on ? "⏹ Disable route" : "🔄 Enable route"}</button>
          <div class="section-title" style="margin-top:10px">⛏️ Export to colonies ${t.on ? "" : '<span class="hint">(route off)</span>'}</div>
          <div class="row" style="flex-wrap:wrap;gap:6px">${expGoods.length ? expGoods.map(c => chip("exp", c)).join("") : '<span class="hint">No raws stocked or ordered yet.</span>'}</div>
          <div class="section-title" style="margin-top:10px">🏭 Import from colonies</div>
          <div class="row" style="flex-wrap:wrap;gap:6px">${impGoods.length ? impGoods.map(c => chip("imp", c)).join("") : '<span class="hint">No finished goods available yet.</span>'}</div>
          <div class="section-title" style="margin-top:10px">🌍 Colonies</div>
          ${colRows}
          ${t.on && lc ? `<div class="ship-stat" style="margin-top:10px"><span class="k">Last cycle net</span><span class="v" style="color:${lc.net >= 0 ? "var(--good)" : "var(--bad)"}">${lc.net >= 0 ? "+" : ""}${fmt(lc.net)} cr</span></div>
            <div class="ship-stat"><span class="k">Freight/tariffs</span><span class="v">${fmt(lc.freight)} cr</span></div>
            ${Object.keys(lc.imp || {}).length ? `<div class="ship-stat"><span class="k">Imported</span><span class="v">${Object.entries(lc.imp).map(([c, q]) => q + COM[c].ico).join(" ")}</span></div>` : ""}
            ${Object.keys(lc.seized || {}).length ? `<div class="ship-stat"><span class="k" style="color:var(--bad)">🚔 Seized</span><span class="v">${Object.entries(lc.seized).map(([c, q]) => q + COM[c].ico).join(" ")}</span></div>` : ""}` : ""}
          ${typeof S.tradeNet === "number" && S.tradeNet !== 0 ? `<div class="ship-stat"><span class="k">Lifetime balance</span><span class="v" style="color:${S.tradeNet >= 0 ? "var(--good)" : "var(--bad)"}">${S.tradeNet >= 0 ? "+" : ""}${fmt(S.tradeNet)} cr</span></div>` : ""}
          ${contrabandHeld.length ? `<div class="hint" style="color:var(--warn);margin-top:6px">⚠️ Contraband in stock (${contrabandHeld.map(c => COM[c].ico).join(" ")}) — routing it risks customs seizure.</div>` : ""}
        </div>`;
      }
    }
    here = `<div class="section-title">📍 ${planet.name}</div>
      ${subTabBar("bases", BASE_VIEWS)}
      ${!hasColonies ? `<div class="hint" style="margin:6px 0">🔄 Found a colony to open <b>Import/Export</b> trade routes from this base.</div>` : ""}
      ${body}`;
  }

  el.innerHTML = `<h2>Bases</h2>
    <div class="subtitle">Build outposts across the galaxy. Their farms, mines and depots produce and store resources automatically every cycle — even while you travel.</div>
    <div class="section-title">🌐 Your Outposts</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

/* ----- Colonies ----- */
/* a building counts as a pausable "process" if it produces or refines anything */
function buildingPausable(b) { return !!(b.recipe || b.produces || ["lab", "datacenter", "scrubber"].includes(b.id)); }
function toggleColonyProcess(bid) {
  const col = S.colonies[S.location]; if (!col) return;
  if (!(col.buildings[bid] > 0)) return toast("That process isn't built here.", "bad");
  if (!col.idle) col.idle = {};
  col.idle[bid] = !col.idle[bid];
  const b = colonyBuildingList(currentPlanet()).find(x => x.id === bid) || { name: bid, ico: "" };
  log(`${col.idle[bid] ? "⏸️ Paused" : "▶️ Resumed"} ${b.ico} ${b.name} on <span class="c">${currentPlanet().name}</span>.`, "");
  toast(`${b.name} ${col.idle[bid] ? "paused" : "resumed"}`, col.idle[bid] ? "" : "good");
  afterAction();
}
/* ---------- Colony interface disclosure ----------
   Building categories reveal as the colony matures, so a fresh colony shows
   only survival/economy basics, industry opens once you've learned to
   manufacture, and civic/logistics arrive as the colony grows. */
const COLONY_BUILD_CAT = {
  habitat: "survival", farm: "survival", solar: "survival", scrubber: "survival",
  biomass_gen: "industry", gas_turbine: "industry", reactor: "industry", smelter: "industry",
  chem_plant: "industry", fuelrefinery: "industry", foundry: "industry", fabricator: "industry", factory: "industry",
  machine_works: "industry", luxury_atelier: "industry", pharma_lab: "industry",
  arms_factory: "industry", drone_works: "industry", antimatter_forge: "industry",
  lab: "civic", datacenter: "civic", spaceport: "civic", garrison: "civic",
};
const COLONY_CATS = [["survival", "🏠 Survival & Economy"], ["industry", "🏭 Industry"], ["civic", "🏛️ Civic & Logistics"]];
function colonyBuildCat(b) { return b.id.indexOf("ext_") === 0 ? "survival" : (COLONY_BUILD_CAT[b.id] || "survival"); }
function colonyCatRevealed(cat, col) {
  if (cat === "survival" || S.showAllTabs) return true;
  if (cat === "industry") return !!(S.disc && S.disc.advMarkets) || col.pop >= 8 || S.turn >= 15;
  if (cat === "civic") return Object.keys(S.colonies || {}).length >= 2 || col.pop >= 10 || S.turn >= 25;
  return true;
}
function colonyCatHint(cat) {
  if (cat === "industry") return "unlocks once you manufacture your first Medicine (or the colony grows to 8k)";
  if (cat === "civic") return "unlocks as the colony grows (10k pop), or once you run a second colony";
  return "";
}
// faction alignment is shown once it's within reach (or already taken)
function colonyFactionRevealed(col) {
  if (col.faction || S.showAllTabs) return true;
  if (Object.keys(S.colonies || {}).length >= 2 || S.turn >= 20) return true;
  return Object.values(FACTIONS).some((_, i) => (S.rep[Object.keys(FACTIONS)[i]] || 0) >= ALIGN_REP_REQ - 5);
}
function colonyHealthPill(col) {
  const h = col.happiness;
  return h >= 70 ? '<span class="pill good">thriving</span>'
    : h >= 45 ? '<span class="pill">stable</span>'
    : '<span class="pill bad">unrest</span>';
}
function renderColonies() {
  const el = document.getElementById("panel-colonies");
  const pid = S.location, planet = currentPlanet(), col = S.colonies[pid];

  const ids = Object.keys(S.colonies);
  let overview;
  if (ids.length) {
    overview = ids.map(id => {
      const c = S.colonies[id], pl = PLANETS.find(p => p.id === id);
      const outs = colonyOutputs(c, pl);
      return `<div class="card ${id === pid ? "owned" : ""}">
        <h4>${pl.name} ${c.faction ? `<span class="pill" title="${FACTIONS[c.faction].name}">${FACTIONS[c.faction].ico}</span>` : ""} ${id === pid ? '<span class="pill good">here</span>' : ""} ${colonyHealthPill(c)}</h4>
        <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(c.pop)}k</span></div>
        <div class="ship-stat"><span class="k">😊 Happiness</span><span class="v">${c.happiness}%</span></div>
        <div class="ship-stat"><span class="k">🏭/🔬 Dev</span><span class="v">Ind ${effIndustry(pl)} · Tech ${effTech(pl)}</span></div>
        <div class="ship-stat"><span class="k">💰 Tax income</span><span class="v">+${fmt(colonyTaxIncome(c))}/cyc</span></div>
        <div class="ship-stat"><span class="k">🏭 Produces</span><span class="v">${outs.length ? outs.map(x => `<span title="${COM[x].name}">${COM[x].ico}</span>`).join(" ") : "—"}</span></div>
        <div class="row" style="margin-top:6px">${cardTravelBtn(id)}</div>
      </div>`;
    }).join("");
  } else {
    overview = '<div class="hint">You govern no colonies yet. Find a <span class="pill good">colonizable</span> world (e.g. Aurora, Cinder, or one you discover by survey), travel there and found one.</div>';
  }

  let here;
  if (!canColonize()) {
    const reqs = TECHS.find(t => t.id === "colonial").req.map(r => `${S.techs[r] ? "✅" : "⬜"} ${TECHS.find(x => x.id === r).name}`).join(" · ");
    here = `<div class="section-title">🔒 Colonization Locked</div><div class="cards"><div class="card">
      <h4>🏙️ Research Colonial Charter to begin</h4>
      <div class="desc">Colonies are the next chapter of your story. Once you've mastered trade and politics, the Colonial Charter grants the authority — and the deep-space sensors — to settle the frontier. Frontier worlds marked <span class="pill good">colonizable</span> are already visible on the Galaxy map; survey to find more once unlocked.</div>
      <div class="meta"><span class="hint">Prerequisites</span><span class="cost">${reqs}</span></div>
      <div class="hint">Find it in the 🔬 Research tab (cost: 120 tech).</div>
    </div></div>`;
  } else if (!planet.colonizable) {
    here = `<div class="section-title">📍 ${planet.name}</div><div class="hint">${planet.name} is an established world and cannot be colonized — but you can still build an outpost <b>Base</b> here. Colonize the frontier worlds instead.</div>`;
  } else if (!col) {
    const ok = S.res.credits >= COLONY_FOUNDATION_COST && canAfford(COLONY_FOUNDATION_MATS);
    here = `<div class="section-title">📍 ${planet.name}</div><div class="cards"><div class="card">
      <h4>🌍 Found a Colony on ${planet.name}</h4>
      <div class="desc">Settle this world. Build housing, farms, factories and labs; feed and supply your people to grow the population and raise the planet's industry & tech. Tax your citizens for steady income.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(COLONY_FOUNDATION_COST)} 💰 + ${matsString(COLONY_FOUNDATION_MATS)}</span></div>
      <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="colonize()">Found Colony</button>
    </div></div>`;
  } else {
    const housing = colonyHousing(col, planet);
    const fedNeed = col.pop, fedHave = col.storage[COLONY_FOOD] || 0;
    const granaryBuffer = Math.floor(fedHave / GRANARY_BUFFER_CYCLES);
    const workforceMult = colonyWorkforceMult(col), automationMult = colonyAutomationMult(planet), unrestMult = colonyUnrestMult(col);
    const govCard = `<div class="card">
      <h4>🏛️ ${planet.name} Colony ${colonyHealthPill(col)}</h4>
      <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(col.pop)}k / ${fmt(housing)}k</span></div>
      <div class="bar"><span style="width:${Math.min(100, col.pop / housing * 100)}%"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">😊 Happiness</span><span class="v">${col.happiness}%</span></div>
      <div class="bar"><span style="width:${col.happiness}%;background:${col.happiness>=60?'var(--good)':col.happiness>=35?'var(--warn)':'var(--bad)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🌾 Food / cycle</span><span class="v" style="color:${fedHave>=fedNeed?'var(--good)':'var(--bad)'}">${fmt(fedHave)} stored · need ${fmt(fedNeed)}${granaryBuffer > 0 ? ` <span class="hint">(+${fmt(granaryBuffer)} growth buffer from stockpile)</span>` : ""}</span></div>
      <div class="ship-stat"><span class="k">☁️ Pollution</span><span class="v" style="color:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}">${Math.round(pollutionOf(planet.id))}</span></div>
      <div class="bar"><span style="width:${pollutionOf(planet.id)}%;background:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🏭 Industry</span><span class="v">${effIndustry(planet)}</span></div>
      <div class="ship-stat"><span class="k">🔬 Tech</span><span class="v">${effTech(planet)}</span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">👷 Workforce</span><span class="v" style="color:${workforceMult>=1?'var(--good)':workforceMult>=0.75?'var(--warn)':'var(--bad)'}">${Math.round(workforceMult*100)}% <span class="hint">(${fmt(col.pop)} pop / ${fmt(colonyLaborNeeded(col)*LABOR_PER_TIER)} needed)</span></span></div>
      <div class="ship-stat"><span class="k">🤖 Automation</span><span class="v">+${Math.round((automationMult-1)*100)}% <span class="hint">industry chain, Tech ${effTech(planet)}</span></span></div>
      ${unrestMult < 1 ? `<div class="ship-stat"><span class="k">😠 Unrest penalty</span><span class="v" style="color:var(--bad)">−${Math.round((1-unrestMult)*100)}% output</span></div>` : ""}
      <div class="ship-stat"><span class="k">🛡️ Defense</span><span class="v">${colonyDefense(col) ? "Level " + colonyDefense(col) : '<span style="color:var(--bad)">undefended</span>'}</span></div>
      ${(col.unrest || 0) >= 2 ? `<div class="ship-stat"><span class="k">⚠️ Unrest</span><span class="v" style="color:var(--bad)">secession risk — improve happiness!</span></div>` : ""}
      <div class="ship-stat" style="margin-top:8px"><span class="k">💰 Tax rate</span><span class="v">${col.tax}% → +${fmt(colonyTaxIncome(col))}/cyc</span></div>
      <div class="row"><button class="btn btn-sm" onclick="setTax(-5)">− Tax</button><button class="btn btn-sm" onclick="setTax(5)">+ Tax</button>
        <span class="hint">High tax lowers happiness.</span></div>
    </div>`;
    const buildCard = (b) => {
      const tier = col.buildings[b.id] || 0, maxed = tier >= b.tiers;
      const cost = Math.round(b.baseCost * Math.pow(b.costMul, tier));
      const mats = colonyBuildingMats(b, tier + 1);
      const locked = b.req && !S.techs[b.req];
      const ok = !locked && S.res.credits >= cost && canAfford(mats);
      const dots = Array.from({ length: b.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
      const paused = !!(col.idle && col.idle[b.id]);
      const pauseCtl = (tier > 0 && buildingPausable(b))
        ? `<button class="btn btn-sm ${paused ? "btn-good" : "btn-bad"}" style="margin-top:4px" title="${paused ? "Resume this process — it runs again next cycle" : "Stop this process — it consumes no inputs and produces nothing until resumed (strategy change, no demolition)"}" onclick="toggleColonyProcess('${b.id}')">${paused ? "▶️ Resume" : "⏸️ Pause"}</button>`
        : "";
      return `<div class="card ${paused ? "" : tier > 0 ? (maxed ? "maxed" : "owned") : ""}" ${paused ? 'style="opacity:.7"' : ""}>
        <h4>${b.ico} ${b.name} <span class="tier-dots">${dots}</span> ${paused ? '<span class="pill bad">⏸️ paused</span>' : ""}</h4>
        <div class="desc">${b.desc}</div>
        ${b.recipe ? `<div class="hint">⚙️ ${colonyRecipeStr(b.recipe)}</div>` : ""}
        ${maxed ? '<div class="pill good">◉ Fully built</div>'
          : locked ? `<div class="pill bad">🔒 needs ${(TECHS.find(t => t.id === b.req) || {}).name || b.req}</div>`
          : `<div class="meta"><span class="hint">Tier ${tier + 1}</span><span class="cost">${fmt(cost)} 💰 + ${matsString(mats)}</span></div>
             <button class="btn btn-primary" ${ok ? "" : "disabled"} onclick="buildColonyBuilding('${b.id}')">${tier > 0 ? "Upgrade" : "Build"}</button>`}
        ${pauseCtl}
      </div>`;
    };
    const buildCards = COLONY_CATS.map(([cat, label]) => {
      const list = colonyBuildingList(planet).filter(b => colonyBuildCat(b) === cat);
      if (!list.length) return "";
      const revealed = colonyCatRevealed(cat, col);
      const shown = list.filter(b => revealed || (col.buildings[b.id] || 0) > 0);   // always show what's already built
      if (!shown.length) return `<div class="hint" style="grid-column:1/-1">🔒 <b>${label}</b> — ${colonyCatHint(cat)}.</div>`;
      return `<div class="section-title" style="grid-column:1/-1">${label}${!revealed ? ' <span class="hint">(more unlocks later)</span>' : ""}</div>` + shown.map(buildCard).join("");
    }).join("");
    const sids = STORE_IDS.filter(c => (S.res[c] || 0) > 0 || (col.storage[c] || 0) > 0);
    const rows = sids.length ? sids.map(c => `<tr>
      <td>${COM[c].ico} ${COM[c].name}</td>
      <td class="num">${fmt(S.res[c] || 0)}</td><td class="num">${fmt(col.storage[c] || 0)}</td>
      <td><div class="trade-controls">
        <input class="qty" id="col-${c}" type="number" min="1" value="10" />
        <button class="btn btn-sm" onclick="colonyDeposit('${c}')">Supply ▸</button>
        <button class="btn btn-sm" onclick="colonyWithdraw('${c}')">◂ Take</button>
      </div></td></tr>`).join("")
      : '<tr><td colspan="4" class="hint">Nothing in your hold or this colony yet.</td></tr>';
    const sp = spaceportTier(col);
    let logi;
    if (!sp) {
      logi = `<div class="section-title">🚚 Logistics <span class="pill bad">no spaceport</span></div>
        <div class="hint">Build a 🛰️ Spaceport to automate supply: set target stock levels and each cycle the network redistributes surplus from your other colonies (free), then imports the rest from market. No more ferrying food by hand.</div>`;
    } else {
      const fee = Math.round(logisticsFee(col) * 100);
      // orderable here: the staples, anything stored or already ordered, and the
      // inputs of every industry building standing in this colony — so a factory
      // world can order ore without you ferrying the first batch by hand
      const orderable = (() => {
        const set = new Set(COLONY_SUPPLY);
        Object.entries(col.orders || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
        Object.entries(col.storage || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
        colonyBuildingList(planet).forEach(b => {
          if ((col.buildings[b.id] || 0) > 0 && b.recipe) Object.keys(b.recipe.in).forEach(i => set.add(i));
        });
        return STORE_IDS.filter(c2 => set.has(c2));
      })();
      const orderRows = orderable.map(c => {
        const tgt = (col.orders && col.orders[c]) || 0;
        return `<tr><td>${COM[c].ico} ${COM[c].name}</td><td class="num">${fmt(col.storage[c] || 0)}</td>
          <td><div class="trade-controls"><input class="qty" id="auto-${c}" type="number" min="0" value="${tgt}" />
          <button class="btn btn-sm" onclick="setOrder('${c}')">Set auto</button></div></td></tr>`;
      }).join("");
      logi = `<div class="section-title">🚚 Logistics — Spaceport ${sp} · fee ${fee}% · ${logisticsCap(col)}/cycle</div>
        <div class="hint" style="margin-bottom:8px">Each cycle the network keeps these topped to target: <b>first from surplus on your other spaceport colonies (free)</b> — every spaceport colony donates anything above its own targets automatically — then bought from market at +${fee}%. Set a target to 0 to stop importing it. Rows cover staples plus your industry's inputs.</div>
        <table><thead><tr><th>Commodity</th><th class="num">In colony</th><th>Keep stocked to</th></tr></thead><tbody>${orderRows}</tbody></table>`;
    }
    // ---- faction diplomacy card (Overview tab) ----
    let factionCard;
    if (col.faction) {
      const F = FACTIONS[col.faction];
      factionCard = `<div class="card owned">
        <h4>${F.ico} Aligned — ${F.name}</h4>
        <div class="desc">${planet.name} flies ${F.name} colors: their merchants trade here and their patrols watch the sky.</div>
        <div class="ship-stat"><span class="k">💰 Commerce</span><span class="v">tax +25% · exports +15% · import fee −${col.faction === "frontier" ? 15 : 10}pp</span></div>
        <div class="ship-stat"><span class="k">🛡️ Support</span><span class="v">+${colonyFactionDefenseBonus(col)} defense · +6 happiness</span></div>
        <div class="ship-stat"><span class="k">${F.ico} Perk</span><span class="v">${FACTION_COLONY_PERKS[col.faction]}</span></div>
        <div class="ship-stat"><span class="k">🤝 Standing</span><span class="v">+1 ${F.name} rep / 5 cycles</span></div>
        <button class="btn btn-sm" style="margin-top:8px" onclick="colonyIndependence()">🏳️ Declare independence</button>
        <div class="hint">Leaving costs −10 rep with the ${F.name}, +1 unrest and −8 happiness.</div>
      </div>`;
    } else {
      const fRows = Object.entries(FACTIONS).map(([fid, F]) => {
        const rep = Math.round(S.rep[fid] || 0);
        const ok = rep >= ALIGN_REP_REQ && (S.res.influence || 0) >= ALIGN_COST_INF && col.happiness >= 40;
        const why = rep < ALIGN_REP_REQ ? `rep ${rep}/${ALIGN_REP_REQ}` : (S.res.influence || 0) < ALIGN_COST_INF ? `need ${ALIGN_COST_INF}⚖ influence` : col.happiness < 40 ? "happiness 40+ needed" : `rep ${rep}`;
        return `<div class="meta"><span>${F.ico} <b style="color:${F.color}">${F.name}</b><br><span class="hint">${FACTION_COLONY_PERKS[fid]}</span></span>
          <span style="text-align:right"><span class="hint">${why}</span><br><button class="btn btn-sm" ${ok ? "" : "disabled"} onclick="alignColony('${fid}')">Join</button></span></div>`;
      }).join("");
      factionCard = colonyFactionRevealed(col) ? `<div class="card">
        <h4>🤝 Faction Alignment <span class="pill">independent</span></h4>
        <div class="desc">Petition a great faction to charter ${planet.name}. Their trade network lifts tax income and export prices and cuts import fees; their patrols bolster defense; their backing steadies morale — and each loyal cycle earns their respect. Costs ${ALIGN_COST_INF} ⚖ influence; rival blocs take offense (−3 rep).</div>
        ${fRows}</div>`
        : `<div class="card"><h4>🤝 Faction Alignment</h4><div class="hint">Earn a faction's reputation (≥${ALIGN_REP_REQ}) to petition them to charter this colony for trade & protection.</div></div>`;
    }
    // ---- sub-tabs: Overview / Buildings / Supplies / Spaceport ----
    const views = [["overview", "📊 Overview"], ["buildings", "🏗️ Buildings"], ["supplies", "📦 Supplies"]];
    if (colonyCatRevealed("civic", col) || spaceportTier(col) > 0) views.push(["spaceport", "🛰️ Spaceport"]);
    const colonyView = subView("colonies", views);
    const subBar = subTabBar("colonies", views);
    let body;
    if (colonyView === "buildings") {
      body = `<div class="cards">${buildCards}</div>`;
    } else if (colonyView === "supplies") {
      body = `<div class="section-title">📦 Supplies (${colonyStorageUsed(col)}/${colonyStorageCap(col, planet)}) — feed & develop your colony</div>
        <table><thead><tr><th>Commodity</th><th class="num">In ship</th><th class="num">In colony</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    } else if (colonyView === "spaceport") {
      const expNote = sp ? `<div class="hint" style="margin-top:8px">🛰️ The spaceport also auto-exports surplus finished goods each cycle (throughput ${sp * 6})${col.faction ? `, and ${FACTIONS[col.faction].name} merchants pay a 15% premium` : ""}.</div>` : "";
      body = `${logi}${expNote}`;
    } else {
      body = `<div class="cards">${govCard}${factionCard}</div>`;
    }
    here = `<div class="section-title">🏛️ Govern — ${planet.name} ${col.faction ? `<span class="pill" title="${FACTIONS[col.faction].name}">${FACTIONS[col.faction].ico} ${FACTIONS[col.faction].name}</span>` : ""}</div>
      ${subBar}${body}`;
  }

  el.innerHTML = `<h2>Colonies</h2>
    <div class="subtitle">Found colonies on frontier worlds and grow them: build housing, farms, factories and labs, feed your people, set taxes, and watch the planet's industry & tech climb. Colonies live and grow every cycle — even while you're away.</div>
    <div class="section-title">🌍 Your Colonies</div>
    <div class="cards">${overview}</div>
    ${here}`;
}

/* ----- Escort ----- */
function renderEscort() {
  const el = document.getElementById("panel-escort"); if (!el) return;
  const e = ensureEscort();
  const hullBar = (h, m) => { const pct = Math.max(0, Math.round(h / m * 100)); const col = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)"; return `<div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`; };
  if (!e.active) {
    if (!e.offers || !e.offers.length) refreshEscortOffers();
    const cards = (e.offers || []).map((m, i) => {
      const dn = PLANETS.find(p => p.id === m.to); const tl = m.threat >= 0.7 ? "🔴 High" : m.threat >= 0.45 ? "🟠 Moderate" : "🟢 Low";
      const oFrom = PLANETS.find(p => p.id === m.from);
      if (m.pirate) {
        const b = bandById(m.pirate);
        return `<div class="card" style="border-color:var(--gold)"><h4>🏴‍☠️ Smuggling run to ${dn ? dn.name : "?"}</h4>
          <div class="hint">${b ? bandTagMark(b) + m.pirateIco + " <b>" + b.name + "</b>" : "A crew"} wants you to run their ${m.contraband.ico} <b>${m.contraband.name}</b> — quietly.</div>
          <div class="ship-stat"><span class="k">Distance</span><span class="v">${m.dist} ly · ${m.legs} legs</span></div>
          <div class="ship-stat"><span class="k">Threat</span><span class="v">${tl} (${Math.round(m.threat * 100)}%) <span class="hint">incl. patrols</span></span></div>
          <div class="ship-stat"><span class="k">Deadline</span><span class="v">${m.cycleBudget} cycles <span class="hint">${escortUrgencyLabel(m.urgency != null ? m.urgency : 4)}</span></span></div>
          <div class="ship-stat"><span class="k">Pay</span><span class="v" style="color:var(--gold)">${fmt(m.reward)} cr<span class="hint"> +${fmt(m.bonus)} flawless</span></span></div>
          <div class="ship-stat"><span class="k">On delivery</span><span class="v">${b ? b.name + " +" + m.repBand : "standing"} · +${m.dread} Dread</span></div>
          <div class="ship-stat"><span class="k">Risk</span><span class="v" style="color:var(--bad)">+${m.heat} Wanted · ${dn ? dn.name + " authorities anger" : "law anger"}</span></div>
          <div class="hint">Illegal cargo: fat pay and deep standing with the crew, but you'll take heat and the destination's law won't forget. Bail and you'll burn the crew's trust.</div>
          <button class="btn btn-primary" onclick="acceptEscort(${i})">Take the job</button></div>`;
      }
      return `<div class="card"><h4>🛡️ Convoy to ${dn ? dn.name : "?"}</h4>
        <div class="ship-stat"><span class="k">Distance</span><span class="v">${m.dist} ly · ${m.legs} legs</span></div>
        <div class="ship-stat"><span class="k">Threat</span><span class="v">${tl} (${Math.round(m.threat * 100)}%)</span></div>
        <div class="ship-stat"><span class="k">Deadline</span><span class="v">${m.cycleBudget} cycles <span class="hint">${escortUrgencyLabel(m.urgency != null ? m.urgency : 4)}</span></span></div>
        <div class="ship-stat"><span class="k">Payload</span><span class="v">${fmt(m.payload)} cr cargo</span></div>
        <div class="ship-stat"><span class="k">Reward</span><span class="v" style="color:var(--gold)">${fmt(m.reward)} cr<span class="hint"> +${fmt(m.bonus)} flawless</span></span></div>
        <div class="hint">Threat tracks pirate activity at ${oFrom ? oFrom.name : "origin"} &amp; ${dn ? dn.name : "dest"} — clear them in the ⚔️ Raider tab before you set out to lower it (but the clock runs).</div>
        <button class="btn btn-primary" onclick="acceptEscort(${i})">Accept escort</button></div>`;
    }).join("");
    const rk = escortRank(), nx = escortNextRank();
    const guild = `<div class="ship-stat"><span class="k">🎖️ Guild rank</span><span class="v"><b>${rk.name}</b> <span class="hint">${Math.round((rk.mult - 1) * 100)}% pay · ${rk.escorts} escorts${nx ? ` · ${Math.max(0, nx.rep - (S.escortRep || 0))} rep to ${nx.name}` : " · top rank"}</span></span></div>`;
    el.innerHTML = `<div class="panel-head"><h2>🛡️ Convoy Escort</h2>
      <div class="subtitle">Take a contract to shepherd a convoy across the lanes. You command the whole fleet — <b>pool every ship's firepower</b> and split it across the attackers you choose. Keep the freighters alive to earn the full fee. Each leg is a cycle on the clock and burns fuel (about a normal one-way jump, +15%, split over the legs).</div></div>
      <div class="card">${guild}</div>
      <div class="row" style="margin:8px 0"><button class="btn btn-sm" onclick="refreshEscortOffers()">↻ New postings</button></div>
      <div class="cards">${cards || '<div class="card"><div class="hint">No convoys need an escort from here right now — try another port.</div></div>'}</div>`;
    return;
  }
  const m = e.mission; const dn = PLANETS.find(p => p.id === m.to);
  const totalFr = e.fleet.filter(s => s.role === "freighter").length;
  const aliveFr = e.fleet.filter(s => s.role === "freighter" && s.alive).length;
  const F = escortFirepower();
  // who is being targeted this round (telegraphed intent)
  const threatenedBy = {};
  if (escortInCombat()) e.wave.foes.forEach(f => { if (f.hp > 0 && f.intent != null && f.intent >= 0) (threatenedBy[f.intent] = threatenedBy[f.intent] || []).push(escortFoeRole(f).ico); });
  // fleet roster
  const roster = e.fleet.map((sh, fi) => {
    const alive = escShipAlive(sh), h = escShipHull(sh), hm = escShipHullMax(sh);
    const fp = Math.round(escShipFP(sh));
    let tag = sh.role === "flagship" ? "flagship" : sh.role === "escort" ? "escort" : "cargo";
    if (sh.role === "flagship" && alive) { const fw = WEAPONS[escortFlagWeapon()]; tag += ` · ${fw.ico}${Object.keys(fw.ammo).length ? " " + matsString(fw.ammo) : ""}`; }
    const inc = threatenedBy[fi];
    const mark = alive && inc ? ` <span title="incoming fire from ${inc.length}" style="color:var(--bad)">⤳${inc.join("")}</span>` : "";
    const _prof = stanceProfile(sh), _st = VESSEL_STANCES[sh.stance || "balanced"], _lv = shipFit(sh)[sh.stance || "balanced"] || 0;
    const obadge = alive ? ` <span class="hint">${_st.ico}${_lv ? " Lv" + _lv : ""}${_prof.atk ? " 🔥+" + Math.round(_prof.atk * 100) + "%" : ""}${_prof.mit ? " 🛡️" + Math.round(_prof.mit * 100) + "%" : ""}</span>` : "";
    return `<div class="ship-stat" style="align-items:center;${alive ? "" : "opacity:.45"}">
      <span class="k">${sh.ico} ${sh.name} <span class="hint">${tag}</span>${mark}${obadge}</span>
      <span class="v" style="min-width:120px">${alive ? hullBar(h, hm) + `<span class="hint">${h}/${hm} · 🔥${fp}</span>` : '<span style="color:var(--bad)">— lost —</span>'}</span></div>`;
  }).join("");
  const postBtns = Object.entries(ESCORT_POSTURES).map(([k, p]) =>
    `<button class="btn btn-sm ${e.posture === k ? "btn-primary" : ""}" title="${p.hint}" onclick="setEscortPosture('${k}')">${p.label}</button>`).join(" ");
  let combat = "";
  if (escortInCombat()) {
    const tgts = (e.targets || []).filter(i => e.wave.foes[i] && e.wave.foes[i].hp > 0);
    const nT = tgts.length || escortAliveFoes().length;
    const per = nT ? Math.round(F / nT) : F;
    const foeCards = e.wave.foes.map((f, i) => {
      if (f.hp <= 0) return `<div class="card" style="opacity:.4"><h4>${f.ico} ${f.name}</h4><div class="hint">destroyed</div></div>`;
      const sel = (e.targets || []).includes(i);
      const role = escortFoeRole(f);
      const aim = (f.intent != null && f.intent >= 0 && e.fleet[f.intent]) ? `${e.fleet[f.intent].ico} ${e.fleet[f.intent].name}` : "—";
      const ab = f.ability && ESCORT_BOSS_ABILITIES[f.ability] ? ` · <span style="color:var(--warn)">${ESCORT_BOSS_ABILITIES[f.ability].ico} ${ESCORT_BOSS_ABILITIES[f.ability].name}</span>` : "";
      const subs = `🚀 ${escortFoeCrippled(f) ? '<span style="color:var(--good)">crippled</span>' : `${f.eng}/${f.engMax}`}`
        + (((f.dmgMul || 1) < 1) ? ` · 🔫 −${Math.round((1 - f.dmgMul) * 100)}%` : "")
        + (((f.vuln || 1) > 1) ? ` · 🛡️ +${Math.round((f.vuln - 1) * 100)}% dmg taken` : "");
      const haul = Object.keys(f.cargo || {}).length ? ` · 📦 ${Object.keys(f.cargo).map(c => COM[c].ico).join("")}` : "";
      return `<div class="card" style="${sel ? "border-color:var(--accent)" : ""}"><h4>${f.ico} ${f.name}</h4>
        <div class="hint">${role.ico} ${role.name} · aiming at <b>${aim}</b>${ab}</div>
        ${hullBar(f.hp, f.maxhp)}<div class="hint">${f.hp}/${f.maxhp} hull · ⚔️ ${Math.round(f.dmg * (f.dmgMul || 1))}/hit · ${subs}</div>
        <div class="hint">bounty ${fmt((f.bounty || 0) + (f.credits || 0))} cr${haul}</div>
        <div class="row"><button class="btn btn-sm ${sel ? "btn-good" : ""}" onclick="escortToggleTarget(${i})">${sel ? "✓ Targeted" : "Target"}</button>
        <button class="btn btn-sm" onclick="escortFocus(${i})">Focus</button></div></div>`;
    }).join("");
    const tgtBtns = Object.entries(COMBAT_TARGETS).map(([k, t]) =>
      `<button class="btn btn-sm ${(e.fireTarget || "hull") === k ? "btn-primary" : ""}" title="${t.hint}" onclick="setEscortTarget('${k}')">${t.ico} ${t.name}</button>`).join(" ");
    const canRun = escortCanBreakOff();
    const fw = WEAPONS[escortFlagWeapon()];
    combat = `<div class="card"><h4>🔥 Fire Control — round ${e.wave.round}</h4>
      <div class="hint">Pooled fleet firepower <b>${fmt(F)}</b> splits equally across your targets: <b>${fmt(per)}</b> each to <b>${nT}</b> ${nT === 1 ? "target" : "targets"}${tgts.length ? "" : " (all, none picked)"}. Pick what to hit on every target — <b>${COMBAT_TARGETS.hull.ico} Hull</b> kills fastest, while <b>${COMBAT_TARGETS.weapons.ico} Weapons</b>/<b>${COMBAT_TARGETS.defense.ico} Defenses</b>/<b>${COMBAT_TARGETS.engines.ico} Engines</b> deal half damage but blunt fire, strip armor, or cripple drives. <b>Cripple every attacker's engines</b> and the convoy can break off and run. Destroyed foes drop their bounty &amp; cargo. Your flagship spends <b>${fw.ico} ${fw.name}</b> ammo per salvo${Object.keys(fw.ammo).length ? ` (${matsString(fw.ammo)})` : " (free)"}.</div>
      <div class="row" style="margin:6px 0"><span class="hint">Target system:</span> ${tgtBtns}</div>
      ${e.pendingRedeploy ? '<div class="hint" style="color:var(--warn)">⚠️ Re-rigging under fire — you must brace this round (the attackers get a free pass).</div>' : ""}
      <div class="row" style="margin:8px 0">
        ${e.pendingRedeploy
          ? `<button class="btn btn-primary" onclick="escortBraceRound()">🛡️ Brace (end round)</button>`
          : `<button class="btn btn-primary" onclick="escortFire()">🔥 Open fire</button>`}
        <button class="btn btn-sm ${canRun ? "btn-good" : ""}" ${canRun ? "" : "disabled"} title="${canRun ? "Every attacker's drive is crippled — slip away and continue" : "Cripple every attacker's 🚀 engines to break off"}" onclick="escortBreakOff()">🚀 Break off &amp; run</button>
        <button class="btn btn-sm" onclick="escortRepair()" title="Patch the flagship (+${FIELD_REPAIR.hull} hull, ${matsString(FIELD_REPAIR.mats)}) — you hold fire this round">🔧 Field repair (flagship)</button>
        ${postBtns}
      </div>
      <div class="cards raid-action-cards">${foeCards}</div></div>`;
  } else {
    const legFuel = m.legFuel || ESCORT_LEG_FUEL;
    const lowFuel = (S.res.fuel || 0) < legFuel;
    const rc = escortRepairCost();
    const notDeparted = m.legsLeft === m.legs;             // still in the prep window — no leg run yet
    const oFrom = PLANETS.find(p => p.id === m.from);
    const prep = notDeparted
      ? `<div class="hint" style="color:var(--accent)">🧹 Prep window: before you set out you can use the <b>⚔️ Raider</b> tab (and any others) to hunt pirates at <b>${oFrom ? oFrom.name : "origin"}</b> and <b>${dn ? dn.name : "dest"}</b> — every kill there lowers this convoy's threat. Each cycle you spend counts against the deadline.</div>`
      : "";
    combat = `<div class="card"><h4>🛰️ ${notDeparted ? "Staging — prep then depart" : "Underway"}</h4>
      <div class="hint">${m.legsLeft > 0 ? `${m.legsLeft} leg(s) to ${dn ? dn.name : "port"}. Each leg is a cycle and burns ${legFuel} ⛽ (you hold ${fmt(S.res.fuel || 0)}); risk of ambush climbs as you near the destination.` : "Final approach — bring them in."}</div>
      ${prep}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" ${m.legsLeft > 0 && lowFuel ? "disabled" : ""} onclick="escortAdvance()">${m.legsLeft > 0 ? `▶ ${notDeparted ? "Set out" : "Advance one leg"} (${legFuel} ⛽)` : "🏁 Deliver convoy"}</button>
        ${rc.miss > 0 ? `<button class="btn btn-sm" onclick="escortFleetRepair()" title="Repair the convoy's escorts & freighters to full">🔧 Repair convoy (${fmt(rc.credits)} cr · ${rc.metals}⛓️ · ${rc.electronics}🖥️)</button>` : ""}
        ${postBtns}</div>
      ${m.legsLeft > 0 && lowFuel ? '<div class="hint" style="color:var(--bad)">Not enough fuel for the next leg — refuel at the Market.</div>' : ""}</div>`;
  }
  // ---- per-vessel combat stance & fit (replaces asset-assignment) ----
  const stanceRows = e.fleet.map((sh, fi) => {
    if (sh.role !== "flagship" && !sh.alive) return "";
    const fit = shipFit(sh), active = sh.stance || "balanced", lvl = fit[active] || 0, max = vesselMaxLevel(sh), prof = stanceProfile(sh);
    const stBtns = Object.keys(VESSEL_STANCES).map(k => { const s = VESSEL_STANCES[k]; return `<button class="btn btn-sm ${active === k ? "btn-primary" : ""}" title="${s.name} — ${s.hint}" onclick="setVesselStance(${fi},'${k}')">${s.ico}</button>`; }).join("");
    const dots = "●".repeat(lvl) + "○".repeat(max - lvl);
    let upg;
    if (lvl >= max) upg = `<span class="hint">max fit</span>`;
    else { const cost = vesselUpgradeCost(sh, active, lvl + 1), ok = Object.keys(cost).every(a => (S.res[a] || 0) >= cost[a]); upg = `<button class="btn btn-sm ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="Upgrade ${VESSEL_STANCES[active].name} to Lv${lvl + 1} — costs ${costAssetString(cost)} from your hold${ok ? "" : " (buy more at the Market)"}" onclick="upgradeVessel(${fi})">⬆ Lv${lvl + 1} · ${costAssetString(cost)}</button>`; }
    const eff = (prof.atk ? `🔥+${Math.round(prof.atk * 100)}%` : "") + (prof.mit ? ` 🛡️${Math.round(prof.mit * 100)}%` : "") || "no bonus yet";
    const vtype = sh.role === "flagship" ? "flagship" : sh.role === "freighter" ? "freighter · caps Lv2" : (sh.cls || "escort");
    return `<div class="ship-stat" style="flex-wrap:wrap;gap:6px;align-items:center">
      <span class="k">${sh.ico} ${sh.name} <span class="hint">${vtype}</span></span>
      <span class="v" style="display:flex;flex-wrap:wrap;gap:4px;align-items:center">
        ${stBtns} <span class="hint" title="${VESSEL_STANCES[active].name} fit level">${VESSEL_STANCES[active].ico}${dots}</span> ${upg} <span class="hint">→ ${eff}</span></span></div>`;
  }).join("");
  const outfit = `<div class="card"><h4>⚔️ Combat stance &amp; fit</h4>
    <div class="hint">Set each vessel's <b>stance</b> — ${VESSEL_STANCES.aggressive.ico} Aggressive (more 🔥), ${VESSEL_STANCES.balanced.ico} Balanced, ${VESSEL_STANCES.defensive.ico} Defensive (soak 🛡️) — then buy up to 3 <b>levels of fit</b> for it. Each level is paid from your hold (🔫 weapons · 🛸 drones · 🧠 AI cores) and costs more for bigger vessels; freighters cap at Lv2. Switching stance is free; fit is <b>consumed</b> for the run.${escortInCombat() ? " Re-rigging mid-ambush forfeits the round (you brace)." : ""}</div>
    <div class="hint" style="margin:4px 0">In hold: 🔫${fmt(S.res.weapons || 0)} 🛸${fmt(S.res.drones || 0)} 🧠${fmt(S.res.ai || 0)} — buy more at the 💱 Market.</div>
    ${stanceRows}</div>`;
  // ---- recruit friendly pirate bands as extra escorts (out of combat) ----
  let recruit = "";
  const hiredN = e.fleet.filter(s => s.hired && s.alive).length;
  if (!escortInCombat()) {
    const hiredRows = e.fleet.filter(s => s.hired && s.alive).map(s =>
      `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(bandById(s.bandId))}${s.ico} ${s.name} <span class="hint">${s.support ? "volunteer" : "hired"}</span></span>
        <span class="v"><button class="btn btn-sm btn-bad" title="Release this crew to free a slot (no refund)" onclick="escortDismissBand('${s.bandId}')">✖ Dismiss</button></span></div>`).join("");
    // on-call brotherhood standing by — bring them in free
    const onCallRows = bandsOnCall().filter(b => !e.fleet.some(s => s.hired && s.alive && s.bandId === b.id)).map(b =>
      `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(b)}${b.ico} ${b.name} <span class="hint">standing by · L${b.level}</span></span>
        <span class="v"><button class="btn btn-sm btn-good" onclick="escortRallyOnCall('${b.id}')">🤝 Rally (free)</button></span></div>`).join("");
    // your own warships — loyal, free convoy escorts
    const fleetRows = fleetRaidable().filter(s => !e.fleet.some(sh => sh.fleetId === s.id)).map(s =>
      `<div class="ship-stat" style="align-items:center"><span class="k">✦ ${FLEET_SHIPS[s.key].ico} ${s.name} <span class="hint">your ${SHIP_CLASSES[FLEET_SHIPS[s.key].cls].name} · 🔥${shipStrEff(s)}</span></span>
        <span class="v"><button class="btn btn-sm btn-good" onclick="escortRallyFleet('${s.id}')">✦ Assign (free)</button></span></div>`).join("");
    const avail = escortRecruitableBands()
      .filter(b => !e.fleet.some(s => s.hired && s.alive && s.bandId === b.id))
      .filter(b => bandBetrayChance(b) < 0.05)            // only trustworthy crews (desert risk < 5%)
      .sort((a, b) => bandBetrayChance(a) - bandBetrayChance(b));   // most reliable first
    const rows = avail.map(b => {
      const fee = escortRecruitFee(b), risk = Math.round(bandBetrayChance(b) * 100), rival = bandFoe(b);
      const blocked = rival && e.fleet.some(s => s.hired && s.alive && s.bandId === rival.id);
      return `<div class="ship-stat" style="align-items:center"><span class="k">${bandTagMark(b)}${b.ico} ${b.name} <span class="hint">${bandPers(b).ico}${bandPers(b).name} · ${bandTier(b).label} · L${b.level} · desert risk ${risk}%${blocked ? ` · ⚔️ rivals ${rival.name}` : ""}</span></span>
        <span class="v"><button class="btn btn-sm" ${hiredN < ESCORT_MAX_HIRED && S.res.credits >= fee && !blocked ? "" : "disabled"} title="${blocked ? "Won't fly with their rival aboard" : ""}" onclick="escortRecruitBand('${b.id}')">Hire (${fmt(fee)} cr)</button></span></div>`;
    }).join("");
    recruit = `<div class="card"><h4>🤝 Hire pirate escorts <span class="hint">${hiredN}/${ESCORT_MAX_HIRED} hired</span></h4>
      <div class="hint">Trustworthy crews (desert risk under 5%) from your 🏴‍☠️ Pirate Contacts will fly escort for a fee — higher standing &amp; your Dread make a crew cheaper and more loyal; flightier bands won't sign on. Listed most reliable first. Crews you've <b>📣 called for support</b> (Contacts tab) stand by to join free. Dismiss a crew to free a slot for another.</div>
      ${fleetRows ? `<div class="hint" style="margin:2px 0">✦ Your own warships will escort the convoy for free — loyal, and they take any damage back to your fleet:</div>${fleetRows}` : ""}
      ${onCallRows}${hiredRows}${rows || (onCallRows || hiredRows || fleetRows ? "" : '<div class="hint">No dependable bands will sign on right now — raise standing (and Dread), or call for support, in the Raider/Contacts tabs.</div>')}</div>`;
  }
  const liveThreat = Math.round(escortLiveThreat(m) * 100);
  const cyclesLeft = m.deadline != null ? Math.max(0, m.deadline - S.turn) : null;
  el.innerHTML = `<div class="panel-head"><h2>${m.pirate ? "🏴‍☠️ Smuggling run" : "🛡️ Escort — convoy"} to ${dn ? dn.name : "?"}</h2>
    <div class="subtitle">${m.pirate ? `Running ${m.contraband.ico} ${m.contraband.name} for the ${m.pirateName} · ` : ""}Leg ${m.legs - m.legsLeft}/${m.legs} · threat ${liveThreat}%${cyclesLeft != null ? ` · <span style="color:${cyclesLeft <= 1 ? "var(--bad)" : cyclesLeft <= 3 ? "var(--warn)" : "inherit"}">⏳ ${cyclesLeft} cycle${cyclesLeft === 1 ? "" : "s"} left</span>` : ""} · freighters ${aliveFr}/${totalFr} intact · reward ${fmt(m.reward)} cr${m.losses === 0 ? ` <span class="hint">(+${fmt(m.bonus)} flawless)</span>` : ""}</div></div>
    ${combat}
    <div class="card"><h4>🚢 Fleet — pooled firepower 🔥 ${fmt(F)}</h4>${roster}</div>
    ${outfit}
    ${recruit}
    <div class="row" style="margin-top:8px">${escortInCombat() ? '<span class="hint">Drive off the attackers to continue.</span>' : `<button class="btn btn-sm btn-bad" onclick="abortEscort()">🚪 Abandon escort (−20% fee)</button>`}</div>`;
}

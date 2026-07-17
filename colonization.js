/* ============================================================
   STELLAR FRONTIER — bases & colonies
   Player-owned settlement infrastructure: Player Bases (found, build
   modules, transfer cargo, run the base's own market stall), the
   Base<->Colony Trade Network (automated freight between the two),
   Random Contracts (time-bounded faction delivery jobs — small and
   otherwise unrelated, but it sat between the trade network and
   Colonies in the source and shares no better home), and Colonies
   (found, build, align to a faction, tax/deposit/withdraw, and the
   full per-cycle simulation: production, population, happiness, tax,
   unrest/secession).

   The Colonies content is pulled from two separate spots in the
   original file: founding/building (readable as one contiguous chunk)
   and tax/deposit/withdraw/processColonies, which sat physically
   *after* all of the Player Fleet code and its renderFleet() — fleet
   ships can be stationed at a colony for logistics duty, so the two
   domains had become interleaved. Player Fleet itself (ship building,
   roster, battle groups, fleet missions) stays in game.js for a future
   slice; colonyFreightMult(), which the trade network below calls, is
   part of that and stays behind too.

   Loaded after economy.js, before game.js. combatLocked, currentPlanet,
   fuelCap, cargoFree, canAfford, pay, gain, addRep, fmt, tradeSlippage,
   applyMarketMove, buyPrice, sellPrice, isIllegalAt, bustRisk, pirateCalm,
   nonFrontierPlanets, colonyFreightMult, spaceportTier, drawReserve,
   depletionMult, pollutionOf/addPollution/pollutionYieldMult/
   pollutionFarmMult, digestProd, digestNote, announce, afterAction and
   fleet.js's canAffordMats/payMats/fleetMatsString (reused as-is for the
   production surge / community relief costs below) still live in other
   files/game.js at this point in the split — safe,
   since every function here is only CALLED later, once every script has
   finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

/* ============================================================
   PLAYER BASES
   ============================================================ */
function baseStorageCap(pid) {
  const b = S.bases[pid];
  if (!b) return 0;
  return BASE_BASE_STORAGE + (b.modules.warehouse || 0) * 250;
}
function baseStorageUsed(b) { return Object.values(b.storage).reduce((s, q) => s + q, 0); }
function baseDefense(b) { return (b && b.modules.garrison) || 0; }
// Repair materials (a fleet hull, or the player's own ship) draw from whatever local stockpile
// sits at a location first — colony storage over base storage, same precedence a Shipyard build
// venue uses (shipyardVenueAt, fleet.js) — but repair itself needs no Shipyard/Small Shipyard
// building the way construction does, just a storeroom, so this checks for the colony/base
// itself rather than any particular module tier.
function localStockpileAt(pid) {
  if (S.colonies && S.colonies[pid]) return S.colonies[pid].storage;
  if (S.bases && S.bases[pid]) return S.bases[pid].storage;
  return null;
}

function matsString(mats) {
  return Object.entries(mats).map(([c, q]) =>
    `<span style="color:${(S.res[c] || 0) >= q ? "inherit" : "var(--bad)"}">${q}${COM[c].ico}</span>`).join(" ");
}
function buildBase() {
  const pid = S.location;
  if (S.bases[pid]) return;
  const mats = BASE_FOUNDATION_MATS;
  if (S.res.credits < BASE_FOUNDATION_COST) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need build materials in your hold (metals).", "bad");
  S.res.credits -= BASE_FOUNDATION_COST; pay(mats);
  S.bases[pid] = { modules: {}, storage: {}, trade: { on: false, exp: {}, imp: {}, cols: {} } };
  log(`🏗️ Established a base on <span class="c">${currentPlanet().name}</span>.`, "event");
  toast("Base established!", "event");
  afterAction();
}
function buildModule(moduleId) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  const planet = currentPlanet();
  const def = baseModuleList(planet).find(m => m.id === moduleId);
  if (!def) return;
  const tier = b.modules[moduleId] || 0;
  if (tier >= def.tiers) return;
  const cost = Math.round(def.baseCost * Math.pow(def.costMul, tier));
  const mats = moduleMats(def, tier + 1);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => COM[c].name).join(", ") + ".", "bad");
  S.res.credits -= cost; pay(mats);
  b.modules[moduleId] = tier + 1;
  log(`Built ${def.ico} ${def.name} (Tier ${tier + 1}) on ${planet.name}.`, "good");
  toast(`${def.name} → Tier ${tier + 1}`, "good");
  afterAction();
}

/* logistics — move cargo between ship and the base on the current planet */
function transferToBase(c, qty) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  qty = Math.min(Math.max(0, Math.floor(qty)), S.res[c] || 0);
  if (qty <= 0) return;
  qty = Math.min(qty, baseStorageCap(pid) - baseStorageUsed(b));
  if (qty <= 0) return toast("Base storage is full.", "bad");
  S.res[c] -= qty; b.storage[c] = (b.storage[c] || 0) + qty;
  log(`Stored ${qty} ${COM[c].ico} ${COM[c].name} at ${currentPlanet().name} base.`);
  afterAction();
}
function transferFromBase(c, qty) {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  qty = Math.min(Math.max(0, Math.floor(qty)), b.storage[c] || 0);
  if (qty <= 0) return;
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();   // fuel goes to the tank, everything else to the hold
  qty = Math.min(qty, space);
  if (qty <= 0) return toast(COM[c].isFuel ? "Fuel tank is full." : "Cargo hold is full.", "bad");
  b.storage[c] -= qty; S.res[c] += qty;
  log(`Withdrew ${qty} ${COM[c].ico} ${COM[c].name} from ${currentPlanet().name} base.`);
  afterAction();
}
function storeAllCargo() {
  const pid = S.location, b = S.bases[pid];
  if (!b) return;
  let room = baseStorageCap(pid) - baseStorageUsed(b), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.res[c] || 0, room);
    if (q > 0) { S.res[c] -= q; b.storage[c] = (b.storage[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`Stored ${moved} units of cargo at ${currentPlanet().name} base.`); afterAction(); }
  else toast("Nothing to store (or base full).", "bad");
}
function depositQty(c) { transferToBase(c, +document.getElementById("xfer-" + c).value); }
const BASE_MARKET_IMPACT = 1.5;   // bases trade in bulk — their deals move the local market harder than a ship's
// Buy/Sell the BASE's stockpile at the local market (not the ship)
function baseMarketBuy(c, qty) {
  if (combatLocked()) return;
  const b = S.bases[S.location]; if (!b) return toast("No base here.", "bad");
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  const p = currentPlanet();
  const room = baseStorageCap(S.location) - baseStorageUsed(b);
  if (room <= 0) return toast("Base storage is full.", "bad");
  qty = Math.min(qty, room);
  const slip = tradeSlippage(p, c, qty);
  const cost = Math.round(buyPrice(S.location, c) * (1 + slip / 2) * qty);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost; b.storage[c] = (b.storage[c] || 0) + qty; S.stats.trades++;
  applyMarketMove(S.location, c, Math.min(0.6, slip * BASE_MARKET_IMPACT), false);   // a depot buys wholesale — bigger market move
  log(`Bought ${qty} ${COM[c].ico} ${COM[c].name} into the base for <span class="c">${fmt(cost)}</span> cr — local price rose to ${fmt(S.prices[S.location][c])}.`, "good");
  sfx("buy"); toast(`Bought ${qty} ${COM[c].name} → base`, "good");
  afterAction();
}
function baseMarketSell(c, qty) {
  if (combatLocked()) return;
  const b = S.bases[S.location]; if (!b) return toast("No base here.", "bad");
  qty = Math.max(0, Math.floor(qty)); if (qty <= 0) return;
  if ((b.storage[c] || 0) < qty) return toast("The base doesn't have that many.", "bad");
  const p = currentPlanet();
  if (isIllegalAt(c, S.location) && Math.random() < bustRisk(c, qty, p)) {
    const conf = b.storage[c] || 0, fine = Math.min(S.res.credits, Math.round(conf * COM[c].base * 0.4) + 200);
    b.storage[c] = 0; S.res.credits -= fine;
    addRep("core", -12); addRep(p.faction, -6); addRep("frontier", 3); S.stats.busts++;
    log(`🚨 CUSTOMS BUST at ${p.name}! ${conf} ${COM[c].ico} ${COM[c].name} seized from your base, fined ${fmt(fine)} cr.`, "bad");
    toast(`🚨 Busted! ${COM[c].name} seized`, "bad");
    return afterAction();
  }
  const slip = tradeSlippage(p, c, qty);
  const revenue = Math.round(sellPrice(S.location, c) * (1 - slip / 2) * qty);
  b.storage[c] -= qty; S.res.credits += revenue; S.stats.trades++; S.stats.profit += revenue; S.stats.sales = (S.stats.sales || 0) + revenue;
  applyMarketMove(S.location, c, Math.min(0.6, slip * BASE_MARKET_IMPACT), true); addRep(p.faction, 1);   // dumping a stockpile floods the local market
  log(`Sold ${qty} ${COM[c].ico} ${COM[c].name} from the base for <span class="c">${fmt(revenue)}</span> cr — local price fell to ${fmt(S.prices[S.location][c])}.`, "good");
  sfx("sell"); toast(`Sold ${qty} ${COM[c].name} (+${fmt(revenue)} cr)`, "good");
  afterAction();
}
function baseBuyQty(c) { const el = document.getElementById("xfer-" + c); baseMarketBuy(c, el ? +el.value : 0); }
function baseSellQty(c) { const el = document.getElementById("xfer-" + c); baseMarketSell(c, el ? +el.value : 0); }
function withdrawQty(c) { transferFromBase(c, +document.getElementById("xfer-" + c).value); }

/* per-base per-cycle raid roll — the base-side mirror of colonyEventRoll's pirate-raid
   branch below: same odds and shape (pirateCalm suppresses it entirely; a Garrison can
   repel it; otherwise a quarter of stored goods and a credit loss go missing), but
   scaled to a base's own numbers. Bases have no happiness/population field to hook
   into, so the credit loss scales off total module tiers built (a developed base is
   worth more to plunder) instead of colony pop, and a successful raid has no morale
   bonus to restore. */
function baseRaidRoll(pid, b, planet) {
  const name = planet.name;
  if (Math.random() >= 0.07) return;
  if (pirateCalm()) {
    log(`🛡️ Pirates kept clear of your base on <span class="c">${name}</span> — your bounty hunting has them lying low.`, "good");
    return;
  }
  const raider = pickRaidBand();
  const raiderSubj = raider ? `The ${raider.ico} ${raider.name}` : "Pirates";
  const raiderBy = raider ? ` by the ${raider.ico} ${raider.name}` : "";
  if (baseDefense(b) > 0 && Math.random() < baseDefense(b) * 0.30) {
    log(`🛡️ Your base on <span class="c">${name}</span> repelled a pirate raid${raiderBy}.`, "good");
    return;
  }
  let lootLog = [];
  Object.keys(b.storage).forEach(c => {
    const take = Math.floor((b.storage[c] || 0) * 0.25);
    if (take > 0) { b.storage[c] -= take; lootLog.push(`${take} ${COM[c].ico}`); }
  });
  const tierSum = Object.values(b.modules).reduce((s, t) => s + t, 0);
  const credLoss = Math.min(S.res.credits, (tierSum + 1) * 60);
  S.res.credits -= credLoss;
  cycleLedger("base raid losses", -credLoss);
  log(`🏴‍☠️ ${raiderSubj} raided your base on <span class="c">${name}</span>! Lost ${lootLog.join(" ") || "no goods"} and ${fmt(credLoss)} credits.`, "bad");
  digestNote("threats", `${name} base raided`);
  toast(`Base at ${name} raided!`, "bad");
  announce(`🏴‍☠️ ${name} Base Raided`, `${raiderSubj} struck your base. Build a 🛡️ Garrison to defend it.`, true);
}
/* runs every cycle (including while you travel) */
function processBases() {
  const summary = {};
  Object.entries(S.bases).forEach(([pid, b]) => {
    const planet = PLANETS.find(p => p.id === pid);
    const cap = baseStorageCap(pid);
    baseModuleList(planet).forEach(mod => {
      if (mod.refiner) return;                       // refineries consume inputs — handled below
      const out = moduleOutput(planet, mod, b.modules[mod.id] || 0);
      if (out <= 0) return;
      const add = Math.min(out, cap - baseStorageUsed(b));
      if (add > 0) {
        b.storage[mod.produces] = (b.storage[mod.produces] || 0) + add;
        summary[mod.produces] = (summary[mod.produces] || 0) + add;
        digestProd(mod.produces, add);
      }
    });
    // Fuel Refinery: crack stored ice into fuel, limited by ice on hand and free space
    const reflvl = b.modules.fuelrefinery || 0;
    if (reflvl > 0) {
      const ice = b.storage.ice || 0, room = cap - baseStorageUsed(b);
      let made = Math.min(reflvl * REFINERY_RATE, Math.floor(ice / REFINERY_ICE_PER_FUEL), room);
      if (made > 0) {
        b.storage.ice -= Math.ceil(made * REFINERY_ICE_PER_FUEL);
        b.storage.fuel = (b.storage.fuel || 0) + made;
        summary.fuel = (summary.fuel || 0) + made;
        digestProd("fuel", made);
      }
    }
    baseRaidRoll(pid, b, planet);
  });
  const keys = Object.keys(summary);
  if (keys.length) log(`🏗️ Your bases produced ${keys.map(c => summary[c] + COM[c].ico).join(" ")}.`, "good");
}
/* ============================================================
   BASE <-> COLONY TRADE NETWORK
   A base with a Storage Depot can run a trade route: each cycle it exports its
   raw-material stock to fill your colonies' raw orders, and imports colonies'
   finished-goods surplus into base storage. Costs: distance-scaled freight,
   a tariff on faction-aligned colonies, customs seizure when routing goods
   that are contraband at either end, and pirate convoy ambushes by distance
   and activity. Watch the per-cycle net balance for deficits.
   ============================================================ */
const FREIGHT_RATE = 0.5;            // credits per unit per light-year
const BASE_TRADE_THROUGHPUT = 30;    // units per commodity per route per cycle
const TRADE_SEIZE_CHANCE = 0.18;     // per-cycle customs risk for routing contraband
function worldDist(a, b) { const pa = PLANETS.find(p => p.id === a); return (pa && pa.distances[b]) || 1; }
function isFinishedGood(c) { return ["Finished", "Luxury", "Strategic"].includes(COM[c].tier) || c === "medicine"; }
// what a base will import from colonies: finished goods + combat drones (a Component colonies manufacture)
function baseImportable(c) { return isFinishedGood(c) || c === "drones" || c === "fuel"; }   // bases also collect colony fuel
function colonyFinishedReserve(col, c) {
  if (c === "goods") return col.pop;                       // mirror the colony's own happiness reserve
  if (c === "luxury" || c === "medicine") return Math.ceil(col.pop / 3);
  return 0;
}
function baseTradeActive(b) { return !!(b && b.trade && b.trade.on && (b.modules.warehouse || 0) > 0); }
function tradeExpOk(b, c) { return !(b.trade && b.trade.exp && b.trade.exp[c] === false); }   // default-on; player disables specific goods
function tradeImpOk(b, c) { return !(b.trade && b.trade.imp && b.trade.imp[c] === false); }
// Import/export are mutually exclusive per commodity so a finished good can't loop
// (imported from one colony then exported back to another, paying freight each way).
// Only finished goods can be imported, so they're the only ones that can conflict;
// when both flags are on (the default) import wins and export is locked out.
function baseImporting(b, c) { return baseImportable(c) && tradeImpOk(b, c); }
function baseExporting(b, c) { return tradeExpOk(b, c) && !baseImporting(b, c); }
function tradeColOk(b, cid) { return !(b.trade && b.trade.cols && b.trade.cols[cid] === false); }
let _trade = null;
function tradeBegin() { _trade = { freight: 0, importedVal: 0, exportedVal: 0, ambushLoss: 0, imp: {}, exp: {}, seized: {} }; }
function tradeSeizeCheck(c, bid, cid) { return (isIllegalAt(c, bid) || isIllegalAt(c, cid)) && Math.random() < TRADE_SEIZE_CHANCE; }
function tradeFine(c, q) {
  const f = Math.min(S.res.credits, Math.round(q * COM[c].base * 1.5));
  S.res.credits -= f; S.pirate.wanted = Math.min(100, (S.pirate.wanted || 0) + 4);
  _trade.seized[c] = (_trade.seized[c] || 0) + q; if (typeof clampPirate === "function") clampPirate();
}
// EXPORT pass: bases ship raw stock to fill colony orders (runs before colonies manufacture)
function processBaseTrade() {
  tradeBegin();
  const bases = Object.entries(S.bases || {}).filter(([id, b]) => baseTradeActive(b));
  const cols = Object.entries(S.colonies || {});
  if (!bases.length || !cols.length) return;
  bases.forEach(([bid, b]) => {
    cols.forEach(([cid, col]) => {
      const cp = PLANETS.find(p => p.id === cid);
      const dist = worldDist(bid, cid);
      if (!tradeColOk(b, cid)) return;
      const tariff = col.faction ? 1.25 : 1;
      STORE_IDS.forEach(c => {                        // export ANY product the base stocks (incl. fuel) to fill colony orders
        if (!baseExporting(b, c)) return;            // ...unless it's set to import (avoid loops)
        const need = (col.orders[c] || 0) - (col.storage[c] || 0);
        if (need <= 0) return;
        const room = colonyStorageCap(col, cp) - colonyStorageUsed(col);
        const move = Math.min(need, b.storage[c] || 0, BASE_TRADE_THROUGHPUT, room);
        if (move <= 0) return;
        b.storage[c] -= move;
        if (tradeSeizeCheck(c, bid, cid)) { tradeFine(c, move); return; }
        col.storage[c] = (col.storage[c] || 0) + move;
        _trade.freight += Math.ceil(dist * move * FREIGHT_RATE * tariff * colonyFreightMult(cid));
        _trade.exp[c] = (_trade.exp[c] || 0) + move; _trade.exportedVal += move * COM[c].base;
      });
    });
  });
}
// IMPORT pass: called per colony during processColonies, BEFORE its market export, so
// your bases get first claim on freshly-manufactured finished goods (the colony sells the rest).
function runBaseImport(col, cid, cp) {
  if (!_trade) tradeBegin();
  const bases = Object.entries(S.bases || {}).filter(([id, b]) => baseTradeActive(b));
  if (!bases.length) return;
  bases.forEach(([bid, b]) => {
    const cap = baseStorageCap(bid);
    const dist = worldDist(bid, cid);
    if (!tradeColOk(b, cid)) return;
    const tariff = col.faction ? 1.25 : 1;
    STORE_IDS.filter(baseImportable).forEach(c => {
      if (!tradeImpOk(b, c)) return;
      const reserve = colonyFinishedReserve(col, c) + (col.orders[c] || 0);
      const surplus = (col.storage[c] || 0) - reserve;
      if (surplus <= 0) return;
      const move = Math.min(surplus, BASE_TRADE_THROUGHPUT, cap - baseStorageUsed(b));
      if (move <= 0) return;
      col.storage[c] -= move;
      if (tradeSeizeCheck(c, bid, cid)) { tradeFine(c, move); return; }
      b.storage[c] = (b.storage[c] || 0) + move;
      _trade.freight += Math.ceil(dist * move * FREIGHT_RATE * tariff * colonyFreightMult(cid));
      _trade.imp[c] = (_trade.imp[c] || 0) + move; _trade.importedVal += move * COM[c].base;
    });
  });
}
// settle the cycle's trade: pirate ambush, freight charge, ledger + log
function finalizeBaseTrade() {
  const t = _trade; _trade = null;
  if (!t) return;
  const _np3 = nonFrontierPlanets(); const threat = _np3.reduce((s2, p) => s2 + pirateLevel(p.id), 0) / _np3.length;
  if (!pirateCalm() && (t.importedVal + t.exportedVal) > 0 && Math.random() < 0.05 + threat * 0.03) {
    t.ambushLoss = Math.min(S.res.credits, 150 + Math.round(threat * 350));
    S.res.credits -= t.ambushLoss;
    log(`🏴‍☠️ Pirates raided a base-supply convoy — ${fmt(t.ambushLoss)} cr lost. Calm the lanes to protect your routes.`, "bad");
  }
  if (t.freight > 0) S.res.credits = Math.max(0, S.res.credits - t.freight);
  const net = Math.round(t.importedVal - t.exportedVal - t.freight - t.ambushLoss);
  if (t.importedVal + t.exportedVal > 0 || Object.keys(t.seized).length) {
    S.tradeNet = (S.tradeNet || 0) + net;
    S.tradeLastCycle = { imp: t.imp, exp: t.exp, freight: t.freight, net, seized: t.seized, ambushLoss: t.ambushLoss };
  }
  if (Object.keys(t.seized).length) log(`🚔 Customs seized contraband from your trade route: ${Object.entries(t.seized).map(([c, q]) => q + COM[c].ico).join(" ")} — fined, Wanted up. Don't route illegal goods.`, "bad");
  if (t.importedVal + t.exportedVal > 0) {
    const impStr = Object.entries(t.imp).map(([c, q]) => q + COM[c].ico).join(" ") || "—";
    const expStr = Object.entries(t.exp).map(([c, q]) => q + COM[c].ico).join(" ") || "—";
    log(`🔄 Base trade: exported ${expStr} → colonies, imported ${impStr} → bases; freight/tariffs ${fmt(t.freight)} cr → net ${net >= 0 ? "+" : ""}${fmt(net)} cr/cyc.`, net >= 0 ? "good" : "bad");
  }
}
/* ============================================================
   RANDOM CONTRACTS  (time-bounded, faction-posted)
   ============================================================ */
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

/* what each faction asks you to supply */
const FACTION_WANTS = {
  core:      ["goods", "machinery", "medicine", "electronics"],
  miners:    ["ore", "metals", "alloys", "energy"],
  agri:      ["biomass", "spice", "chemicals", "medicine"],
  syndicate: ["crystals", "electronics", "luxury", "machinery"],
  frontier:  ["fuel", "metals", "weapons", "relics"],
};
const STANDINGS = [
  { min: 60,  label: "Allied",   cls: "good" },
  { min: 25,  label: "Friendly", cls: "good" },
  { min: -24, label: "Neutral",  cls: "" },
  { min: -59, label: "Disliked", cls: "bad" },
  { min: -100,label: "Hostile",  cls: "bad" },
];
function standing(f) { const r = S.rep[f] || 0; return STANDINGS.find(s => r >= s.min); }

function genContract() {
  const reachable = PLANETS.filter(isVisible);              // only worlds in play this game
  const f = pick([...new Set(reachable.map(p => p.faction))]);
  const homeworlds = reachable.filter(p => p.faction === f);
  const planet = pick(homeworlds);
  // a resettlement job asks for passengers ferried by a Personal Convoy passenger liner,
  // instead of a commodity delivered from the hold — only ever posted for a colonizable
  // destination this faction actually controls, since a faction has no reason to ask for
  // settlers moved to a world that isn't one of yours to grow.
  const colonyDests = reachable.filter(p => p.faction === f && S.colonies && S.colonies[p.id]);
  if (colonyDests.length && Math.random() < 0.2) {
    const dest = pick(colonyDests);
    const passengers = +(1 + Math.random() * 3).toFixed(1);        // 1–4k
    const reward = { credits: Math.round(passengers * 900 * (1 + Math.random() * 0.4)) + 300,
                     rep: { [f]: 8 + Math.floor(Math.random() * 12) },
                     influence: 2 + Math.floor(Math.random() * 5) };
    const duration = 8 + Math.floor(Math.random() * 10);           // resettlement takes longer than a supply run
    return { id: "c" + (++S.contractSeq), kind: "resettle", faction: f, planetId: dest.id,
             passengers, reward, deadline: S.turn + duration, posted: S.turn };
  }
  let commodity, kind = "supply";
  if (f === "frontier" && Math.random() < 0.5) { commodity = pick(["relics", "weapons"]); kind = "smuggle"; }
  else commodity = pick(FACTION_WANTS[f]);
  const qty = 10 + Math.floor(Math.random() * 26);                 // 10–35
  const premium = (kind === "smuggle" ? 1.7 : 1.35) + Math.random() * 0.35;
  const reward = { credits: Math.round(qty * COM[commodity].base * premium) + 200,
                   rep: { [f]: 6 + Math.floor(Math.random() * 12) },
                   influence: 2 + Math.floor(Math.random() * 5) };
  if (kind === "smuggle") { reward.rep.core = -(5 + Math.floor(Math.random() * 8)); reward.influence += 3; }
  const duration = 6 + Math.floor(Math.random() * 9);             // expires in 6–14 cycles
  return { id: "c" + (++S.contractSeq), kind, faction: f, planetId: planet.id,
           commodity, qty, reward, deadline: S.turn + duration, posted: S.turn };
}
function maybeGenContract() {
  if (S.contracts.length < 6 && Math.random() < 0.55) {
    const c = genContract();
    S.contracts.push(c);
    const what = c.kind === "resettle" ? `${fmt(c.passengers)}k settlers` : `${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name}`;
    log(`📋 New ${c.kind === "smuggle" ? "smuggling job" : c.kind === "resettle" ? "resettlement job" : "contract"} posted by ${FACTIONS[c.faction].ico} ${FACTIONS[c.faction].name}: ${what} to ${PLANETS.find(p => p.id === c.planetId).name} (${c.deadline - S.turn} cycles).`, "event");
  }
}
function expireContracts() {
  S.contracts = S.contracts.filter(c => {
    if (S.turn > c.deadline) {
      addRep(c.faction, -5);
      const what = c.kind === "resettle" ? `${fmt(c.passengers)}k settlers` : c.qty + " " + COM[c.commodity].name;
      log(`📋 Contract expired — ${FACTIONS[c.faction].name} wanted ${what} (−5 rep).`, "bad");
      return false;
    }
    return true;
  });
}
// how many passengers, combined across every convoy passenger liner currently docked/riding
// with you at S.location, are available to fulfil a resettle contract right here
function convoyPassengersHere() { return convoyPassengerShips().reduce((sum, s) => sum + (s.passengers || 0), 0); }
function fulfilContract(id) {
  const i = S.contracts.findIndex(c => c.id === id);
  if (i < 0) return;
  const c = S.contracts[i];
  const dest = PLANETS.find(p => p.id === c.planetId);
  if (S.location !== c.planetId) return toast(`Deliver at ${dest.name}.`, "bad");
  if (c.kind === "resettle") {
    if (convoyPassengersHere() < c.passengers) return toast(`Need ${fmt(c.passengers)}k passengers aboard a convoy liner.`, "bad");
    let left = c.passengers;
    convoyPassengerShips().forEach(s => {
      if (left <= 0) return;
      const take = Math.min(left, s.passengers || 0);
      if (take <= 0) return;
      s.passengers -= take; left -= take;
    });
    const col = S.colonies[c.planetId];
    if (col) col.pop = Math.min(colonyHousing(col, dest), col.pop + c.passengers);
    gain(c.reward);
    S.contracts.splice(i, 1);
    log(`📋 Contract fulfilled — resettled ${fmt(c.passengers)}k settlers at ${dest.name} for ${FACTIONS[c.faction].name}.`, "event");
    toast("Contract complete!", "event");
    afterAction();
    return;
  }
  if ((S.res[c.commodity] || 0) < c.qty) return toast(`Need ${c.qty} ${COM[c.commodity].name}.`, "bad");
  S.res[c.commodity] -= c.qty;
  gain(c.reward);
  S.contracts.splice(i, 1);
  log(`📋 Contract fulfilled — delivered ${c.qty} ${COM[c.commodity].ico} ${COM[c.commodity].name} to ${FACTIONS[c.faction].name}.`, "event");
  toast("Contract complete!", "event");
  afterAction();
}

/* ============================================================
   COLONIES  (full development: population, happiness, tax, buildings)
   ============================================================ */
function colonyHousing(col, planet) {
  let h = 14 + (planet.terraformHousing || 0);   // a terraformed world's engineered population scale, above the base cap
  colonyBuildingList(planet).forEach(b => { if (b.housing) h += b.housing(col.buildings[b.id] || 0); });
  return h;
}
function colonyStorageUsed(col) { return Object.values(col.storage).reduce((s, q) => s + q, 0); }
function colonyStorageCap(col, planet) {
  let cap = 300;
  cap += (col.buildings.spaceport || 0) * 200;
  cap += (col.buildings.habitat || 0) * 60;
  return cap;
}
/* ---------- Production scaling: workforce, automation, unrest ----------
   Building tiers alone used to set output — population and research never
   entered the formula, even though effIndustry/effTech (catalogs.js) already
   track both per colony and are shown right on the colony card. Three
   multipliers close that gap without duplicating population's effect twice:
   workforce reads population directly (are there enough hands to run what's
   built), automation reads effTech specifically — NOT effIndustry, since
   effIndustry's own pop/12 term would double-count workforce's population
   effect — and unrest (already tracked for secession, colonization.js below)
   now costs real output before it ever costs the colony outright. */
const LABOR_PER_TIER = 2, WORKFORCE_MIN = 0.5, WORKFORCE_MAX = 1.3;
function colonyLaborNeeded(col) { return Object.entries(col.buildings || {}).reduce((s, [bid, t]) => s + (col.idle && col.idle[bid] ? 0 : t), 0); }
function colonyWorkforceMult(col) {
  const needed = colonyLaborNeeded(col);
  if (needed <= 0) return 1;
  return Math.max(WORKFORCE_MIN, Math.min(WORKFORCE_MAX, col.pop / (needed * LABOR_PER_TIER)));
}
const AUTOMATION_PER_TECH = 0.03, AUTOMATION_CAP = 0.5;   // +3%/tech point, capped at +50% — industry-chain buildings only
function colonyAutomationMult(planet) { return 1 + Math.min(AUTOMATION_CAP, effTech(planet) * AUTOMATION_PER_TECH); }
const UNREST_PENALTY_PER_POINT = 0.06, UNREST_FLOOR = 0.6;
function colonyUnrestMult(col) { return Math.max(UNREST_FLOOR, 1 - (col.unrest || 0) * UNREST_PENALTY_PER_POINT); }

/* ---------- Labor relief: a paid production surge + an on-demand morale perk ----------
   Workforce can crush a growing colony's output to WORKFORCE_MIN long before its
   population catches up. A surge is a paid, temporary patch for that gap — contracted
   specialists and rented automation gear, not a permanent fix — costed in the same
   high-tier goods that gap would otherwise starve (Tech, Electronics, Machinery, AI
   Cores, Alloys). Community Relief is a separate, on-demand happiness/unrest lever
   alongside the existing passive stockpile bonuses (goods/luxury/medicine sitting in
   storage, just above) rather than a replacement for them. Both source materials the
   same local-storage-first way Shipyard builds and repairs already do this session
   (canAffordMats/payMats/fleetMatsString, fleet.js) against localStockpileAt(pid) —
   S.res already holds Tech Pts in the same bag as cargo (state.js), so a cost dict
   naming "tech" resolves straight to S.res.tech since colonies never store it. */
const PRODUCTION_SURGE_TIERS = [
  { tier: 1, name: "Overtime Shift",         mult: 1.15, cycles: 10, cost: { tech: 15, electronics: 10, machinery: 5,  ai: 2,  alloys: 15 } },
  { tier: 2, name: "Contracted Specialists", mult: 1.30, cycles: 12, cost: { tech: 35, electronics: 25, machinery: 15, ai: 5,  alloys: 35 } },
  { tier: 3, name: "Automation Surge",       mult: 1.50, cycles: 15, cost: { tech: 70, electronics: 50, machinery: 30, ai: 12, alloys: 60 } },
];
function colonySurgeMult(col) { return col.surge ? col.surge.mult : 1; }
function startProductionSurge(tier) {
  const pid = S.location, col = S.colonies[pid];
  if (!col) return;
  if (col.surge) return toast("A production surge is already running here — wait for it to finish.", "bad");
  const def = PRODUCTION_SURGE_TIERS.find(t => t.tier === tier);
  if (!def) return;
  const local = localStockpileAt(pid);
  if (!canAffordMats(def.cost, local)) return toast("Not enough materials for this surge tier.", "bad");
  payMats(def.cost, local);
  col.surge = { tier, mult: def.mult, cyclesLeft: def.cycles, total: def.cycles };
  log(`⚡ ${def.name} begins on <span class="c">${currentPlanet().name}</span> — +${Math.round((def.mult - 1) * 100)}% output for ${def.cycles} cycles.`, "event");
  toast(`${def.name} underway`, "event");
  afterAction();
}
const MORALE_PERK_HAPPINESS = 12, MORALE_PERK_UNREST_RELIEF = 1, MORALE_PERK_COOLDOWN = 5;
function moralePerkCost(col) { return { goods: Math.max(10, Math.round(col.pop * 0.5)) }; }
function giveMoralePerk() {
  const pid = S.location, col = S.colonies[pid];
  if (!col) return;
  if ((col.perkCooldown || 0) > 0) return toast(`Cool down another ${col.perkCooldown} cycle(s) before the next relief event.`, "bad");
  const cost = moralePerkCost(col), local = localStockpileAt(pid);
  if (!canAffordMats(cost, local)) return toast("Not enough Consumer Goods for a relief event.", "bad");
  payMats(cost, local);
  col.happiness = Math.min(100, col.happiness + MORALE_PERK_HAPPINESS);
  col.unrest = Math.max(0, (col.unrest || 0) - MORALE_PERK_UNREST_RELIEF);
  col.perkCooldown = MORALE_PERK_COOLDOWN;
  log(`🎉 A subsidized goods fair lifts spirits on <span class="c">${currentPlanet().name}</span>.`, "event");
  toast("Community relief held", "event");
  afterAction();
}
const GRANARY_BUFFER_CYCLES = 40;   // how many cycles of the food stockpile count toward growth's carrying capacity
function colonyTaxIncome(col) {
  const factionMul = col.faction ? 1.25 : 1;   // bloc trade network lifts commerce
  return Math.round(col.pop * (col.tax / 100) * 5 * (col.happiness / 100) * factionMul);
}
function colonyDefense(col) { return (col.buildings.garrison || 0) + colonyFactionDefenseBonus(col); }

/* one risk/boom roll per colony per cycle — returns true if the colony seceded */
function colonyEventRoll(pid, col, planet) {
  const name = planet.name, def = colonyDefense(col);
  const roll = Math.random();

  // ---- Pirate raid (frontier worlds are exposed; hunting pirates buys calm) ----
  if (roll < 0.07) {
    if (pirateCalm()) {
      log(`🛡️ Pirates kept clear of <span class="c">${name}</span> — your bounty hunting has them lying low.`, "good");
      return false;
    }
    // pickRaidBand ties the raid to a real crew's identity whenever one's a fit (a friendly
    // or sworn band never raids you) — falls back to the old faceless phrasing when none is
    // (early game, no bands met yet), so every message below is byte-identical to before then
    const raider = pickRaidBand();
    const raiderSubj = raider ? `The ${raider.ico} ${raider.name}` : "Pirates";
    const raiderBy = raider ? ` by the ${raider.ico} ${raider.name}` : "";
    if (def > 0 && Math.random() < def * 0.30) {
      col.happiness = Math.min(100, col.happiness + 4);
      log(`🛡️ ${name}'s garrison repelled a pirate raid${raiderBy}.`, "good");
      return false;
    }
    let lootLog = [];
    Object.keys(col.storage).forEach(c => {
      const take = Math.floor((col.storage[c] || 0) * 0.25);
      if (take > 0) { col.storage[c] -= take; lootLog.push(`${take} ${COM[c].ico}`); }
    });
    const credLoss = Math.min(S.res.credits, col.pop * 8);
    S.res.credits -= credLoss;
    cycleLedger("colony raid losses", -credLoss);
    col.happiness = Math.max(0, col.happiness - 12);
    log(`🏴‍☠️ ${raiderSubj} raided <span class="c">${name}</span>! Lost ${lootLog.join(" ") || "no goods"} and ${fmt(credLoss)} credits.`, "bad");
    digestNote("threats", `${name} raided`);
    toast(`${name} raided!`, "bad");
    announce(`🏴‍☠️ ${name} Raided`, `${raiderSubj} struck your colony. Build a 🛡️ Garrison to defend it.`, true);
    return false;
  }

  // ---- Natural disaster (type depends on the world) ----
  if (roll < 0.12) {
    const volcanic = /Volcanic|Shattered/.test(planet.tag);
    const verdant = (planet.deposits.biomass || 0) >= 1.3;
    if (volcanic) {
      const built = Object.keys(col.buildings).filter(b => col.buildings[b] > 0);
      const hit = built[Math.floor(Math.random() * built.length)];
      if (hit) col.buildings[hit]--;
      col.pop = Math.max(1, col.pop - 2);
      log(`🌋 A violent eruption shook <span class="c">${name}</span>${hit ? ` — its ${colonyBuildingList(planet).find(b => b.id === hit).name} was damaged` : ""}.`, "bad");
    } else if (verdant) {
      const lost = Math.max(1, Math.round(col.pop * 0.15));
      col.pop = Math.max(1, col.pop - lost);
      col.happiness = Math.max(0, col.happiness - 8);
      log(`🦠 A plague swept <span class="c">${name}</span> — ${lost}k lost.`, "bad");
    } else {
      col.storage.biomass = 0;
      col.happiness = Math.max(0, col.happiness - 6);
      log(`🥀 Crop blight ruined ${name}'s food stores.`, "bad");
    }
    toast(`Disaster on ${name}`, "bad");
    return false;
  }

  // ---- Boom (good fortune) ----
  if (roll < 0.16) {
    if (Math.random() < 0.5) {
      const inflow = Math.max(1, Math.round(col.pop * 0.12));
      col.pop += inflow;
      log(`✨ A wave of migrants settled on <span class="c">${name}</span> (+${inflow}k).`, "good");
    } else {
      const windfall = col.pop * 20 + 200;
      S.res.credits += windfall;
      col.happiness = Math.min(100, col.happiness + 5);
      log(`✨ A trade boom enriched <span class="c">${name}</span> (+${fmt(windfall)} credits).`, "good");
    }
    return false;
  }
  return false;
}

/* ---------- Colony faction alignment ----------
   A colony may petition to join one of the great factions. The charter buys
   real benefits — the bloc's trade network (commerce), its patrols (support)
   and a flavored perk — at the price of irking rival blocs. */
const ALIGN_REP_REQ = 20;     // your standing with the bloc before they'll charter a colony
const ALIGN_COST_INF = 3;     // influence to push the petition through
const FACTION_COLONY_PERKS = {
  core:      "⚖️ +1 extra defense level — the law watches over you",
  miners:    "⛏️ +1 planetary Industry — guild engineers on site",
  agri:      "🌾 Farms yield +25% — combine agronomists at work",
  syndicate: "🔬 +1 planetary Tech — syndicate data access",
  frontier:  "🛰️ Import fees cut to the bone — free-trader routes",
};
function colonyFactionDefenseBonus(col) { return col.faction ? (col.faction === "core" ? 2 : 1) : 0; }
function alignColony(fid) {
  const pid = S.location, col = S.colonies[pid], planet = currentPlanet();
  if (!col || !FACTIONS[fid] || col.faction === fid) return;
  if ((S.rep[fid] || 0) < ALIGN_REP_REQ) return toast(`${FACTIONS[fid].name} won't charter a colony for a stranger — need rep ${ALIGN_REP_REQ}+.`, "bad");
  if ((S.res.influence || 0) < ALIGN_COST_INF) return toast(`Need ${ALIGN_COST_INF} influence to push the petition through.`, "bad");
  if (col.happiness < 40) return toast("The colonists are too unhappy to rally behind a banner (need 40+ happiness).", "bad");
  const old = col.faction;
  S.res.influence -= ALIGN_COST_INF;
  col.faction = fid;
  addRep(fid, 8);
  Object.keys(FACTIONS).forEach(o => { if (o !== fid && o !== old) addRep(o, -3); });
  if (old) addRep(old, -10);
  const F = FACTIONS[fid];
  log(`${F.ico} <span class="c">${planet.name}</span> has joined the <b>${F.name}</b>${old ? ` — the ${FACTIONS[old].name} are furious` : ""}. Their trade network and patrols now serve the colony.`, "event");
  toast(`${planet.name} joins the ${F.name}!`, "event");
  jot(`${planet.name} raised the colors of the ${F.name} — commerce, protection, and a bloc's expectations.`, "colony");
  afterAction();
}
function colonyIndependence() {
  const pid = S.location, col = S.colonies[pid], planet = currentPlanet();
  if (!col || !col.faction) return;
  const old = col.faction;
  col.faction = null;
  addRep(old, -10);
  col.unrest = (col.unrest || 0) + 1;
  col.happiness = Math.max(0, col.happiness - 8);
  log(`🏳️ <span class="c">${planet.name}</span> declares independence from the ${FACTIONS[old].name}. The bloc takes it badly, and the streets are tense.`, "bad");
  toast(`${planet.name} goes independent.`, "bad");
  afterAction();
}
function canColonize() { return !!S.techs.colonial; }
function colonize() {
  const pid = S.location, planet = currentPlanet();
  if (!canColonize()) return toast("Research Colonial Charter first.", "bad");
  if (!planet.colonizable) return toast("This world cannot be colonized.", "bad");
  if (S.colonies[pid]) return;
  if (S.rivalClaims && S.rivalClaims[pid]) return toast("A rival captain already claimed this world.", "bad");
  if (S.terraforming && S.terraforming[pid]) return toast("Terraforming is still underway here — wait for it to complete.", "bad");
  if (S.res.credits < COLONY_FOUNDATION_COST) return toast("Not enough credits.", "bad");
  if (!canAfford(COLONY_FOUNDATION_MATS)) return toast("Need materials in your hold: metals & goods.", "bad");
  S.res.credits -= COLONY_FOUNDATION_COST; pay(COLONY_FOUNDATION_MATS);
  S.colonies[pid] = { pop: 5, happiness: 70, tax: 10, buildings: {}, storage: {}, orders: {}, unrest: 0, faction: null, idle: {} };
  log(`🌍 Founded a colony on <span class="c">${planet.name}</span>! It will grow as you develop it.`, "event");
  toast("Colony founded!", "event");
  afterAction();
}
function buildColonyBuilding(buildingId) {
  const pid = S.location, col = S.colonies[pid];
  if (!col) return;
  const planet = currentPlanet();
  const def = colonyBuildingList(planet).find(b => b.id === buildingId);
  if (!def) return;
  if (def.req && !S.techs[def.req]) return toast(`Requires the ${(TECHS.find(t => t.id === def.req) || {}).name || def.req} technology.`, "bad");
  const tier = col.buildings[buildingId] || 0;
  if (tier >= def.tiers) return;
  const cost = Math.round(def.baseCost * Math.pow(def.costMul, tier));
  const mats = colonyBuildingMats(def, tier + 1);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => COM[c].name).join(", ") + ".", "bad");
  S.res.credits -= cost; pay(mats);
  col.buildings[buildingId] = tier + 1;
  log(`Built ${def.ico} ${def.name} (Tier ${tier + 1}) on ${planet.name}.`, "good");
  toast(`${def.name} → Tier ${tier + 1}`, "good");
  afterAction();
}

/* ---------- Colonies, continued: tax/cargo actions and the per-cycle simulation ---------- */
function setTax(delta) {
  const col = S.colonies[S.location];
  if (!col) return;
  col.tax = Math.max(0, Math.min(50, col.tax + delta));
  afterAction();
}
function colonyDeposit(c) {
  if (combatLocked()) return;
  const col = S.colonies[S.location];
  if (!col) return;
  let qty = Math.min(+document.getElementById("col-" + c).value || 0, S.res[c] || 0);
  qty = Math.floor(Math.max(0, qty));
  qty = Math.min(qty, colonyStorageCap(col, currentPlanet()) - colonyStorageUsed(col));
  if (qty <= 0) return toast("Nothing to store (or colony full).", "bad");
  S.res[c] -= qty; col.storage[c] = (col.storage[c] || 0) + qty;
  log(`Delivered ${qty} ${COM[c].ico} ${COM[c].name} to ${currentPlanet().name} colony.`);
  afterAction();
}
function colonyWithdraw(c) {
  if (combatLocked()) return;
  const col = S.colonies[S.location];
  if (!col) return;
  let qty = Math.min(+document.getElementById("col-" + c).value || 0, col.storage[c] || 0);
  const space = COM[c].isFuel ? (fuelCap() - S.res.fuel) : cargoFree();   // fuel to the tank, else the hold
  qty = Math.floor(Math.max(0, Math.min(qty, space)));
  if (qty <= 0) return toast(COM[c].isFuel ? "Nothing to withdraw (or tank full)." : "Nothing to withdraw (or hold full).", "bad");
  col.storage[c] -= qty; S.res[c] += qty;
  log(`Withdrew ${qty} ${COM[c].ico} ${COM[c].name} from ${currentPlanet().name} colony.`);
  afterAction();
}

/* runs every cycle — colonies live and grow on their own */
function processColonies() {
  const seceded = [];
  Object.entries(S.colonies).forEach(([pid, col]) => {
    const planet = PLANETS.find(p => p.id === pid);
    const cap = colonyStorageCap(col, planet);
    const store = (c, q) => { const add = Math.min(q, cap - colonyStorageUsed(col)); if (add > 0) { col.storage[c] = (col.storage[c] || 0) + add; digestProd(c, add); } };
    let foodMade = 0;   // net food (biomass) produced this cycle — sets the colony's carrying capacity

    // 1a) raw producers (farm, extractors) + passive research run first
    colonyBuildingList(planet).forEach(b => {
      const t = col.buildings[b.id] || 0; if (t <= 0) return;
      if (col.idle && col.idle[b.id]) return;                             // paused by the governor — no inputs consumed, no output
      if (b.id === "lab") { S.res.tech += t * 3; return; }                 // passive research
      if (b.id === "datacenter") { S.res.tech += t * 2; }                    // machine minds crunch data too (recipe still runs below)
      if (b.id === "scrubber") { if (S.pollution && S.pollution[pid]) S.pollution[pid] = Math.max(0, S.pollution[pid] - t * 1.2); return; }
      if (b.recipe) return;                                               // industry chain handled in 1b
      if (b.produces) {
        let out;
        if (b.id === "farm") out = Math.round(t * 8 * pollutionFarmMult(pid) * (col.faction === "agri" ? 1.25 : 1) * colonyWorkforceMult(col) * colonyUnrestMult(col) * colonySurgeMult(col));   // smog withers crops; Agri-Combine agronomists boost them
        else {
          out = Math.round(t * 5 * (planet.deposits[b.produces] || 1) * depletionMult(pid, b.produces) * pollutionYieldMult(pid) * colonyWorkforceMult(col) * colonyUnrestMult(col) * colonySurgeMult(col));
          drawReserve(pid, b.produces, out);
          if (out > 0 && b.pollute) addPollution(pid, b.pollute * t);
        }
        if (b.produces === COLONY_FOOD) foodMade += out;
        const ceiling = b.produces === COLONY_FOOD
          ? Math.max(Math.floor(cap * 0.4), col.pop * 3)                   // always room to stockpile food for the population
          : Math.floor(cap * 0.15);                                       // other sources self-limit so by-products can't clog the chain
        store(b.produces, Math.min(out, Math.max(0, ceiling - (col.storage[b.produces] || 0))));
      }
    });
    // 1b) industry chain in dependency order (power → refining → components → assembly),
    //     so a full ore→metals→alloys→goods line can cascade within a single cycle
    colonyBuildingList(planet).filter(b => b.recipe).sort((a, b) => a.recipe.stage - b.recipe.stage).forEach(b => {
      const t = col.buildings[b.id] || 0; if (t <= 0) return;
      if (col.idle && col.idle[b.id]) return;                             // paused — the line is idle this cycle
      const r = b.recipe;
      // Math.round, not floor: a tier-1/rate-1 building's single nominal batch shouldn't
      // vanish to 0 from a moderate workforce/unrest dip — larger multi-batch lines still
      // feel the multiplier proportionally (e.g. 15 nominal * 0.625 workforce -> 9, not 15)
      let batches = Math.round(t * r.rate * colonyWorkforceMult(col) * colonyUnrestMult(col) * colonyAutomationMult(planet) * colonySurgeMult(col));
      Object.entries(r.in).forEach(([c, q]) => { batches = Math.min(batches, Math.floor((col.storage[c] || 0) / q)); });
      const net = r.outQty - Object.values(r.in).reduce((s, q) => s + q, 0); // only net growth needs free space
      if (net > 0) batches = Math.min(batches, Math.floor((cap - colonyStorageUsed(col)) / net));
      if (batches <= 0) return;
      Object.entries(r.in).forEach(([c, q]) => { col.storage[c] -= batches * q; });
      if (r.in[COLONY_FOOD]) foodMade -= batches * r.in[COLONY_FOOD];      // food burned by industry can't feed people
      store(r.out, batches * r.outQty);
      S.made = S.made || {}; S.made[r.out] = true;
      if (b.pollute) addPollution(pid, b.pollute * t);                     // industry fouls the world it runs on
      // fission flavor: a hard-run reactor can suffer a containment scare
      if (b.id === "reactor" && Math.random() < 0.012 * t) {
        col.storage.energy = Math.floor((col.storage.energy || 0) * 0.4);
        col.happiness = Math.max(0, col.happiness - 10);
        log(`☢️ A containment scare at <span class="c">${planet.name}</span>'s reactor vented power and rattled the colony.`, "bad");
      }
    });
    // surplus Energy is vented to the grid, never hoarded — keeps storage clear for materials
    const ENERGY_BUFFER = 120;
    if ((col.storage.energy || 0) > ENERGY_BUFFER) col.storage.energy = ENERGY_BUFFER;

    // 1c) labor relief effects tick down on their own clocks
    if (col.surge && --col.surge.cyclesLeft <= 0) {
      log(`⏱️ The production surge on <span class="c">${planet.name}</span> has ended.`, "");
      col.surge = null;
    }
    if (col.perkCooldown > 0) col.perkCooldown--;

    // 2) population eats food (biomass)
    const need = col.pop;
    const have = col.storage[COLONY_FOOD] || 0;
    const eaten = Math.min(need, have);
    col.storage[COLONY_FOOD] = have - eaten;
    const fed = eaten >= need;

    // 3) happiness drifts toward a target
    let target = 55;
    target += fed ? 18 : -35;
    if ((col.storage.goods || 0) >= col.pop) target += 12;     // consumer goods keep folk happy
    if ((col.storage.luxury || 0) > 0) target += 6;
    if ((col.storage.medicine || 0) > 0) target += 6;          // healthcare keeps colonists well
    target -= col.tax * 0.8;
    target -= pollutionOf(pid) * 0.12;                         // nobody loves living in smog
    if (col.faction) target += 6;                              // a bloc's backing steadies morale
    target = Math.max(0, Math.min(100, target));
    col.happiness = Math.round(col.happiness + (target - col.happiness) * 0.34);

    // 4) population tracks its food supply gracefully — grow only into genuine local
    //    food surplus (never overshoot), and emigrate rather than collapse when food falls short
    const housing = colonyHousing(col, planet);
    const granaryBuffer = Math.floor((col.storage[COLONY_FOOD] || 0) / GRANARY_BUFFER_CYCLES);   // a stocked granary sustains growth beyond this cycle's raw harvest alone
    const carrying = Math.min(housing, foodMade + granaryBuffer);   // people the harvest AND its stockpile can sustain
    if (fed && col.happiness >= 60 && col.pop < carrying) {
      col.pop += Math.max(1, Math.round(col.pop * 0.05));      // room to grow: spare food AND housing
    } else if (!fed) {
      col.pop = Math.max(1, col.pop - Math.max(1, Math.round((need - eaten) * 0.3))); // shortfall → gentle emigration
    } else if (col.happiness < 32) {
      col.pop = Math.max(1, col.pop - 1);                      // misery slowly drives folk away
    }
    col.pop = Math.min(col.pop, housing);

    // 5) tax income
    const income = colonyTaxIncome(col);
    if (income > 0) { S.res.credits += income; cycleLedger("colony tax", income); }
    if (col.faction && S.turn % 5 === 0) addRep(col.faction, 1);   // loyal colonies endear you to their bloc

    // 5a-bis) your bases get first claim on finished goods before the colony sells the rest
    runBaseImport(col, pid, planet);
    // 5b) the spaceport exports surplus manufactured goods for credits (keeping happiness reserves)
    const sp = spaceportTier(col);
    if (sp > 0) {
      const reserve = { goods: col.pop, luxury: Math.ceil(col.pop / 3), medicine: Math.ceil(col.pop / 3) };
      const exportable = CARGO_IDS                                  // only finished products — intermediates stay for the chain
        .filter(c => ["Finished", "Luxury", "Strategic"].includes(COM[c].tier) || c === "medicine")
        .sort((a, b) => COM[b].base - COM[a].base);                 // ship the dearest goods first
      let throughput = sp * 6, revenue = 0;
      for (const c of exportable) {
        if (throughput <= 0) break;
        const avail = (col.storage[c] || 0) - (reserve[c] || 0);
        const q = Math.min(Math.max(0, avail), throughput);
        if (q > 0) { col.storage[c] -= q; revenue += Math.round(sellPrice(pid, c) * 0.85 * q); throughput -= q; }
      }
      if (revenue > 0) {
        if (col.faction) revenue = Math.round(revenue * 1.15);     // bloc merchants pay a premium
        S.res.credits += revenue; cycleLedger("colony exports", revenue);
      }
    }

    // 6) random events (raids, disasters, booms)
    colonyEventRoll(pid, col, planet);

    // 6b) heavy pollution breeds industrial incidents
    const poll = pollutionOf(pid);
    if (poll >= 50 && Math.random() < (poll - 40) / 250) {
      col.happiness = Math.max(0, col.happiness - 8);
      const spoiled = Math.floor((col.storage[COLONY_FOOD] || 0) * 0.3);
      if (spoiled > 0) col.storage[COLONY_FOOD] -= spoiled;
      log(`🏭 Industrial smog incident on <span class="c">${planet.name}</span> — crops spoiled and tempers frayed.`, "bad");
    }

    // 7) unrest & secession — a garrison helps keep order
    col.unrest = col.unrest || 0;
    if (col.happiness < 25) col.unrest += 1;
    else if (col.happiness > 45) col.unrest = Math.max(0, col.unrest - 1);
    const revoltAt = 4 + colonyDefense(col);            // garrison delays secession
    if (col.unrest >= revoltAt) {
      seceded.push(pid);
    } else if (col.unrest >= 2) {
      log(`⚠️ Unrest is rising on <span class="c">${planet.name}</span> — its people may secede if conditions don't improve.`, "bad");
    }
    col.pop = Math.max(1, Math.round(col.pop));
  });
  seceded.forEach(pid => {
    const planet = PLANETS.find(p => p.id === pid);
    delete S.colonies[pid];
    log(`💔 The colony on <span class="c">${planet.name}</span> has revolted and declared independence. It is lost.`, "bad");
    toast(`${planet.name} seceded!`, "bad");
    announce(`💔 ${planet.name} Lost`, `Your colony revolted and broke away. Keep your people fed and happy to hold your worlds.`, true);
  });
}

/* ============================================================
   TERRAFORMING  (catalogs.js: TERRAFORM_* constants/cost formulas)
   Reshape an unclaimed colonizable world's own deposits to the player's pick
   before founding a colony there. Unlocked by the "terraform" tech (the tree's
   capstone — biotech + antimatter), same gate as the Concordat Spire
   (sector4x.js's spireUnlocked()), so this is deliberately a late-game power
   option layered ON TOP of ordinary colonize() (unlocked far earlier by
   "colonial"), not a replacement for it.

   Paid in full up front, like colonize()'s own foundation cost, then a
   multi-cycle project ticks down in processTerraforming() (called from
   endTurn(), same shape as production surges / the Spire). No cancel, no
   refund once started — a captain commits ecological engineering crews for
   the duration, sunk cost if abandoned (there's currently no way to abandon
   one short of never landing on that world again).

   PLANETS is static source, re-declared fresh on every load (same as the
   frontier ring / core variance / territory flips) — a completed project is
   recorded into S.terraformed for replayTerraforming() to reapply onto the
   freshly-loaded array, mirroring replayTerritoryFlips() (sector4x.js).
   ============================================================ */
function canTerraform() { return !!S.techs.terraform; }
// eligible now: a colonizable world nobody (including the player) has settled yet,
// with no terraforming project already running on it
function terraformEligible(planet) { return !!(planet && planet.colonizable && !S.colonies[planet.id] && !(S.rivalClaims && S.rivalClaims[planet.id]) && !(S.terraforming && S.terraforming[planet.id])); }
function startTerraforming(resources, tierId) {
  const pid = S.location, planet = currentPlanet();
  if (!canTerraform()) return toast("Research Terraforming first.", "bad");
  if (!terraformEligible(planet)) return toast("This world can't be terraformed right now.", "bad");
  resources = [...new Set(resources || [])].filter(c => COM[c] && COM[c].tier === "Raw");
  if (resources.length < TERRAFORM_MIN_RESOURCES || resources.length > TERRAFORM_MAX_RESOURCES)
    return toast(`Pick ${TERRAFORM_MIN_RESOURCES}-${TERRAFORM_MAX_RESOURCES} resources.`, "bad");
  const tierDef = TERRAFORM_POP_TIERS.find(t => t.id === tierId);
  if (!tierDef) return toast("Pick a population scale.", "bad");
  const cost = terraformCost(resources, tierId), mats = terraformMats(resources, tierId);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  if (!canAfford(mats)) return toast("Need materials in your hold: " + Object.keys(mats).map(c => COM[c].name).join(", ") + ".", "bad");
  S.res.credits -= cost; pay(mats);
  const cycles = terraformCycles(resources, tierId);
  if (!S.terraforming) S.terraforming = {};
  S.terraforming[pid] = { resources, tier: tierId, cyclesLeft: cycles, total: cycles };
  log(`🌍 Terraforming begins on <span class="c">${planet.name}</span> — ${cycles} cycles to reshape it into a ${tierDef.name.toLowerCase()} yielding ${resources.map(c => COM[c].name).join(", ")}. This is a sunk cost — there's no aborting partway.`, "event");
  toast(`Terraforming underway at ${planet.name}`, "event");
  afterAction();
}
/* runs every cycle — ticks every project toward completion, permanently reshaping the world when one finishes */
function processTerraforming() {
  if (!S.terraforming) return;
  Object.entries(S.terraforming).forEach(([pid, proj]) => {
    if (--proj.cyclesLeft > 0) return;
    const planet = PLANETS.find(p => p.id === pid);
    const tierDef = TERRAFORM_POP_TIERS.find(t => t.id === proj.tier);
    const yieldEach = TERRAFORM_YIELD_PER_COUNT[proj.resources.length] || 1;
    const deposits = {};
    proj.resources.forEach(c => deposits[c] = yieldEach);
    planet.deposits = deposits;
    planet.colonizable = true;
    planet.terraformed = true;
    planet.terraformHousing = tierDef.housing;
    if (!S.terraformed) S.terraformed = {};
    S.terraformed[pid] = { resources: proj.resources.slice(), tier: proj.tier };
    delete S.terraforming[pid];
    log(`🌍✨ Terraforming complete at <span class="c">${planet.name}</span> — now yielding ${proj.resources.map(c => COM[c].ico + " " + COM[c].name).join(", ")}. Ready to found a colony.`, "event");
    toast(`${planet.name} terraformed!`, "good");
    announce(`🌍 ${planet.name} Reshaped`, `Terraforming complete — found your colony whenever you're ready.`, true);
  });
}
// PLANETS is rebuilt fresh on every load — reapply every completed terraforming
// project's deposit override. Called from init(), after generateFrontierRing()/
// applyCoreVariance() (which would otherwise clobber it) and replayTerritoryFlips().
function replayTerraforming() {
  Object.entries(S.terraformed || {}).forEach(([pid, rec]) => {
    const p = PLANETS.find(x => x.id === pid); if (!p) return;
    const tierDef = TERRAFORM_POP_TIERS.find(t => t.id === rec.tier);
    const yieldEach = TERRAFORM_YIELD_PER_COUNT[rec.resources.length] || 1;
    const deposits = {};
    rec.resources.forEach(c => deposits[c] = yieldEach);
    p.deposits = deposits;
    p.colonizable = true;
    p.terraformed = true;
    p.terraformHousing = tierDef ? tierDef.housing : 0;
  });
}

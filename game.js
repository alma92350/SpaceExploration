/* ============================================================
   STELLAR FRONTIER — a space exploration & economy game
   Pure vanilla JS. No dependencies. State persists to localStorage.

   v2 — "Deep Economy": tiered commodity chains, location-bound
   extraction (mine / forage / capture / exploit), multi-step
   production, factions + reputation, contraband & smuggling,
   and governor trade decrees.

   Loaded last, after every other script: data.js and galaxygen.js (static
   tables and procedural galaxy generation — see docs/GALAXYGEN.md),
   catalogs.js (Upgrades/Techs/Missions/Offices/Orgs/Bills/base & colony
   building catalogs), crises.js, state.js, pricing.js, feedback.js,
   resources.js, combat.js, pirateBands.js, raiding.js, sector4x.js,
   outlaw.js, politics.js, economy.js, colonization.js, fleet.js,
   fortunes.js, frontier.js, mandates.js, escort.js, renderCore.js,
   renderProgression.js and renderCombat.js (rendering slices 1-3 —
   chrome/Galaxy, Market/Industry/Research/Politics/Missions, and
   Raid/Contacts/Ship; the rest of RENDERING is still below, pending
   its own future slices). This file assumes all of them are already
   loaded.
   ============================================================ */

"use strict";

function afterAction() { checkWin(); checkMilestones(); saveGame(); renderAll(); }

/* ---------- Player Fleet rendering — the rest of this domain lives in fleet.js;
   this stays behind with the other render* functions for the eventual rendering slice ---------- */
let fleetMissionForm = { ship: null, planet: null, task: "cull", dur: 6 };
function setFleetMissionField(k, v) { fleetMissionForm[k] = (k === "dur") ? (parseInt(v, 10) || 6) : v; renderFleet(); }
let fleetLogiForm = { planet: null };
function setFleetLogiField(k, v) { fleetLogiForm[k] = v; renderFleet(); }
function renderFleet() {
  const el = (typeof document !== "undefined") && document.getElementById("panel-fleet"); if (!el) return;
  const f = fleetList(), pid = S.location, col = S.colonies && S.colonies[pid], yard = colonyShipyardTier(pid);
  const bar = (h, m) => { const pct = Math.max(0, Math.round(h / m * 100)), col2 = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)"; return `<div class="bar"><span style="width:${pct}%;background:${col2}"></span></div>`; };
  const shipRow = s => {
    const def = FLEET_SHIPS[s.key]; if (!def) return "";
    const homeName = (PLANETS.find(p => p.id === s.home) || {}).name || "—", here = s.home === pid && yard > 0, rc = fleetRepairCost(s);
    const onMission = s.status === "mission" && s.mission, onLogi = s.status === "logistics";
    const status = s.status === "building" ? `<span style="color:var(--warn)">🏗️ building (${s.buildLeft} cyc)</span>`
      : onMission ? `<span style="color:var(--accent)">🎯 ${MANDATE_TASKS[s.mission.task].name} @ ${mdPlanetName(s.mission.planet)} (${s.mission.cyclesLeft} cyc · +${fmt(s.mission.accrued)} cr)</span>`
      : s.status === "escort" ? `<span style="color:var(--accent)">🛡️ escorting a convoy</span>`
      : onLogi ? `<span style="color:var(--accent)">${def.role === "freighter" ? "🚚 hauling for" : "🛡️ guarding"} ${mdPlanetName(s.station)}</span>`
      : `<span style="color:var(--good)">idle</span>`;
    const repBtn = (s.status === "idle" && rc.miss > 0 && here) ? `<button class="btn btn-sm" title="Repair at home shipyard" onclick="repairFleetShip('${s.id}')">🔧 ${fmt(rc.credits)}</button>` : "";
    const ctlBtn = onMission ? `<button class="btn btn-sm" title="Recall — bank what it's earned" onclick="recallFleetMission('${s.id}')">↩ Recall</button>`
      : onLogi ? `<button class="btn btn-sm" title="Recall from logistics duty" onclick="recallLogistics('${s.id}')">↩ Recall</button>`
      : s.status === "building" || s.status === "escort" ? "" : `<button class="btn btn-sm btn-bad" title="Scrap this ship (salvage some metals)" onclick="scrapShip('${s.id}')">♻️</button>`;
    const spec = def.role === "warship" ? `🔥${fleetShipStr(def)} · 🛡️${s.hullMax}` : `📦${def.cap} cargo`;
    return `<div class="ship-stat" style="align-items:center">
      <span class="k">${def.ico} ${s.name} <span class="hint">${SHIP_CLASSES[def.cls].name} · ${spec} · ⚓ ${homeName}</span></span>
      <span class="v" style="min-width:160px">${s.status === "building" ? status : bar(s.hull, s.hullMax) + `<span class="hint">${status} · ${Math.round(s.hull)}/${s.hullMax}</span>`} ${repBtn}${ctlBtn}</span></div>`;
  };
  const warships = f.filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
  const freighters = f.filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter");
  const roster = `<div class="card"><h4>✦ Your Fleet <span class="hint">${f.length} ship(s) · upkeep ${fmt(fleetUpkeep())} cr/cyc</span></h4>
    ${f.length ? `${warships.length ? `<div class="ship-stat"><span class="k">⚔️ Warships</span></div>${warships.map(shipRow).join("")}` : ""}${freighters.length ? `<div class="ship-stat" style="margin-top:6px"><span class="k">🚚 Freighters</span></div>${freighters.map(shipRow).join("")}` : ""}` : '<div class="hint">No ships yet — lay down a hull at a colony Shipyard below.</div>'}</div>`;
  let yardCard;
  if (!col) yardCard = `<div class="card"><div class="hint">🏗️ Dock at one of your colonies with a <b>Shipyard</b> to build ships. (Build a Shipyard in the 🌍 Colonies tab — it needs Metallurgy.)</div></div>`;
  else if (yard <= 0) yardCard = `<div class="card"><div class="hint">${currentPlanet().name} has no <b>Shipyard</b>. Build one in the 🌍 Colonies tab (needs Metallurgy) to construct ships here.</div></div>`;
  else {
    const slips = fleetBuildingAt(pid);
    const rows = FLEET_SHIP_KEYS.filter(k => FLEET_SHIPS[k].tier <= yard).map(k => {
      const d = FLEET_SHIPS[k], mats = fleetMatsOf(d), matStr = Object.keys(mats).map(x => `${mats[x]}${COM[x].ico}`).join(" ");
      const ok = (S.res.credits || 0) >= d.cost.credits && canAfford(mats) && slips < yard;
      const spec = d.role === "warship" ? `🔥${fleetShipStr(d)} · 🛡️${fleetShipHullMax(d)}` : `📦${d.cap}`;
      return `<div class="ship-stat" style="align-items:center"><span class="k">${d.ico} ${d.name} <span class="hint">${spec} · ⏱️${d.build} cyc · T${d.tier}</span></span>
        <span class="v"><span class="hint">${fmt(d.cost.credits)} cr ${matStr}</span> <button class="btn btn-sm ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="${slips >= yard ? "All slipways busy" : ""}" onclick="orderShip('${k}')">Build</button></span></div>`;
    }).join("");
    yardCard = `<div class="card"><h4>🏗️ ${currentPlanet().name} Shipyard <span class="hint">Tier ${yard} · slipways ${slips}/${yard}</span></h4>
      <div class="hint">Lay down hulls up to Tier ${yard}; construction takes several cycles and materials come from your hold. A bigger yard adds slipways for parallel builds (upgrade it in the 🌍 Colonies tab).</div>
      ${rows}</div>`;
  }
  // ---- dispatch an idle warship on a system mission (100% of the take) ----
  const idleWar = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
  let missionCard = "";
  if (idleWar.length) {
    const fm = fleetMissionForm;
    if (!fm.ship || !idleWar.some(s => s.id === fm.ship)) fm.ship = idleWar[0].id;
    if (!fm.planet || !PLANETS.find(p => p.id === fm.planet)) fm.planet = S.location;
    const known = PLANETS.filter(p => isActive(p) && galaxyKnown(p));
    const s = fleetList().find(x => x.id === fm.ship), lvl = s ? shipMissionLevel(s) : 2;
    const shipOpts = idleWar.map(x => `<option value="${x.id}" ${x.id === fm.ship ? "selected" : ""}>${FLEET_SHIPS[x.key].ico} ${x.name}</option>`).join("");
    const planetOpts = known.map(p => `<option value="${p.id}" ${p.id === fm.planet ? "selected" : ""}>${p.name}${p.id === S.location ? " (here)" : ""} · ${pirateIntelKnows(p.id) ? pirateLevelLabel(pirateLevel(p.id)) : "activity ❔"}</option>`).join("");
    const taskBtns = Object.keys(MANDATE_TASKS).map(k => { const t = MANDATE_TASKS[k]; return `<button class="btn btn-sm ${fm.task === k ? "btn-primary" : ""}" title="${t.blurb}" onclick="setFleetMissionField('task','${k}')">${t.ico} ${t.name}</button>`; }).join(" ");
    const durBtns = MANDATE_DURATIONS.map(d => `<button class="btn btn-sm ${fm.dur === d ? "btn-primary" : ""}" onclick="setFleetMissionField('dur','${d}')">${d} cyc</button>`).join(" ");
    const t = MANDATE_TASKS[fm.task], est = fleetMissionEst(lvl, fm.planet, fm.task, fm.dur);
    const fac = (PLANETS.find(p => p.id === fm.planet) || {}).faction, sanc = fac && commissionCovers(fac);
    missionCard = `<div class="card"><h4>🎯 Dispatch a warship on a mission</h4>
      <div class="hint">${t.blurb} <b>You keep 100% of the take</b> — no fee, but the ship draws upkeep and risks combat damage (a light hull in an infested system can be lost). Pirate activity shows only for systems you hold intel on (⚔️ Raider charts).</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="hint">Ship</span><select onchange="setFleetMissionField('ship',this.value)">${shipOpts}</select>
        <span class="hint">System</span><select onchange="setFleetMissionField('planet',this.value)">${planetOpts}</select></div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Task</span> ${taskBtns}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Duration</span> ${durBtns}</div>
      <div class="ship-stat" style="margin-top:8px"><span class="k">Your take</span><span class="v">100% · <span class="hint">est. ~${fmt(est)} cr over ${fm.dur} cyc</span></span></div>
      ${t.heat ? `<div class="hint" style="color:${sanc ? "var(--good)" : "var(--bad)"}">${sanc ? `⚖️ Sanctioned by your letter of marque against ${FACTIONS[fac].name} — no Wanted.` : `⚠️ Piracy in your name — raises Wanted${fac ? ` and angers ${FACTIONS[fac].name}` : ""}.`}</div>` : `<div class="hint" style="color:var(--good)">Lawful — suppresses pirate activity at the target.</div>`}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" onclick="assignFleetMission('${fm.ship}','${fm.planet}','${fm.task}',${fm.dur})">🎯 Dispatch (${fm.dur} cyc)</button></div>
    </div>`;
  }
  // ---- logistics duty: station freighters (cheaper transport) + warship guards (cut ambush risk) ----
  const myCols = Object.keys(S.colonies || {});
  let logiCard = "";
  if (myCols.length) {
    const lf = fleetLogiForm; if (!lf.planet || !S.colonies[lf.planet]) lf.planet = myCols[0];
    const colOpts = myCols.map(cid => `<option value="${cid}" ${cid === lf.planet ? "selected" : ""}>${mdPlanetName(cid)} · ${pirateIntelKnows(cid) ? pirateLevelLabel(pirateLevel(cid)) : "activity ❔"}</option>`).join("");
    const feeDisc = Math.round(colonyHaulDiscount(lf.planet) * 100), frDisc = Math.round((1 - colonyFreightMult(lf.planet)) * 100);
    const haulers = colonyHaulers(lf.planet), guards = colonyGuards(lf.planet), plv = pirateLevel(lf.planet);
    const risk = haulers.length ? Math.round((0.05 + plv * 0.04) * Math.pow(0.45, guards.length) * 100) : 0;
    const idleFr = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter");
    const idleWar = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
    const frBtns = idleFr.map(s => `<button class="btn btn-sm btn-good" onclick="assignLogistics('${s.id}','${lf.planet}')">🚚 ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
    const warBtns = idleWar.map(s => `<button class="btn btn-sm" onclick="assignLogistics('${s.id}','${lf.planet}')">🛡️ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
    logiCard = `<div class="card"><h4>🚚 Logistics duty</h4>
      <div class="hint">Station <b>freighters</b> at one of your colonies to haul its goods — cutting its market import fee and base↔colony freight. Pirate-active systems risk an <b>ambush</b> (your freighter takes damage and loses goods); station a <b>warship</b> there to guard the convoy and cut that risk. Activity shows for systems you hold intel on.</div>
      <div class="row" style="margin-top:8px;align-items:center"><span class="hint">Colony</span> <select onchange="setFleetLogiField('planet',this.value)">${colOpts}</select></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Stationed</span><span class="v">${haulers.length} hauler(s) · ${guards.length} guard(s)</span></div>
      <div class="ship-stat"><span class="k">Transport savings</span><span class="v">−${feeDisc}% import fee · −${frDisc}% freight</span></div>
      ${haulers.length ? `<div class="ship-stat"><span class="k">Ambush risk</span><span class="v" style="color:${risk >= 15 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--good)"}">${risk}%/cyc${guards.length ? " (guarded)" : plv > 0 ? " — unguarded!" : ""}</span></div>` : ""}
      ${idleFr.length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign hauler</span> ${frBtns}</div>` : ""}
      ${idleWar.length ? `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign guard</span> ${warBtns}</div>` : ""}
      ${!idleFr.length && !idleWar.length ? '<div class="hint" style="margin-top:6px">No idle ships to assign — build more, or recall some.</div>' : ""}</div>`;
  }
  el.innerHTML = `<h2>✦ Fleet</h2>
    <div class="subtitle">Your own ships, built at colony shipyards — loyal and fully under your command. <b>Freighters</b> to haul your goods, <b>warships</b> to fight or work systems on contract. They cost credits &amp; materials to build and draw upkeep each cycle (see the 💰 Cycle accounts log). Dispatch a warship on a system mission (you keep <b>100%</b>), call ships into your raids/escorts, deploy your whole idle fleet as a raid Battle Group, or station freighters on logistics duty to cut transport costs.</div>
    ${roster}
    ${missionCard}
    ${logiCard}
    ${yardCard}`;
}

/* ---------- Fortunes/Signals rendering — the rest of that domain lives in
   fortunes.js; this stays behind with the other render* functions for the
   eventual rendering slice ---------- */
const FX_DOMAINS = { combat: "⚔️ Combat", economy: "💱 Trade", logistics: "🚀 Logistics", science: "🔬 Science", industry: "🏭 Industry", escort: "🛡️ Escort", politics: "🏛️ Politics", piracy: "🏴‍☠️ Piracy" };
function renderFortunesPanel() {
  const el = (typeof document !== "undefined") && document.getElementById("panel-fortunes"); if (!el) return;
  const act = fxActive();
  const boons = act.filter(f => FX[f.key].kind === "boon"), banes = act.filter(f => FX[f.key].kind === "bane");
  const sig = (Array.isArray(S.signals) ? S.signals : []).slice().sort((a, b) => (b.planet === S.location ? 1 : 0) - (a.planet === S.location ? 1 : 0));
  const seen = S.fxSeen || {}, tierName = ["", "faint", "strong", "rare"];
  const fxCard = f => {
    const d = FX[f.key], good = d.kind === "boon", col = good ? "var(--good)" : "var(--bad)";
    const total = f.dur || f.cyclesLeft, pct = Math.max(4, Math.round(f.cyclesLeft / total * 100)), cc = fxClearCost(f);
    const clr = (d.kind === "bane" && cc) ? `<div class="row" style="margin-top:6px"><button class="btn btn-sm" ${S.res.credits >= cc ? "" : "disabled"} title="Pay to shake it off now — cheaper as it nears its end" onclick="clearFx('${f.key}')">🧹 Clear (${fmt(cc)} cr)</button></div>` : "";
    return `<div class="card" style="border-color:${col}">
      <h4>${d.ico} ${d.name} <span class="pill ${good ? "good" : "bad"}">${tierName[d.tier]} ${good ? "boon" : "bane"}</span></h4>
      <div class="hint">${d.blurb}</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Time left</span><span class="v" style="color:${col}">${f.cyclesLeft} cycle${f.cyclesLeft === 1 ? "" : "s"}</span></div>
      <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>${clr}
    </div>`;
  };
  const sigCard = s => {
    const k = SIGNAL_KINDS[s.kind], here = s.planet === S.location, fuel = SIGNAL_FUEL[s.tier] || 6;
    const dist = here ? 0 : ((currentPlanet().distances || {})[s.planet] || "?");
    const can = here && actionsLeft() > 0 && S.res.fuel >= fuel && !(typeof combatLocked === "function" && combatLocked());
    const ctl = here
      ? `<button class="btn ${can ? "btn-good" : ""}" ${can ? "" : "disabled"} title="Spend 1 action + ${fuel}⛽" onclick="investigateSignal('${s.id}')">🔍 Investigate (${fuel}⛽)</button>`
      : `<button class="btn btn-sm" ${S.res.fuel >= fuelCost(s.planet) ? "" : "disabled"} onclick="travel('${s.planet}')">Travel ▸ ${sigPlanetName(s.planet)} (${dist} ly)</button>`;
    return `<div class="card">
      <h4>${k.ico} ${tierName[s.tier]} signal <span class="pill">${sigPlanetName(s.planet)}${here ? " · here" : ""}</span></h4>
      <div class="hint">${k.blurb}</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Fades in</span><span class="v">${s.ttl} cycle${s.ttl === 1 ? "" : "s"}</span></div>
      <div class="row" style="margin-top:6px">${ctl}</div>
    </div>`;
  };
  const allKeys = Object.keys(FX), seenCount = allKeys.filter(k => seen[k]).length, groups = {};
  allKeys.forEach(k => { (groups[FX[k].domain] = groups[FX[k].domain] || []).push(k); });
  const mastery = S.fxMastery || {}, masteredCount = Object.keys(FX_MASTERY).filter(dn => mastery[dn]).length;
  const almanac = Object.keys(FX_DOMAINS).filter(dn => groups[dn]).map(dn => {
    const keys = groups[dn], sc = keys.filter(k => seen[k]).length, done = !!mastery[dn];
    const badge = done ? `<span class="pill good" title="${FX_MASTERY[dn] ? FX_MASTERY[dn].blurb : ""}">🏅 mastered</span>` : `<span class="hint">${sc}/${keys.length}</span>`;
    const chips = keys.sort((a, b) => (FX[a].tier || 1) - (FX[b].tier || 1)).map(k => {
      const d = FX[k], good = d.kind === "boon";
      return seen[k]
        ? `<span class="pill ${good ? "good" : "bad"}" title="${d.blurb} (${tierName[d.tier]} · ${good ? "boon" : "bane"})">${d.ico} ${d.name}</span>`
        : `<span class="pill" style="opacity:.5" title="Undiscovered — keep exploring &amp; investigating signals to find it">❔ ??? <span style="opacity:.7">(${tierName[d.tier]})</span></span>`;
    }).join(" ");
    return `<div class="ship-stat" style="margin-top:8px"><span class="k">${FX_DOMAINS[dn]} ${badge}</span></div><div style="display:flex;flex-wrap:wrap;gap:4px">${chips}</div>`;
  }).join("");
  const full = sig.length >= SIGNAL_MAX, noAct = actionsLeft() <= 0;
  const scanBtn = (kind) => { const c = SIGNAL_SCAN[kind], ok = !full && !noAct && (S.res.credits || 0) >= c.cost; return `<button class="btn ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="${full ? "Your scope is full of leads" : noAct ? "No actions left" : "Flush a fresh lead onto your scope (1 action)"}" onclick="buySignalScan('${kind}')">${kind === "deep" ? "🛰️" : "📡"} ${c.label} (${fmt(c.cost)} cr)</button>`; };
  el.innerHTML = `<h2>✨ Fortunes</h2>
    <div class="subtitle">Temporary <b>boons &amp; banes</b> you pick up by exploring, sweeping the lanes, and chasing <b>📡 signals</b> — fly to one and <b>🔍 Investigate</b> for a roll. Stronger effects are briefer; the rare, powerful ones are the prize of a hunted signal. Banes always wear off, and many can be 🧹 cleared (cheaper the closer they are to fading). Current phase: <b>${gamePhase()}</b>.</div>
    <div class="card"><h4>Active Fortunes <span class="hint">${act.length}/${FX_MAX_ACTIVE}</span></h4>${act.length ? "" : '<div class="hint">None right now — go find some.</div>'}</div>
    ${act.length ? `<div class="cards">${[...boons, ...banes].map(fxCard).join("")}</div>` : ""}
    <div class="card" style="margin-top:10px"><h4>📡 Signals on your scope <span class="hint">${sig.length}</span></h4>${sig.length ? "" : '<div class="hint">No leads right now. Explore new worlds and sweep the lanes (⚔️ Raider tab) to flush them out.</div>'}</div>
    ${sig.length ? `<div class="cards">${sig.map(sigCard).join("")}</div>` : ""}
    <div class="card" style="margin-top:10px"><h4>🛰️ Sensor Office</h4>
      <div class="hint">Buy intel to flush a fresh lead onto your scope (costs 1 action). A deep scan runs pricier but turns up stronger, rarer signals.</div>
      <div class="row" style="margin-top:6px">${scanBtn("scan")} ${scanBtn("deep")}</div></div>
    <div class="card" style="margin-top:10px"><h4>📖 Almanac <span class="hint">${seenCount}/${allKeys.length} discovered · 🏅 ${masteredCount}/${Object.keys(FX_MASTERY).length} domains mastered</span></h4>
      <div class="hint">Effects you've experienced are revealed; the rest await discovery. Catalogue every effect in a domain for a <b>permanent</b> passive edge.</div>${almanac}</div>`;
}

/* ============================================================
   TURN / EVENTS
   ============================================================ */
const EVENTS = [
  { msg: "Solar flare scrambles markets sector-wide.", type: "event",
    fn: () => COM_IDS.forEach(c => PLANETS.forEach(p => { S.prices[p.id][c] = Math.round(S.prices[p.id][c] * (0.7 + Math.random() * 0.7)); })) },
  { msg: "Pirates ambush your convoy!", type: "bad",
    fn: () => {
      const mit = 1 - S.upgrades.shield * 0.25;
      const target = ["goods", "metals", "electronics", "luxury"].find(c => S.res[c] > 0) || "ore";
      const stolen = Math.min(S.res[target], Math.round(S.res[target] * 0.25 * mit));
      const credLoss = Math.min(S.res.credits, Math.round(80 * mit));
      S.res[target] -= stolen; S.res.credits -= credLoss;
      return ` They grabbed ${stolen} ${COM[target].name} and ${fmt(credLoss)} credits.`;
    } },
  { msg: "A derelict freighter drifts by — salvage recovered.", type: "good",
    fn: () => { const c = 200 + Math.round(Math.random() * 800); S.res.credits += c; return ` +${fmt(c)} credits.`; } },
  { msg: "Bumper harvest — biomass & food prices crash.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].biomass = Math.round(S.prices[p.id].biomass * 0.6); }) },
  { msg: "Ore shortage — metals prices spike.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].metals = Math.round(S.prices[p.id].metals * 1.5); }) },
  { msg: "Energy crisis — power cells in huge demand.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].energy = Math.round(S.prices[p.id].energy * 1.6); }) },
  { msg: "Black-market boom — relics & spice prices surge.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].relics = Math.round(S.prices[p.id].relics * 1.5); S.prices[p.id].spice = Math.round(S.prices[p.id].spice * 1.4); }) },
  { msg: "Scientific breakthrough! Bonus tech points awarded.", type: "good",
    fn: () => { const t = 5 + Math.round(Math.random() * 10); S.res.tech += t; return ` +${t} tech.`; } },
  { msg: "Customs crackdown — enforcement tightens this cycle.", type: "event", fn: () => "" },
];
function maybeEvent() {
  if (Math.random() < 0.45) {
    const e = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const extra = e.fn() || "";
    log("📡 " + e.msg + extra, e.type);
    toast(e.msg, e.type === "bad" ? "bad" : "event");
  }
}
function applyDecreeIncome() {
  if (S.perks.governor && S.decrees.monopoly) {
    const c = S.decrees.monopoly;
    const income = Math.round(COM[c].base * 8);
    S.res.credits += income;
    log(`Monopoly on ${COM[c].ico} ${COM[c].name} paid <span class="c">${fmt(income)}</span> credits this cycle.`, "good");
  }
}
// ---- per-cycle treasury ledger: the recurring automatic flows (tax, upkeep,
// tribute, policy income/cost…) each report here so the cycle's credit moves are
// summarised in one line — no more "credits changed for unknown reasons".
let _cledger = null;
function cycleLedger(cat, amt) { amt = Math.round(amt || 0); if (_cledger && amt) _cledger[cat] = (_cledger[cat] || 0) + amt; }
function reportCycleLedger() {
  const L = _cledger; _cledger = null; if (!L) return;
  const ent = Object.entries(L).filter(([, v]) => v !== 0); if (!ent.length) return;
  const net = ent.reduce((s, [, v]) => s + v, 0);
  const parts = ent.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))} ${k}`);
  log(`💰 Cycle accounts: ${parts.join(" · ")} → net ${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))} cr.`, net >= 0 ? "good" : "bad");
}
// ---- per-cycle digest: a second, separate line rolling up non-financial noise
// (production totals, arrivals/completions, rising threats) into one recap, so
// a busy empire's log doesn't bury the headline in a dozen scattered lines.
let _cdigest = null;
function digestProd(key, qty) { if (_cdigest && qty) _cdigest.production[key] = (_cdigest.production[key] || 0) + qty; }
function digestNote(cat, text) { if (_cdigest && _cdigest[cat]) _cdigest[cat].push(text); }
function reportCycleDigest() {
  const D = _cdigest; _cdigest = null; if (!D) return;
  const parts = [];
  const prodKeys = Object.keys(D.production);
  if (prodKeys.length) parts.push(`🏭 produced ${prodKeys.map(c => `${fmt(D.production[c])}${COM[c] ? COM[c].ico : ""}`).join(" ")}`);
  if (D.arrivals.length) parts.push(`✅ ${D.arrivals.join(", ")}`);
  if (D.threats.length) parts.push(`⚠️ ${D.threats.join(", ")}`);
  if (D.sector && D.sector.length) parts.push(`🌐 ${D.sector.join(", ")}`);
  if (!parts.length) return;
  log(`📋 Cycle ${S.turn} recap: ${parts.join(" · ")}.`, "");
}
function endTurn(fromTravel = false) {
  if (!fromTravel && combatLocked()) return;
  S.turn++; S.actionsUsed = 0; _cledger = {}; _cdigest = { production: {}, arrivals: [], threats: [], sector: [] };
  if (S.jail > 0) { S.jail--; log(`⛓️ You serve a cycle in detention (${S.jail} remaining).`, "bad"); }
  processFx(); processSignals();
  processCrises(); processPirates(); processPirateHavens(); processFactionRelations(); processTerritoryContest(); rollPrices(); processReserves(); processPollution(); applyDecreeIncome(); applyPolicyEffects(); processPlanetLaws(); processOrgs(); processInvestigation(); processOffice(); processWanted(); processHaven(); processCommission(); processBases(); processBaseTrade(); processLogistics(); processColonies(); finalizeBaseTrade(); expireContracts(); maybeGenContract(); maybeEvent(); maybeFortune(); maybeSignal();
  if (typeof escortDeadlineCheck === "function") escortDeadlineCheck();
  if (typeof decayBands === "function") decayBands();
  if (typeof processBandSupport === "function") processBandSupport();
  if (typeof processMandates === "function") processMandates();
  if (typeof processTruces === "function") processTruces();
  if (typeof processFleet === "function") processFleet();
  reportCycleLedger();
  reportCycleDigest();
  if (!fromTravel) log(`— Cycle ${S.turn} begins —`);
  checkWin(); checkMilestones(); saveGame(); renderAll();
}

/* ============================================================
   RENDERING
   ============================================================ */

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
        : (tier > 0 ? `+${moduleOutput(planet, m, tier)} ${COM[m.produces].ico}/cycle` : "not built");
      const nxt = m.storage ? "+250 storage"
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
  chem_plant: "industry", foundry: "industry", fabricator: "industry", factory: "industry",
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
    const govCard = `<div class="card">
      <h4>🏛️ ${planet.name} Colony ${colonyHealthPill(col)}</h4>
      <div class="ship-stat"><span class="k">👥 Population</span><span class="v">${fmt(col.pop)}k / ${fmt(housing)}k</span></div>
      <div class="bar"><span style="width:${Math.min(100, col.pop / housing * 100)}%"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">😊 Happiness</span><span class="v">${col.happiness}%</span></div>
      <div class="bar"><span style="width:${col.happiness}%;background:${col.happiness>=60?'var(--good)':col.happiness>=35?'var(--warn)':'var(--bad)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🌾 Food / cycle</span><span class="v" style="color:${fedHave>=fedNeed?'var(--good)':'var(--bad)'}">${fmt(fedHave)} stored · need ${fmt(fedNeed)}</span></div>
      <div class="ship-stat"><span class="k">☁️ Pollution</span><span class="v" style="color:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}">${Math.round(pollutionOf(planet.id))}</span></div>
      <div class="bar"><span style="width:${pollutionOf(planet.id)}%;background:${pollutionOf(planet.id)>=60?'var(--bad)':pollutionOf(planet.id)>=25?'var(--warn)':'var(--good)'}"></span></div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">🏭 Industry</span><span class="v">${effIndustry(planet)}</span></div>
      <div class="ship-stat"><span class="k">🔬 Tech</span><span class="v">${effTech(planet)}</span></div>
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

/* ---------- Convoy Escort rendering — the rest of this domain lives in
   escort.js; this stays behind with the other render* functions for the
   eventual rendering slice ---------- */
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
      `<div class="ship-stat" style="align-items:center"><span class="k">✦ ${FLEET_SHIPS[s.key].ico} ${s.name} <span class="hint">your ${SHIP_CLASSES[FLEET_SHIPS[s.key].cls].name} · 🔥${fleetShipStr(FLEET_SHIPS[s.key])}</span></span>
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
function renderAll() {
  if (typeof document === "undefined") return;
  checkUnlocks(); checkDisclosure(); applyTabVisibility();
  renderResources(); renderShip(); renderGalaxy(); renderMarket();
  renderIndustry(); renderResearch(); renderMissions(); renderPolitics(); renderBases(); renderColonies(); renderRaid(); renderEscort(); renderContacts(); renderShipPanel(); renderFortunesPanel(); renderFleet(); renderOps(); renderLog();
  const tn = document.getElementById("turn"); if (tn) tn.textContent = S.turn;
}

/* ============================================================
   TABS / PERSISTENCE / INIT
   ============================================================ */
/* ============================================================
   PROGRESSIVE DISCLOSURE — reveal features as the captain grows, so a new
   player meets three tabs, not ten. Unlocks are action-driven (what you hold,
   research, earn) with cycle-count fallbacks so nothing hides forever. The
   next 1-2 locked tabs show as 🔒 teasers; the rest stay hidden until near.
   ============================================================ */
const ALWAYS_TABS = ["galaxy", "market", "ship"];
const TAB_LADDER = [
  { id: "missions",  blurb: "contracts, missions & your legacy goals",
    hint: "Unlocks with your first contract", test: s => s.contracts.length > 0 || s.turn >= 2 },
  { id: "research",  blurb: "spend tech points to unlock technologies",
    hint: "Unlocks once you earn tech points", test: s => (s.res.tech || 0) > 0 || s.turn >= 3 },
  { id: "fortunes",  blurb: "track temporary boons & banes and the signals you hunt",
    hint: "Unlocks once a Fortune or a signal turns up", test: s => (Array.isArray(s.fx) && s.fx.length > 0) || (Array.isArray(s.signals) && s.signals.length > 0) || (s.fxSeen && Object.keys(s.fxSeen).length > 0) || s.turn >= 6 },
  { id: "industry",  blurb: "refine raw materials into finished goods",
    hint: "Unlocks when you carry raw materials", test: s => RAW_IDS.some(c => (s.res[c] || 0) > 0) || s.turn >= 4 },
  { id: "raid",      blurb: "hunt pirates or prey on shipping",
    hint: "Unlocks as your trade empire grows (35,000 cr in sales) — or the moment you arm up or get attacked", test: s => (s.upgrades.cannons || 0) > 0 || s.prey || s.encounter || s.interdiction || (s.stats && s.stats.sales >= 35000) || s.turn >= 70 },
  { id: "escort",    blurb: "command a fleet and escort convoys for hire",
    hint: "An expert posting — prove yourself in combat first (12 kills/raids, or earn a Letter of Marque)", test: s => !!(s.unlocked && s.unlocked.raid) && !!s.pirate && (((s.pirate.bountyKills || 0) + (s.pirate.raids || 0)) >= 12 || (s.pirate.commissionsDone || 0) > 0) },
  { id: "contacts",  blurb: "manage your relationships with pirate bands",
    hint: "Unlocks once you've crossed paths with a pirate band", test: s => Object.keys(s.pirateBands || {}).length > 0 },
  { id: "bases",     blurb: "automated off-world production",
    hint: "Unlocks once you can afford a base (~5,000 cr)", test: s => (s.res.credits || 0) >= 5000 || Object.keys(s.bases || {}).length > 0 || s.turn >= 7 },
  { id: "politics",  blurb: "factions, influence, office & law",
    hint: "Unlocks once you're an established trader (50,000 cr in sales) — or you gain influence/office", test: s => (s.res.influence || 0) > 0 || s.office > 0 || (s.orgs && s.orgs.party) || (s.stats && s.stats.sales >= 50000) || s.turn >= 85 },
  { id: "colonies",  blurb: "found and grow your own worlds",
    hint: "Unlocks with the Colonial Charter (Research)", test: s => !!s.techs.colonial || currentPlanet().colonizable || Object.keys(s.colonies || {}).length > 0 },
  { id: "fleet",     blurb: "build your own ships at colony shipyards",
    hint: "Unlocks once you have a colony (build a Shipyard there)", test: s => Object.keys(s.colonies || {}).length > 0 || (Array.isArray(s.fleet) && s.fleet.length > 0) },
];
const RAW_IDS = ["ore", "crystals", "radioactives", "ice", "biomass", "spice", "gas", "relics"];
function tabUnlocked(id) { return S.showAllTabs || ALWAYS_TABS.includes(id) || !!(S.unlocked && S.unlocked[id]); }
function tabHint(id) { const g = TAB_LADDER.find(t => t.id === id); return g ? g.hint : ""; }
function unlock(id, announceIt) {
  if (!S.unlocked) S.unlocked = {};
  if (S.unlocked[id] || ALWAYS_TABS.includes(id)) return;
  S.unlocked[id] = true;
  const g = TAB_LADDER.find(t => t.id === id);
  if (g && announceIt !== false) {
    const lbl = tabLabel(id);
    log(`🔓 New feature unlocked: <b>${lbl}</b> — ${g.blurb}.`, "event");
    if (typeof toast === "function") toast(`🔓 Unlocked: ${lbl}`, "good");
  }
}
/* ---------- Feature disclosure (level-dependent UI) ----------
   Beyond tab unlocks, whole swathes of UI stay hidden until the player reaches
   the milestone that makes them relevant — each paired with a guiding objective
   (shown under Missions → Next Steps) and a cycle fallback so nothing hides
   forever. Phase 1: the market opens up once you manufacture your first Medicine. */
const DISCLOSURE_GATES = [
  { id: "advMarkets", icon: "🧪", goal: "Manufacture your first Medicine",
    reward: "Opens the full market — components, finished goods, luxuries & strategics",
    done: s => !!(s.made && s.made.medicine), fallbackTurn: 15 },
];
function checkDisclosure(silent) {
  if (!S.disc) S.disc = {};
  DISCLOSURE_GATES.forEach(g => {
    if (S.disc[g.id]) return;
    if (g.done(S) || (g.fallbackTurn && S.turn >= g.fallbackTurn)) {
      S.disc[g.id] = true;
      if (!silent) { log(`🔓 ${g.reward}.`, "event"); if (typeof toast === "function") toast("🔓 " + g.reward, "good"); }
    }
  });
}
// which market tiers are visible — Raw & Refined always; the rest after first Medicine
function tierRevealed(tier) {
  if (tier === "Raw" || tier === "Refined") return true;
  if (S.showAllTabs) return true;
  return !!(S.disc && S.disc.advMarkets);
}
function checkUnlocks(silent) {
  if (!S.unlocked) S.unlocked = {};
  TAB_LADDER.forEach(g => { if (!S.unlocked[g.id] && g.test(S)) unlock(g.id, !silent); });
}
function tabLabel(id) {
  const el = typeof document !== "undefined" && document.querySelector(`.tab[data-tab="${id}"]`);
  return (el && (el.dataset.label || el.textContent)) || id;
}
function applyTabVisibility() {
  if (typeof document === "undefined") return;
  const btns = Array.from(document.querySelectorAll(".tab"));
  // how many locked ladder tabs to tease (next 2 in ladder order)
  const lockedLadder = TAB_LADDER.filter(g => !tabUnlocked(g.id));
  const teasers = new Set(lockedLadder.slice(0, 2).map(g => g.id));
  btns.forEach(btn => {
    const id = btn.dataset.tab;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    const base = btn.dataset.label;
    if (tabUnlocked(id)) {
      btn.style.display = ""; btn.textContent = base; btn.classList.remove("locked");
      if (inCombat() && id !== combatHomeTab()) { btn.style.opacity = "0.4"; btn.title = "⚔️ Resolve the current engagement first"; btn.classList.add("combat-lock"); }
      else { btn.style.opacity = ""; btn.title = ""; btn.classList.remove("combat-lock"); }
    }
    else if (teasers.has(id)) { btn.style.display = ""; btn.style.opacity = "0.45"; btn.title = "🔒 " + tabHint(id); btn.textContent = "🔒 " + base; btn.classList.add("locked"); }
    else { btn.style.display = "none"; }
  });
}
function toggleShowAllTabs() {
  S.showAllTabs = !S.showAllTabs;
  if (typeof toast === "function") toast(S.showAllTabs ? "Everything revealed — all features shown." : "Guided mode on — features unlock as you progress.", "good");
  applyTabVisibility(); saveGame();
}
function setTab(name) {
  // surface the combat lock early: while engaged you can't leave the active battle tab
  if (typeof document !== "undefined" && name !== combatHomeTab() && combatLocked()) return;
  if (typeof document !== "undefined" && !tabUnlocked(name)) {
    if (typeof toast === "function") toast("🔒 " + (tabHint(name) || "Not available yet."), "bad");
    return;
  }
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("panel-" + name).classList.remove("hidden");
}
/* ============================================================
   VERSION CHECK — poll the server for a newer build and tell the player
   whether refreshing will keep their saved game (credits, colonies, …).
   On each release, bump APP_VERSION here AND version.json to match — AND the
   ?v= query on game.js / style.css in index.html, so browsers fetch the new
   build instead of a cached copy. Bump SAVE_VERSION (and the SAVE_KEY suffix)
   ONLY when a release breaks old saves.
   ============================================================ */
const APP_VERSION = "2.75.0";
const SAVE_VERSION = "v2";                       // matches the suffix of SAVE_KEY below
/* ---- Changelog: what a returning player sees in the "What's New" panel.
   Newest first. Add one line per release — this is separate from the single
   current-version blurb in version.json (which drives the live update banner). ---- */
const CHANGELOG = [
  { version: "2.75.0", notes: "Internal: split the third slice of the rendering layer — the Raid, Contacts, and Ship tabs — out into their own file, renderCombat.js — slice 24 of the game.js split. No gameplay changes." },
  { version: "2.74.0", notes: "Internal: split the second slice of the rendering layer — the Market, Industry, Research, Politics, and Missions tabs — out into their own file, renderProgression.js — slice 23 of the game.js split. No gameplay changes." },
  { version: "2.73.0", notes: "Internal: split the first slice of the rendering layer — the always-visible UI chrome (resources bar, ship stats, operations digest, log) and the Galaxy tab — out into its own file, renderCore.js — slice 22 of the game.js split. No gameplay changes." },
  { version: "2.72.0", notes: "Internal: split Convoy Escort (the expert-gated fleet-command tab) out into its own file, escort.js — slice 21 of the game.js split. No gameplay changes." },
  { version: "2.71.0", notes: "Internal: split Mandates (commission a pirate band to work a system) out into its own file, mandates.js — slice 20 of the game.js split. No gameplay changes." },
  { version: "2.70.0", notes: "Internal: split the Logistics Network, Exploration, and Win Condition/Milestone tracking out into their own file, frontier.js — slice 19 of the game.js split. No gameplay changes." },
  { version: "2.69.0", notes: "Internal: split Fortunes (temporary boons & banes) and Signals (the hunt for faint contacts) out into their own file, fortunes.js — slice 18 of the game.js split. No gameplay changes." },
  { version: "2.68.0", notes: "Internal: split the player fleet (ordering/repairing/scrapping ships, raid allies, the Battle Group, logistics stationing, and fleet missions) out into its own file, fleet.js — slice 17 of the game.js split. No gameplay changes." },
  { version: "2.67.0", notes: "Internal: split Player Bases, the Base<->Colony Trade Network, Random Contracts, and Colonies (founding, building, alignment, and the full per-cycle simulation) out into their own file, colonization.js — slice 16 of the game.js split. No gameplay changes." },
  { version: "2.66.0", notes: "Internal: split the core economy actions (Production, Trade, the Black Market/Fences, Contraband/Customs, Travel, buying Upgrades, researching Techs, Missions, and Governor Decrees) out into their own file, economy.js — slice 15 of the game.js split. No gameplay changes." },
  { version: "2.65.0", notes: "Internal: split the research & politics action layer (research, public life, political organizations, the Senate, per-planet trade-law lobbying, corruption investigations & trials, and the public Office ladder) out into its own file, politics.js — slice 14 of the game.js split. No gameplay changes." },
  { version: "2.64.0", notes: "Internal: split the content catalogs (ship Upgrades, the Technology tree, faction Missions, the public Office ladder, political Organizations, Senate Bills, and base/colony building catalogs) out into their own file, catalogs.js — slice 13 of the game.js split. No gameplay changes." },
  { version: "2.63.0", notes: "Internal: split the outlaw path (navy interdiction, the Pirate Haven, Privateer Commissions, and the Pirate Lord / Sector Marshal capstone legacies) out into its own file, outlaw.js — slice 12 of the game.js split. No gameplay changes." },
  { version: "2.62.0", notes: "Internal: split the Sector 4X layer (rising pirate powers with their own havens, faction territory contest, and persistent inter-faction relations) out into its own file, sector4x.js — slice 11 of the game.js split. No gameplay changes." },
  { version: "2.61.0", notes: "Internal: split raid combat resolution and ship repair (plunder, multi-round raids, dockside/field repair, Wanted cooldown) out into their own file, raiding.js — slice 10 of the game.js split. No gameplay changes." },
  { version: "2.60.0", notes: "Internal: split the pirate band roster (named crews, standing, feuds/truces, tags, call-for-support) out into its own file, pirateBands.js — slice 9 of the game.js split. No gameplay changes." },
  { version: "2.59.0", notes: "Internal: split the piracy/combat engine (subsystem damage, typed weapons vs defenses, adversary matchmaking, ambushes, pirate hunting) out into its own file, combat.js — slice 8 of the game.js split. No gameplay changes." },
  { version: "2.58.0", notes: "Internal: split resource extraction, deposit reserves/depletion, and pollution/climate out into their own file, resources.js — slice 7 of the game.js split. No gameplay changes." },
  { version: "2.57.0", notes: "Internal: split player feedback (ship log, captain's journal, procedural sound effects, toasts, fireworks/announcements) out into its own file, feedback.js — slice 6 of the game.js split. No gameplay changes." },
  { version: "2.56.0", notes: "Internal: split the market pricing engine (per-planet prices, buy/sell spreads, market depth & slippage) out into its own file, pricing.js — slice 5 of the game.js split. No gameplay changes." },
  { version: "2.55.0", notes: "Internal: split the game state singleton and freshState() out into their own file, state.js — slice 4 of the game.js split. No gameplay changes." },
  { version: "2.54.0", notes: "Internal: split the planetary crisis system (disasters, relief/gouge/loot responses) out into its own file, crises.js — slice 3 of the game.js split. No gameplay changes." },
  { version: "2.53.0", notes: "Internal: split the procedural galaxy generation (frontier ring, lane graph, Sector Code, core variance) out into its own file, galaxygen.js — slice 2 of the game.js split. No gameplay changes." },
  { version: "2.52.0", notes: "Internal: split the static data tables (commodities, planets, factions, recipes) out into their own file, data.js, loaded before game.js — the first step toward a more maintainable codebase. No gameplay changes." },
  { version: "2.51.0", notes: "Mobile-friendly tables (they scroll in place instead of breaking the page), a 🆕 What's New panel, a 🏅 Milestones checklist in the Missions tab, and a 🎮 Custom Start with Sprint/Standard/Marathon length and an optional ☠️ Ironman challenge." },
  { version: "2.50.0", notes: "Quality-of-life pass: press 1-9 to jump tabs and Enter/Space to end the cycle, a confirmation before scrapping a ship or attempting a coup, a quiet \"Saved\" flash by the cycle counter, and screen-reader-friendly log & toast notifications." },
  { version: "2.49.0", notes: "Core variance: a Sector Code now jitters each charted world's deposits, industry, tech and law level a little, so the same map never plays out quite the same way twice." },
  { version: "2.48.0", notes: "The Starmap: a clickable galaxy map atop the Galaxy tab charting every known world and the hyperlanes between them." },
  { version: "2.47.0", notes: "Probe the Frontier: push straight at the frontier ring for richer signals — burns fuel whether it pays off or not, and a lawless target can draw an ambush." },
  { version: "2.46.0", notes: "The Sector Code: a shareable code that reproduces your exact frontier ring and lane graph — send it to a friend, or replay your own sector." },
  { version: "2.45.0", notes: "The lane graph: seeded hyperlanes give every game its own hazard-stretched routes and cheap shortcuts between worlds." },
  { version: "2.44.0", notes: "The frontier ring: a further ring of procedurally-generated worlds beyond the charted 20 — a different set every game, hidden until surveyed." },
  { version: "2.43.0", notes: "Territory contest: a world whose owner is at open war can change hands if its control meter maxes out." },
  { version: "2.42.0", notes: "Rising pirate powers: an exceptional pirate band can carve a haven out of a lawless world and grow in strength the longer it holds." },
  { version: "2.41.0", notes: "Wider visibility: expanded intel on faction relations and contested worlds surfaced across the Galaxy and Politics tabs." },
  { version: "2.40.0", notes: "Persistent faction relations: the five great powers now track Alliance / Peace / Cold War / War with each other, independent of your own reputation." },
];
// pure + testable: compare the running build to the server manifest
function versionStatus(local, server) {
  if (!server || !server.version) return { update: false };
  return {
    update: server.version !== local.version,
    version: server.version,
    notes: server.notes || "",
    keepsProgress: !server.saveVersion || server.saveVersion === local.saveVersion,
  };
}
function checkVersion() {
  if (typeof fetch !== "function") return;
  fetch("version.json?ts=" + Date.now(), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const st = versionStatus({ version: APP_VERSION, saveVersion: SAVE_VERSION }, data);
      if (st.update) showUpdateBanner(st);
    })
    .catch(() => {});
}
function showUpdateBanner(st) {
  if (typeof document === "undefined" || !document.body) return;
  let el = document.getElementById("update-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "update-banner";
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 14px;"
      + "background:#1e293b;color:#e2e8f0;border-top:2px solid var(--accent,#38bdf8);"
      + "font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 -4px 20px rgba(0,0,0,.4)";
    document.body.appendChild(el);
  }
  const keep = st.keepsProgress
    ? "✅ Your saved game — credits, colonies, reputation and all — will carry over."
    : "⚠️ This update changes the save format, so your current run may not carry over. Download your 📖 Log first to keep the story.";
  el.innerHTML = `<span>🔄 <b>A new version (${st.version}) is available.</b> ${st.notes ? st.notes + " " : ""}${keep}</span>`
    + `<span style="margin-left:auto;display:flex;gap:6px">`
    + `<button class="btn btn-sm btn-primary" onclick="location.reload()">Refresh now</button>`
    + `<button class="btn btn-sm" onclick="document.getElementById('update-banner').remove()">Later</button>`
    + `</span>`;
}
const REPO_URL = "https://github.com/alma92350/SpaceExploration";
function helpHTML() {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">❓ How to Play — Stellar Frontier</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleHelp()">✕ Close</button>
    </div>
    <p style="opacity:.85">Carve your legacy across a contested star sector — as a <b>Trader</b>, <b>Explorer</b>, <b>Colonial Founder</b>, <b>Politician</b> or <b>Pirate</b>. Your career is whatever you make of it; you can switch and mix freely.</p>

    <h4>The basics</h4>
    <ul style="line-height:1.6;margin:0 0 6px 18px;padding:0">
      <li>Each cycle you have a handful of <b>actions</b>; most things (travel, mine, lobby, raid) cost one. Hit <b>End Cycle</b> to advance time — prices drift, colonies grow, crises tick.</li>
      <li><b>Travel</b> between worlds costs fuel and advances a cycle. Buy low, sell high; large trades move the market.</li>
      <li>Resources are <b>finite</b>: over-mining a world depletes it and raises prices. Industry breeds <b>pollution</b> and <b>climate stress</b> — so spreading to fresh worlds pays off.</li>
      <li>Win by completing your <b>Legacy goals</b> (see the 🎯 Missions tab) or by rising to a career capstone (Consul, Pirate Lord, Sector Marshal…).</li>
    </ul>

    <h4>The tabs</h4>
    <ul style="line-height:1.55;margin:0 0 6px 18px;padding:0">
      <li>🪐 <b>Galaxy</b> — travel, explore, watch worlds, factions & crises. A <b>🗺️ Starmap</b> at the top charts every world you know about and the hyperlanes between them — click a node to travel there directly, or read the card grid below for full detail. The charted 20's names, factions and history never change — but a Sector Code now jitters each one's deposits, industry, tech and law level too, so Ferros Prime's ore or Terra Nova's law level isn't always exactly what it was last game. Beyond the charted 20 lies a further <b>frontier ring</b> of procedurally-generated worlds — a different set every game — hidden until your <b>🛰️ Deep-Space Survey</b> charts them, same as any other uncharted world. Travel distance isn't a straight line either: a seeded lane graph gives every game its own hazard-stretched routes and cheap hyperlane shortcuts, marked with a <b>🛰️ hyperlane</b> pill (and a bright line on the Starmap) wherever one bypasses the usual path from your ship. Impatient? <b>🔭 Probe the Frontier</b> pushes straight at the frontier ring instead of a routine survey — burns fuel whether it pays off or not, and a lawless target can draw an ambush, but a world charted this way turns up richer <b>📡 signals</b>.</li>
      <li>💱 <b>Market</b> — trade goods; black market for contraband; aid or profiteer during crises. Quantity boxes remember what you last typed for each good; a 💡 hint flags the best <b>known</b> world to flip a commodity you buy here (profit per light-year), and <b>Sort: Best margin</b> ranks each tier by that same opportunity. <b>💰 Sell entire hold</b> unloads every legal good you're carrying at today's prices in one click (contraband here is held back — sell that individually if you'll risk the customs check).</li>
      <li>🏭 <b>Industry</b> — refine raw materials into finished goods.</li>
      <li>🔬 <b>Research</b> — unlock technologies.</li>
      <li>✨ <b>Fortunes</b> — temporary <b>boons &amp; banes</b> you pick up by exploring new worlds, sweeping the lanes and plain luck — extra actions, weapon surges, trade winds, research sparks, and rarer grand effects… balanced by reactor leaks, customs crackdowns and the like. This tab tracks your active effects (with time left and 🧹 clear buttons for banes), the <b>📡 signals</b> on your scope, and an <b>almanac</b> of every effect you've discovered. Chase a signal and <b>🔍 Investigate</b> it for a roll — stronger effects are briefer, and the rare, powerful ones are the prize of a hunted signal. Short on leads? The <b>🛰️ Sensor Office</b> sells scans that flush fresh signals onto your scope. Catalogue <b>every</b> effect in a domain to earn a 🏅 <b>Mastery</b> — a permanent passive edge. Unlocks once a Fortune or signal turns up.</li>
      <li>🎯 <b>Missions</b> — time-bound contracts, long-term career missions, and your legacy goals.</li>
      <li>🏛️ <b>Politics</b> — factions, influence, elections, the Senate and trade law. A <b>🌐 Sector Relations</b> card tracks how the five great powers stand with <i>each other</i> — Alliance/Peace/Cold War/War — independent of your own reputation. It drifts on its own each cycle (rivals trend toward war, others settle toward peace) and occasional named incidents can tip a pair into a new state; your own active letters of marque stoke the rivalry you're fighting for. Notable shifts appear in the log and the 📋 cycle recap. A world's most newsworthy relationship (⚔️ at war / 🤝 allied) also shows as a pill on its 🪐 Galaxy card, and active wars &amp; alliances get their own line on the sidebar's Operations board. War isn't just flavor: a world whose owner is at open war can be <b>🚩 contested</b> — a control meter (shown on its Galaxy pill, an Operations row, and the Politics tab's <b>Contested Worlds</b> card) builds faster the deeper the war and the more pirate-plagued the world, and if it maxes out the world <b>changes hands</b> to the challenger. Cooling the war back to peace lets a contest fade on its own; no faction can ever be conquered down to its last world.</li>
      <li>🏗️ <b>Bases</b> — automated off-world production. Build a <b>⛽ Fuel Refinery</b> (any base, 5 tiers) to crack stored 🧊 ice into fuel each cycle, and route fuel through the base↔colony trade network (import/export it like any good).</li>
      <li>🌍 <b>Colonies</b> — found and grow worlds: population, power and full industry chains, including a <b>⛽ Fuel Refinery</b> (ice + energy → fuel) and a <b>🏗️ Shipyard</b> (needs Metallurgy) that lets you build your own ships. Order in ice, export the fuel — fuel is now a tradeable part of the economy: buy/sell it at ports, stock it in bases &amp; colonies, and ship it across your network.</li>
      <li>✦ <b>Fleet</b> — build and run your own ships at colony <b>🏗️ Shipyards</b>: <b>freighters</b> (light → bulk hauler) to carry your goods and <b>warships</b> (corvette → battleship) to fight for you. A shipyard's tier sets the biggest hull it can lay down and how many slipways build at once; construction costs credits &amp; materials and takes several cycles, and ships draw upkeep each cycle (shown in the 💰 Cycle accounts log). Repair or scrap them at their home shipyard. <b>Dispatch a warship on a mission</b> (🎯 cull / 🛡️ guard / 🏴 raid a system) and — unlike hired pirates — <b>you keep 100%</b> of the bounty/loot, paying no fee; the risk is combat wear (a fragile hull in an infested system can be lost) and ongoing upkeep. You can also <b>call idle warships into your own raids</b> (loyal allies that take <b>no loot cut</b>) and <b>assign them to escort your convoys</b> for free — they never desert, and any damage they take comes back to your fleet. <b>Station freighters at a colony</b> on logistics duty to haul its goods — cutting its market import fee and base↔colony freight — and <b>station a warship there to guard them</b>, since unguarded convoys in pirate-active systems get ambushed (damage &amp; lost goods, and a fragile hauler can be sunk). Loyal and fully yours. In a raid, you can also <b>✦ Deploy Battle Fleet</b> — your <b>whole idle warship fleet at once</b> (not the 2-ally cap) fights as a formation with an escort-style posture (screen/balanced/press). Positioning matters: assign ships to <b>🛡️ Vanguard</b> (tanks — soaks nearly all incoming fire while it holds), <b>⚔️ Line</b> (your best damage dealers, protected behind the Vanguard), or <b>🌌 Reserve</b> (safest, weakest). Lose the Vanguard and the Line is exposed next — the formation collapses tier by tier — and keeping a Vanguard alive screens you personally too. Real stakes: ships take real damage and can be lost in a hard fight. Recall the fleet any time.</li>
      <li>⚔️ <b>Raider</b> — prey on shipping (Wanted/Dread, havens, marques) or hunt pirates for lawful bounties; resolve ambushes & interdictions. You build lasting history with named <b>pirate bands</b> (🏴‍☠️ Pirate Contacts): ally with them, spare them, pay tributes or gift valued cargo to raise their collaboration — friendlier crews take a smaller loot cut, rally readily, and hire on cheaper (and more loyally) for 🛡️ Escort runs. Your Dread earns their respect; killing them earns their hatred.</li>
      <li>🛡️ <b>Escort</b> (expert) — take a convoy contract and command a whole fleet: <b>pool every ship's firepower</b> and split it equally across the attackers you target. Each attacker telegraphs who it's <b>aiming at</b> (raiders hunt freighters, interceptors your biggest guns, gunships your flagship, and a ☠️ leader anchors tough waves) — kill the one about to hit cargo first, and use the <b>🛡️ Screen</b> stance to have escorts body-block the freighters. Each leg is a cycle on the clock and burns fuel, and the lanes grow more dangerous as you near port. Keep the freighters alive for the full fee; only your flagship can field-repair. Set each vessel's <b>combat stance</b> — ⚔️ Aggressive (more firepower), ⚖️ Balanced, or 🛡️ Defensive (soak hits) — and buy up to <b>3 levels of fit</b> for it, paid from your hold (🔫 weapons · 🛸 drones · 🧠 AI cores); bigger vessels cost more, freighters cap at Lv2, and switching stance is free. After accepting, you get a <b>prep window</b>: hunt pirates at the route's ends in the ⚔️ Raider tab to lower the convoy's threat (the fee stays the same) — but a contract <b>deadline</b> in cycles limits how long you can prepare. Completed runs raise your <b>Escort Guild</b> rank — better pay and a larger fleet. Friendly pirate bands may also post <b>🏴‍☠️ smuggling runs</b> here — carry their contraband for fat pay and deep crew standing, but you'll pick up Wanted heat, anger the destination's authorities, and earn no guild credit (bail and you'll burn the crew). Unlocks once you've proven yourself in combat.</li>
      <li>🏴‍☠️ <b>Contacts</b> — manage your loose <b>brotherhood</b> of pirate bands: see each crew's standing, personality, feuds, location and history; <b>tag</b> them (⭐ Brotherhood, 🟢 Ally, 👁️ Watch, 🔴 Rival) and the mark follows their name everywhere; pay tributes or gift cargo to win them over. <b>📣 Call for support</b> to summon a crew — those in your system fall in at once, distant ones travel in over a cycle and then stand by to join a raid (as an ally) or an escort (as a free volunteer). Tell a standing-by crew to <b>🛰️ Follow</b> and they'll jump where you jump for a stretch, or <b>✖ Stand down</b> to send them home early. The tab has three sub-views: <b>🤝 All contacts</b>, <b>📍 Around here</b> (crews based in this system and how lawless it is), and <b>📜 Mandates</b> — commission a crew to work a system for a set run: <b>🎯 cull pirates</b> or <b>🛡️ guard the lanes</b> (lawful — thins out pirate activity there) or <b>🏴 prey on shipping</b> (piracy in your name — fattest cut, but Wanted climbs and the locals seethe, <i>unless you hold a 📜 letter of marque against that faction, which makes it sanctioned — no Wanted</i>). You pay a fee up front and bank a cut of the take when the run ends. Some crews hold <b>blood feuds</b> and won't serve alongside their rival — you can settle it: a cheap <b>🕊️ Truce</b> sets the feud aside for a few cycles so they'll serve together for now, or a full <b>🤝 Broker peace</b> ends it for good (the fee scales with the feud's depth and eases with your standing &amp; Dread). Friendlier bands take a smaller loot cut, hire cheaper, and answer calls readily. Every so often an exceptional band <b>rises</b> — carving a <b>👑 haven</b> out of a lawless world it commands, growing tier by tier (and in rank) the longer that world stays lawless, and quietly withering if you keep it pacified. It's still a normal band underneath — ally, feud, hire, mandate with it exactly as any other — but a haven-bearing crew is a named, escalating threat: shown on its Contacts card, on its world's 🪐 Galaxy pill, and on the sidebar's Operations board. Appears once you've crossed a pirate band.</li>
      <li>🚀 <b>Ship</b> — outfit your ship with upgrade modules.</li>
      <li>📋 <b>Operations</b> (sidebar) — a live board of everything running in the background: fleet missions, convoys &amp; construction, pirate mandates, your active escort/smuggling run, a letter of marque, crews standing by / inbound / following, plus your active ✨ Fortunes (with clear buttons) and 📡 signals. Each row shows a cycle countdown and clicks through to the relevant tab, so nothing you set in motion gets forgotten.</li>
    </ul>

    <h4>Header buttons</h4>
    <p style="margin:0 0 6px 0">⟲ <b>New</b> / 🌍 <b>Colonize</b> start fresh runs · 🎮 <b>Custom Start</b> picks your opening, a Sprint/Standard/Marathon campaign length, and an optional ☠️ <b>Ironman</b> challenge (disables 📂 Load for that run) · 🔑 <b>Seed</b> shows this sector's shareable code and can start a new game from any code (yours or a friend's) — the exact same frontier ring and lane graph, every time · 📖 <b>Log</b> downloads your captain's log (a dossier you can hand to an AI to write your biography or a novel).</p>

    <h4>Links</h4>
    <p style="margin:0">
      <a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📦 GitHub repository</a> ·
      <a href="${REPO_URL}/issues" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">🐞 Report a bug / request a feature</a> ·
      <a href="${REPO_URL}#readme" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📖 README</a>
    </p>
    <h4>Save &amp; Load</h4>
    <p style="margin:0 0 6px">Your game autosaves in this browser. Use <b>💾 Save</b> (top bar) to download a save file you own — a backup, or to carry your run to another browser or machine — and <b>📂 Load</b> to restore one.</p>
    <h4>Sound</h4>
    <p style="margin:0 0 6px">Procedural sound effects play on trades, combat, travel and big moments. Toggle them with <b>🔊 Sound</b> in the Captain's Console (bottom-left).</p>
    <h4>E-ink mode</h4>
    <p style="margin:0 0 6px">Reading on a Kindle Scribe or other e-reader? Tap <b>📖 E-ink mode</b> in the Captain's Console for a high-contrast black-on-white display — gradients, glows and animations are stripped for crisp grayscale legibility. Tap <b>🌙 Color mode</b> to switch back. Your choice is remembered.</p>
    <h4>Progression &amp; Guided Mode</h4>
    <p style="margin:0 0 6px">To avoid overload, features reveal as you grow: the market starts with raw &amp; refined goods (the rest opens when you first manufacture <b>Medicine</b>); the galaxy shows worlds within sensor range and widens as you travel; tabs like <b>Raider</b> and <b>Politics</b> arrive as your trade empire matures; and colony build options stage in by tier. The <b>🧭 Next Steps</b> panel in 🎯 Missions always shows what unlocks next and how. Veteran saves keep everything they've already earned.</p>
    <p style="margin:0"><button class="btn btn-sm" onclick="toggleShowAllTabs();toggleHelp();toggleHelp()">${typeof S!=="undefined"&&S.showAllTabs?"↩️ Switch to Guided mode (hide features until earned)":"👁️ Show everything now (reveal all features)"}</button></p>
    <p style="opacity:.6;font-size:12px;margin-top:10px">Stellar Frontier v${typeof APP_VERSION!=="undefined"?APP_VERSION:""} · made with Claude. Tip: press <b>1-9</b> to jump to a tab, <b>Enter/Space</b> to end the cycle, <b>Esc</b> to close this help.</p>
  `;
}
/* ---- Generic centered modal overlay, shared by Help and What's New.
   Clicking the backdrop, or calling show again with the same id, closes it. ---- */
function showModal(id, html) {
  if (typeof document === "undefined" || !document.body) return;
  const existing = document.getElementById(id);
  if (existing) { existing.remove(); return; }
  const el = document.createElement("div");
  el.id = id;
  el.className = "modal-overlay";
  el.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.80);display:flex;"
    + "align-items:center;justify-content:center;padding:20px";
  el.innerHTML = `<div style="max-width:680px;max-height:85vh;overflow:auto;background:#0f172a;`
    + `border:1px solid var(--accent,#38bdf8);border-radius:12px;padding:22px 24px;color:#e2e8f0;`
    + `box-shadow:0 20px 60px rgba(0,0,0,.6)" onclick="event.stopPropagation()">${html}</div>`;
  el.addEventListener("click", () => el.remove());            // click backdrop to dismiss
  document.body.appendChild(el);
}
function toggleHelp() { showModal("help-overlay", helpHTML()); }
function changelogHTML() {
  const rows = CHANGELOG.map(c => `<li style="margin-bottom:8px"><b class="c" style="color:var(--gold,#ffd166)">v${c.version}</b> — ${c.notes}</li>`).join("");
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🆕 What's New</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleChangelog()">✕ Close</button>
    </div>
    <p style="opacity:.85">Recent updates to Stellar Frontier, newest first.</p>
    <ul style="line-height:1.5;margin:10px 0 0 18px;padding:0">${rows}</ul>
    <p style="opacity:.6;font-size:12px;margin-top:14px">
      <a href="${REPO_URL}/commits/main" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">Full commit history</a>
    </p>
  `;
}
function toggleChangelog() { showModal("changelog-overlay", changelogHTML()); }
/* ---- Keyboard shortcuts: 1-9 jump to that tab, Enter/Space ends the cycle,
   Esc closes any open modal overlay. Ignored while typing in a field or while
   some other control already has keyboard focus, so we never steal Enter/Space
   from a focused button or hijack digits out of a quantity box. ---- */
function handleShortcutKey(e) {
  if (typeof document === "undefined") return;
  if (e.key === "Escape") { const m = document.querySelector(".modal-overlay"); if (m) m.remove(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".modal-overlay")) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON"
      || (document.activeElement && document.activeElement.isContentEditable)) return;
  if (e.key >= "1" && e.key <= "9") {
    const tabs = Array.from(document.querySelectorAll(".tab")).filter(t => t.style.display !== "none");
    const btn = tabs[+e.key - 1];
    if (btn) { e.preventDefault(); setTab(btn.dataset.tab); }
  } else if (e.key === "Enter" || e.key === " ") {
    const btn = document.getElementById("endTurnBtn");
    if (btn) { e.preventDefault(); btn.click(); }
  }
}
function startVersionWatch() {
  if (typeof window === "undefined") return;
  checkVersion();                                          // once on load
  setInterval(checkVersion, 5 * 60 * 1000);                // every 5 minutes
  window.addEventListener("focus", checkVersion);          // and whenever the player returns
  window.addEventListener("keydown", handleShortcutKey);
}
const SAVE_KEY = "stellar-frontier-save-v2";
/* ---- Captain's Log: export a narrative dossier for an LLM ---- */
function playerArchetype() {
  const P = S.pirate || {}, nCol = Object.keys(S.colonies || {}).length;
  if (S.legacyTitle) return S.legacyTitle;
  if (S.office >= 2 || (S.orgs && S.orgs.party)) return "Politician";
  if ((P.raids || 0) >= 8 || (P.plundered || 0) >= 20000) return "Pirate";
  if (nCol >= 1) return "Colonial Founder";
  const visited = Object.keys(S.visited || {}).length;
  if (visited >= 8) return "Explorer";
  return "Free Trader";
}
function buildJournalText() {
  const L = [];
  const arche = playerArchetype();
  L.push(`# Captain's Log — ${arche}`);
  L.push(`*S.S. Wanderer · Cycle ${S.turn}*`);
  L.push("");
  L.push("> A chronicle of one captain's passage through the sector. Hand this");
  L.push("> dossier to an AI (e.g. Anthropic's Claude) with the prompt at the end");
  L.push("> to spin it into a biography or a novel.");
  L.push("");

  // A self-contained primer so an AI with no knowledge of this game can write faithfully
  L.push("## The Universe (a primer for the storyteller)");
  L.push("*This is an invented science-fiction setting; everything you need is below.*");
  L.push("");
  L.push("**The setting.** A single contested star sector on the frontier of known space, generations after the great expansion. A scatter of worlds — garden capitals, ice moons, mining hells, gas giants, ancient ruins and untamed frontiers — strung along fuel-hungry jump lanes, with no single power fully in control. The protagonist commands a lone starship, the *S.S. Wanderer*, and rises by any mix of trade, exploration, colonization, politics and outright piracy.");
  L.push("");
  L.push("**The five powers.** The Core Authority (lawful inner-world government), the Mining Guild (ore and heavy industry), the Agri-Combine (food and fair trade), the Tech Syndicate (electronics, research and discreet dealings) and the Frontier Coalition (the free, smuggler-friendly rim). The captain's standing with each is listed under *The Powers*.");
  L.push("");
  L.push("**Time & money.** Time is measured in *cycles*; every dated entry below is a cycle. Money is *credits* (cr).");
  L.push("");
  L.push("**The economy.** Worlds trade commodities along a production chain: raw materials (ore, ice, biomass, gas, crystals, radioactives, spice, relics) are refined (metals, energy, fuel, chemicals, medicine) and built into components (alloys, electronics) and finished goods (consumer goods, machinery, weapons, luxuries, antimatter). Prices float with local supply, demand, industry and law, and big deals move the market.");
  L.push("");
  L.push("**Resources & ecology.** Deposits are finite: mining drains a world's reserves and its yields fall, so over-exploitation makes goods scarce and dear; left alone, worlds slowly recover. Industry breeds *pollution*, and the sector's aggregate pollution drives a *climate stress* that withers farms everywhere — a constant pressure to settle fresh worlds rather than bleed the old ones dry.");
  L.push("");
  L.push("**Crises.** Disasters strike worlds — earthquakes, volcanic eruptions, plagues, industrial accidents, civil unrest, famines, mine collapses — disrupting them and spiking the prices of what they suddenly need. A captain may bring relief and earn a people's gratitude, or profiteer from their desperation.");
  L.push("");
  L.push("**Terms used in the chronicle.**");
  L.push("- *Reputation*: standing with a faction (allied → friendly → neutral → resentful → hostile).");
  L.push("- *Influence* (political capital); *Popularity* & *Legitimacy* (a politician's public support and lawful mandate); *Heat* (official scrutiny that invites investigation); *Office* (rank won by election, appointment or force, from Councillor up to Consul).");
  L.push("- *Wanted* (how hard the law hunts you); *Dread* (how feared you are as a pirate); *Haven* (a hidden pirate base); *Letter of marque* (a licence to raid a faction's rivals legally).");
  L.push("- *Colony* (a world you settle and grow — population, happiness, industry); *Reserves* (a deposit's remaining stock); *Pollution / Climate* (the ecological harm left behind).");
  L.push("");

  // The setting
  L.push("## The Sector");
  PLANETS.filter(isActive).forEach(p => {
    const deps = Object.keys(p.deposits || {}).map(c => `${COM[c].name} ${Math.round(reserveFrac(p.id, c) * 100)}%`).join(", ") || "none";
    const law = p.enforce > 0.7 ? "strict law" : p.enforce < 0.25 ? "lawless" : "patrolled";
    const tags = [];
    if (S.colonies && S.colonies[p.id]) tags.push(`YOUR COLONY (pop ${Math.round(S.colonies[p.id].pop)}k)`);
    if (S.crises && S.crises[p.id]) tags.push(`in crisis: ${CRISES[S.crises[p.id].type].name}`);
    const poll = pollutionOf(p.id);
    if (poll >= 25) tags.push(`${poll >= 60 ? "heavily polluted" : "polluted"}`);
    L.push(`- **${p.name}** (${p.tag}; ${FACTIONS[p.faction].name}; ${law}) — deposits: ${deps}.${tags.length ? " " + tags.join("; ") + "." : ""}`);
  });
  L.push("");

  // The powers
  L.push("## The Powers (factions & your standing)");
  Object.keys(FACTIONS).forEach(f => {
    const r = Math.round(S.rep[f] || 0);
    const word = r >= 50 ? "allied" : r >= 20 ? "friendly" : r <= -50 ? "hostile" : r <= -20 ? "resentful" : "neutral";
    L.push(`- ${FACTIONS[f].name}: ${word} (${r}). ${FACTIONS[f].desc}`);
  });
  L.push("");

  // Where the captain stands
  L.push("## The Captain, at Cycle " + S.turn);
  L.push(`- Path: **${arche}**${S.legacyTitle ? ` — legend earned: *${S.legacyTitle}*` : ""}`);
  L.push(`- Wealth: ${fmt(S.res.credits)} cr on hand · net worth ${fmt(netWorth())} cr`);
  if (S.office && typeof currentOffice === "function" && currentOffice()) L.push(`- Office: ${currentOffice().name} (popularity ${Math.round(S.pol.popularity)}, legitimacy ${Math.round(S.pol.legitimacy)})`);
  const P = S.pirate || {};
  if ((P.raids || 0) > 0 || (P.dread || 0) > 0) L.push(`- Outlaw record: ${P.raids} raids, ${fmt(P.plundered)} cr plundered, Wanted ${P.wanted}, Dread ${P.dread}${S.haven ? `, haven at ${PLANETS.find(p => p.id === S.haven.planet).name}` : ""}`);
  const cols = Object.keys(S.colonies || {});
  if (cols.length) L.push(`- Colonies founded: ${cols.map(id => PLANETS.find(p => p.id === id).name).join(", ")}`);
  const techn = Object.keys(S.techs || {}).filter(t => S.techs[t]).length;
  L.push(`- Voyages: ${S.stats.jumps} jumps · ${S.stats.trades} trades · ${techn} technologies · sector climate stress ${Math.round(S.climate || 0)}`);
  L.push("");

  // The chronicle
  L.push("## The Chronicle");
  const j = S.journal || [];
  if (!j.length) L.push("*(No entries yet — the voyage has only just begun.)*");
  else j.forEach(e => L.push(`- **Cycle ${e.turn}.** ${e.text}`));
  L.push("");

  // The ask
  L.push("---");
  L.push("## Prompt for your AI storyteller");
  L.push("```");
  L.push(`You are a science-fiction novelist. Using the captain's log above —`);
  L.push(`the sector, the factions, the captain's standing, and the chronicle of`);
  L.push(`events — write the biography of this ${arche.toLowerCase()} of the stars.`);
  L.push(`Stay faithful to the recorded events, names and worlds; invent the`);
  L.push(`inner life, dialogue and texture around them. Give it a title.`);
  L.push("```");
  return L.join("\n");
}
function downloadJournal() {
  const text = buildJournalText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Journal export unavailable here.", "bad");
    return text;
  }
  const blob = new Blob([text], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `captains-log-cycle-${S.turn}.md`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Captain's log downloaded.", "good");
  return text;
}
/* ============================================================
   SAVE / LOAD TO DISK — the autosave lives in localStorage (one slot, tied to
   this browser). These let a captain export the run to a .json file they own:
   a backup, a way to move between machines/browsers, or to keep many saves.
   Importing replaces the autosave and reloads so init() normalises cleanly.
   ============================================================ */
const SAVE_FILE_TAG = "stellar-frontier-save";
function buildSaveText() {
  // a small envelope so the file is self-describing and future-proof
  return JSON.stringify({
    game: SAVE_FILE_TAG,
    version: SAVE_VERSION,
    exported: new Date().toISOString(),
    cycle: S.turn,
    credits: S.res && S.res.credits,
    state: S,
  }, null, 2);
}
function looksLikeState(o) {
  return !!o && typeof o === "object" && o.res && typeof o.res === "object"
    && o.location !== undefined && o.upgrades && typeof o.upgrades === "object";
}
function parseSaveText(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { return { ok: false, error: "Not a valid save file (could not read JSON)." }; }
  // accept our envelope, or a bare state object (forgiving)
  const state = data && data.state !== undefined ? data.state : data;
  if (data && data.game && data.game !== SAVE_FILE_TAG) return { ok: false, error: "This file is not a Stellar Frontier save." };
  if (!looksLikeState(state)) return { ok: false, error: "This file doesn't contain a valid Stellar Frontier save." };
  return { ok: true, state: state };
}
function exportSave() {
  if (typeof saveGame === "function") saveGame();   // capture the very latest state
  const text = buildSaveText();
  if (typeof document === "undefined" || !document.body || typeof Blob === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    if (typeof toast === "function") toast("Save export unavailable here.", "bad");
    return text;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `${SAVE_FILE_TAG}-cycle-${S.turn}-${stamp}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  if (typeof toast === "function") toast("Game saved to disk.", "good");
  return text;
}
// testable core: validate text, persist to the autosave slot. Returns {ok,error}.
function importSaveText(text) {
  const res = parseSaveText(text);
  if (!res.ok) return res;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(res.state)); }
  catch (e) { return { ok: false, error: "Could not write the save to this browser." }; }
  return { ok: true, state: res.state };
}
function importSave() {
  if (typeof document === "undefined" || !document.createElement || typeof FileReader === "undefined") {
    if (typeof toast === "function") toast("Save import unavailable here.", "bad");
    return;
  }
  const input = document.createElement("input");
  input.type = "file"; input.accept = "application/json,.json"; input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importSaveText(String(reader.result || ""));
      if (!res.ok) { if (typeof toast === "function") toast(res.error || "Import failed.", "bad"); input.remove(); return; }
      if (typeof confirm === "function" && !confirm("Load this save? It will replace your current game (cycle " + (res.state.turn != null ? res.state.turn : "?") + "). The page will reload.")) { input.remove(); return; }
      if (typeof toast === "function") toast("Save loaded — reloading…", "good");
      if (typeof location !== "undefined" && location.reload) location.reload();
    };
    reader.onerror = () => { if (typeof toast === "function") toast("Could not read that file.", "bad"); };
    reader.readAsText(file);
  });
  if (document.body) document.body.appendChild(input);
  input.click();
}
let _saveIndicatorTimer = null;
function flashSaveIndicator() {
  if (typeof document === "undefined") return;
  const el = document.getElementById("saveIndicator");
  if (!el) return;
  el.classList.add("show");
  clearTimeout(_saveIndicatorTimer);
  _saveIndicatorTimer = setTimeout(() => el.classList.remove("show"), 1500);
}
function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); flashSaveIndicator(); } catch (e) {}
}
function loadGame() {
  try { const raw = localStorage.getItem(SAVE_KEY); if (raw) { S = JSON.parse(raw); return true; } } catch (e) {}
  return false;
}
function promptSeedNewGame() {
  if (typeof prompt !== "function") return;
  const current = seedCodeFor(S.frontierSeed);
  const input = prompt(`This sector's code is ${current} — share it so someone else can generate the exact same frontier ring and lane graph.\n\nStart a NEW game with this code (replays the same sector), enter a different code, or clear the field for a random sector. Current progress will be lost either way:`, current);
  if (input === null) return;   // cancelled — no game started, nothing changed
  newGame(undefined, input.trim() || undefined);
}
function newGame(mode, seedCode, opts = {}) {
  const colony = mode === "colony", politics = mode === "politics";
  let msg = colony
    ? "Start in Colonization mode? You'll skip the trading phase and begin on a frontier world with the Colonial Charter, the capital and the materials to found your first colony right away. Current progress will be lost."
    : politics
    ? "Start in Politics mode? You'll skip the trading grind and begin as a fledgling politician — with the Galactic Charter, a campaign chest, some influence and your own party. Current progress will be lost."
    : "Start a new game? Current progress will be lost.";
  const extras = [];
  if (opts.ironman) extras.push("☠️ Ironman");
  if (opts.lengthMult && opts.lengthMult < 1) extras.push("🏃 Sprint length");
  if (opts.lengthMult && opts.lengthMult > 1) extras.push("🏔️ Marathon length");
  if (extras.length) msg += ` — ${extras.join(", ")}.`;
  if (typeof confirm === "function" && !confirm(msg)) return;
  for (let i = PLANETS.length - 1; i >= 0; i--) { if (PLANETS[i].frontier) PLANETS.splice(i, 1); }   // drop the previous run's frontier ring — PLANETS survives a mid-session New Game, unlike a page reload
  S = freshState({ colonyStart: colony, politicsStart: politics, seed: seedFromCode(seedCode), ironman: opts.ironman, lengthMult: opts.lengthMult });
  generateFrontierRing();   // regenerate against the (possibly custom) seed just rolled/entered above
  rollPrices();
  if (colony) {
    log(`🌍 Colonization charter granted. You arrive at <span class="c">${currentPlanet().name}</span> with capital and supplies — found your first colony.`, "event");
  } else if (politics) {
    log(`🏛️ You enter public life at <span class="c">${currentPlanet().name}</span> — a charter, a war chest and a party of your own. Build your machine.`, "event");
  } else {
    log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`);
  }
  if (S.ironman) log("☠️ Ironman run — 📂 Load is disabled for this game. Live with your choices.", "event");
  jotOpening(colony ? "colony" : politics ? "politics" : "trade");
  if (colony) unlock("colonies", false); if (politics) unlock("politics", false);
  checkUnlocks(true);
  applyIronmanUI();
  saveGame(); renderAll(); setTab(colony ? "colonies" : politics ? "politics" : "galaxy");
}
/* ---- Custom Start: pick opening + campaign length + optional Ironman
   challenge, all in one modal, without touching the existing one-click
   ⟲ New / 🌍 Colonize buttons other players already rely on. ---- */
function customStartHTML() {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🎮 Custom Start</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleCustomStart()">✕ Close</button>
    </div>
    <p style="opacity:.85">Pick how this run begins. Starting will replace your current game.</p>
    <h4>Opening</h4>
    <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0 16px">
      <label><input type="radio" name="cs-mode" value="trade" checked> 💱 Trading — the default start</label>
      <label><input type="radio" name="cs-mode" value="colony"> 🌍 Colonization — skip to founding a colony</label>
      <label><input type="radio" name="cs-mode" value="politics"> 🏛️ Politics — start with a party and a war chest</label>
    </div>
    <h4>Campaign length</h4>
    <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0 16px">
      <label><input type="radio" name="cs-length" value="0.6"> 🏃 Sprint — shorter net-worth &amp; colony goals</label>
      <label><input type="radio" name="cs-length" value="1" checked> ⚖️ Standard</label>
      <label><input type="radio" name="cs-length" value="1.6"> 🏔️ Marathon — bigger net-worth &amp; colony goals</label>
    </div>
    <h4>Challenge</h4>
    <div style="margin:8px 0 16px">
      <label><input type="checkbox" id="cs-ironman"> ☠️ Ironman — disables 📂 Load for this run. Live with your choices.</label>
    </div>
    <button class="btn btn-primary" onclick="beginCustomStart()">🚀 Begin</button>
  `;
}
function toggleCustomStart() { showModal("customstart-overlay", customStartHTML()); }
function beginCustomStart() {
  const modeEl = document.querySelector('input[name="cs-mode"]:checked');
  const lengthEl = document.querySelector('input[name="cs-length"]:checked');
  const ironmanEl = document.getElementById("cs-ironman");
  const mode = modeEl ? modeEl.value : "trade";
  const lengthMult = lengthEl ? parseFloat(lengthEl.value) : 1;
  const ironman = !!(ironmanEl && ironmanEl.checked);
  const overlay = document.getElementById("customstart-overlay");
  if (overlay) overlay.remove();
  newGame(mode, undefined, { lengthMult, ironman });
}
/* ---- Ironman disables 📂 Load for the current run — refresh the button
   whenever a game starts (page load or a mid-session Custom Start). ---- */
function applyIronmanUI() {
  if (typeof document === "undefined") return;
  const btn = document.getElementById("loadSaveBtn");
  if (!btn) return;
  btn.disabled = !!S.ironman;
  btn.title = S.ironman
    ? "Ironman run — loading a save is disabled. Live with your choices."
    : "Load a game from a save file on your disk (replaces the current game)";
}
function jotOpening(mode) {
  const p = currentPlanet();
  const worlds = PLANETS.filter(isVisible).map(x => x.name).join(", ");   // an opening journal entry shouldn't spoil undiscovered worlds
  const intro = mode === "colony" ? "granted a Colonization charter to tame a frontier world"
    : mode === "politics" ? "entering public life with a party and a war chest"
    : "a free trader with a ship and a dream";
  jot(`The voyage begins at ${p.name} — ${intro}. The charted sector: ${worlds}.`, "origin");
}
function init() {
  const isNewGame = !loadGame();
  if (isNewGame) S = freshState();
  if (!S.frontierSeed) S.frontierSeed = Math.floor(Math.random() * 2**31);   // backfill for saves from before the frontier ring
  if (!S.laneSeed) S.laneSeed = deriveLaneSeed(S.frontierSeed);              // backfill for saves from before the lane graph — derived, so its Sector Code is already correct
  if (!S.coreSeed) S.coreSeed = deriveCoreSeed(S.frontierSeed);              // backfill for saves from before core variance — derived, so its Sector Code is already correct
  applyCoreVariance(S.coreSeed);   // PLANETS is static source, re-declared fresh on every load — reapply this save's variance every time, same as the lane graph
  generateFrontierRing();   // procedural worlds beyond the charted 20 — deterministic from the seed, safe to call every load
  if (isNewGame) { rollPrices(); log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`); jotOpening("trade"); }
  if (!S.prices || !S.prices[S.location]) rollPrices();
  if (!S.bases) S.bases = {};   // backfill for older saves
  Object.values(S.bases).forEach(b => {
    if (b.trade === true) b.trade = { on: true, exp: {}, imp: {}, cols: {} };
    else if (!b.trade || typeof b.trade !== "object") b.trade = { on: false, exp: {}, imp: {}, cols: {} };
    else { b.trade.exp = b.trade.exp || {}; b.trade.imp = b.trade.imp || {}; b.trade.cols = b.trade.cols || {}; }
  });
  if (!Array.isArray(S.fx)) S.fx = [];   // backfill Fortunes (temporary boons/banes)
  if (!Array.isArray(S.signals)) S.signals = [];   // backfill discoverable signals
  if (!S.fxSeen) S.fxSeen = {};                     // backfill Fortunes almanac
  if (!S.fxMastery) S.fxMastery = {};               // backfill almanac mastery
  if (!Array.isArray(S.mandates)) S.mandates = [];   // backfill pirate mandates
  if (!Array.isArray(S.fleet)) S.fleet = [];         // backfill player fleet
  if (!S.battleGroupPosture) S.battleGroupPosture = "balanced";
  if (!S.factionRel) S.factionRel = {};
  ensureFactionRel();   // backfill any pairs missing from an older save
  if (!S.territoryControl) S.territoryControl = {};
  if (!S.territoryFlips) S.territoryFlips = {};
  replayTerritoryFlips();   // PLANETS is static source, re-declared fresh on every load — reapply any recorded seizures
  if (S.escort && Array.isArray(S.escort.fleet)) S.escort.fleet.forEach(sh => { if (!sh.fit) sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; if (!sh.stance) sh.stance = "balanced"; });   // migrate old outfit fleets to stance/fit
  if (!S.colonies) S.colonies = {};
  Object.values(S.colonies).forEach(c => { if (!c.orders) c.orders = {}; if (c.unrest == null) c.unrest = 0; if (c.faction === undefined) c.faction = null; if (!c.idle) c.idle = {}; });
  if (!S.discovered) S.discovered = {};
  if (!S.contracts) { S.contracts = []; S.contractSeq = S.contractSeq || 0; }
  if (!S.pol) S.pol = { popularity: 0, legitimacy: 0, heat: 0, slush: 0 };  // backfill politics meters
  if (!S.orgs) S.orgs = {};
  if (!S.policies) S.policies = {};
  if (S.floor === undefined) S.floor = null;
  if (!S.planetLaws) S.planetLaws = {};
  if (S.invest === undefined) S.invest = null;
  if (S.jail == null) S.jail = 0;
  if (S.office == null) S.office = S.perks.governor ? 3 : S.perks.senator ? 2 : 0;  // migrate from old perks
  if (S.term == null) S.term = 0;
  if (S.officePath === undefined) S.officePath = null;
  if (S.legacyTitle === undefined) S.legacyTitle = null;
  if (!S.reserves) S.reserves = {};
  if (!S.crises) S.crises = {};
  if (!S.journal) S.journal = [];
  if (!S.pirates) S.pirates = {};
  if (S.pirateCalm == null) S.pirateCalm = 0;
  if (S.encounter === undefined) S.encounter = null;
  if (!S.unlocked) { S.unlocked = {}; checkUnlocks(true); }   // veterans keep everything they've earned, silently
  if (S.showAllTabs == null) S.showAllTabs = false;
  if (S.sound == null) S.sound = true;
  if (S.eink == null) S.eink = false;
  if (S.pirateIntel === undefined) S.pirateIntel = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  if (S.res && S.res.drones == null) S.res.drones = 0;
  if (S.res && S.res.ai == null) S.res.ai = 0;
  if (!S.pollution) S.pollution = {};
  if (S.climate == null) S.climate = 0;
  if (!S.pirate) S.pirate = { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0 };
  if (S.pirate.commissionsDone == null) S.pirate.commissionsDone = 0;
  initSubsys();
  if (!S.pirate.wuse) S.pirate.wuse = {};
  if (!S.combat) S.combat = { posture: "balanced", offense: 50, target: "hull", advanced: false };
  if (S.prey === undefined) S.prey = null;
  if (S.preyChoices === undefined) S.preyChoices = null;
  if (S.allies === undefined) S.allies = null;
  if (S.interdiction === undefined) S.interdiction = null;
  if (S.haven === undefined) S.haven = null;
  if (S.escort === undefined) S.escort = null;
  if (S.escortRep == null) S.escortRep = 0;
  if (!S.pirateBands) S.pirateBands = {};
  if (S.commission === undefined) S.commission = null;
  UPGRADES.forEach(u => { if (S.upgrades[u.id] == null) S.upgrades[u.id] = 0; });  // backfill new upgrades (cannons)
  if (S.ironman == null) S.ironman = false;          // backfill for saves from before Custom Start
  if (S.lengthMult == null) S.lengthMult = 1;
  syncObjectives();
  checkMilestones(true);   // veteran saves silently claim whatever they've already earned
  if (!S.disc) S.disc = {}; if (!S.made) S.made = {}; if (S.stats && S.stats.sales == null) S.stats.sales = 0; checkUnlocks(true); checkDisclosure(true); applyTabVisibility();
  applyEink();
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());
  // Captain's Console — game actions live in the sidebar, keeping the top bar
  // to just resources and the cycle button.
  const menu = document.getElementById("gameMenu") || document.querySelector(".brand");
  [
    { label: "⟲ New",      title: "New game (trading start)",                                                                            fn: () => newGame() },
    { label: "🌍 Colonize", title: "New game — skip trading, start ready to colonize",                                                    fn: () => newGame("colony") },
    { label: "🎮 Custom Start", title: "Pick your opening, campaign length, and an optional Ironman challenge",                            fn: () => toggleCustomStart() },
    { label: "🔑 Seed",     title: "View this sector's code, or start a new game from a specific one",                                     fn: () => promptSeedNewGame() },
    { label: "📖 Log",      title: "Download your captain's log — a narrative dossier you can hand to an AI to write your biography or a novel", fn: () => downloadJournal() },
    { label: "💾 Save",     title: "Save this game to a file on your disk (backup, or move between browsers/machines)",                     fn: () => exportSave() },
    { label: "📂 Load",     title: "Load a game from a save file on your disk (replaces the current game)",                                fn: () => importSave(), id: "loadSaveBtn" },
    { label: soundLabel(), title: "Toggle sound effects", fn: () => toggleSound(), id: "soundToggleBtn" },
    { label: einkLabel(), title: "High-contrast black-on-white mode for e-ink readers (Kindle Scribe etc.)", fn: () => toggleEink(), id: "einkToggleBtn" },
    { label: "🆕 What's New", title: "Recent updates to Stellar Frontier",                                                                  fn: () => toggleChangelog() },
    { label: "❓ Help",     title: "How to play, and links to the project",                                                                fn: () => toggleHelp() },
  ].forEach(b => {
    const el = document.createElement("button");
    el.className = "btn btn-sm"; el.textContent = b.label; el.title = b.title;
    if (b.id) el.id = b.id;
    el.addEventListener("click", b.fn); menu.appendChild(el);
  });
  // (No console button for a politics start — careers switch freely in-game; the
  //  Politics tab offers an "Enter Public Life" kickstart instead.)
  applyIronmanUI();
  renderAll(); setTab("galaxy");
  // greet a returning player with what changed since they last played; a brand-new
  // game has nothing to compare against, so it just silently records the version
  if (!isNewGame && S.lastSeenVersion !== APP_VERSION) toggleChangelog();
  S.lastSeenVersion = APP_VERSION;
  saveGame();
  startVersionWatch();
}
window.addEventListener("DOMContentLoaded", init);

Object.assign(window, {
  travel, buyQty, sellQty, buyMax, sellAll, setMarketSort, sellEntireHold, extract, salvage, produce,
  research, researchTech, doPolitics, doMission, buyUpgrade, setDecree,
  buildBase, buildModule, depositQty, withdrawQty, storeAllCargo, fulfilContract,
  colonize, buildColonyBuilding, setTax, colonyDeposit, colonyWithdraw, setOrder, explore, newGame,
  foundOrg, upgradeOrg, runOrgAbility,
  proposeBill, lobbyFaction, bribeFaction, callVote, repealPolicy,
  investLawyer, investBribe, investSpin, investBury, investStrongarm, investScapegoat, faceTrial,
  runForElection, seekAppointment, stageCoup, lobbyLaw, enterPublicLife,
  donateRelief, donateReliefQty, gougeSell, gougeSellQty, lootCrisis, downloadJournal,
  prowl, raidAttack, raidNoQuarter, raidExtort, raidDisengage, raidVolley, raidCallAllies, raidSpareRecruit, raidSummonOnCall, repairShip,
  clearFx, investigateSignal, buySignalScan,
  setBandTag, callBandSupport, bandFollow, bandStandDown, escortRallyOnCall,
  commissionMandate, cancelMandate, setMandateField, reconcileBands, brokerTruce,
  orderShip, scrapShip, repairFleetShip, assignFleetMission, recallFleetMission, setFleetMissionField, raidSummonFleet, escortRallyFleet,
  assignLogistics, recallLogistics, setFleetLogiField,
  deployBattleGroup, recallBattleGroup, setBattleGroupPosture, setBattleGroupFormation,
  acceptEscort, refreshEscortOffers, escortAdvance, escortFire, escortRepair, escortFleetRepair, escortToggleTarget, escortFocus, setEscortPosture, setEscortTarget, escortBreakOff, abortEscort, setVesselStance, upgradeVessel, escortBraceRound, escortRecruitBand, escortDismissBand,
  giftBandCredits, giftBandCargo,
  navyBribe, navyFight, navySurrender, settleWarrants,
  fence, fenceAll, fenceQty, fenceAllPlunder,
  establishHaven, upgradeHaven, layLow, havenStashAll, havenTakeAll,
  acceptCommission, pirateLegacy, marshalLegacy, checkVersion, toggleHelp, toggleShowAllTabs, toggleEink,
  exportSave, importSave, importSaveText, parseSaveText, buildSaveText, toggleBaseTrade, setBaseTradeGood, setBaseTradeColony, baseMarketBuy, baseMarketSell, baseBuyQty, baseSellQty,
  sfx, toggleSound,
  alignColony, colonyIndependence, toggleColonyProcess,
  setSubView,
  huntPirates, engageTarget, standDown, encounterPay, encounterFlee, encounterFight, deepScan, repairSubsys, repairAll, buyPirateMap,
  setCombatPosture, setCombatOffense, setCombatTarget, fieldRepair,
});

/* ============================================================
   STELLAR FRONTIER — rendering: Fleet & Fortunes panels
   Fifth and final tab-specific slice of the rendering layer: the
   Fleet tab (roster, fleet-mission dispatch form, logistics-stationing
   form) and the Fortunes tab (active effects, the Almanac of every
   effect discovered, Signal leads and scan purchases). Both were left
   behind at their respective domain slices (fleet.js in slice 17,
   fortunes.js in slice 18) since no render* function had been
   extracted at that point in the split; this is that extraction now.
   renderAll() the master dispatcher is the only render* function left
   in game.js after this slice, pending the final TABS/PERSISTENCE/
   INIT slice.

   Loaded after renderSettlement.js, before game.js. S, log, toast,
   saveGame and renderAll() still live in game.js at this point in the
   split — safe, since every function here is only CALLED later (by
   renderAll(), itself only ever called after a player action, once
   every script has finished loading), same pattern as every prior
   slice.
   ============================================================ */

"use strict";

/* ----- Fleet ----- */
let fleetMissionForm = { ship: null, planet: null, task: "cull", dur: 6 };
function setFleetMissionField(k, v) { fleetMissionForm[k] = (k === "dur") ? (parseInt(v, 10) || 6) : v; renderFleet(); }
let fleetLogiForm = { planet: null };
function setFleetLogiField(k, v) { fleetLogiForm[k] = v; renderFleet(); }
let tankerRunForm = { ship: null, planet: null, escorts: [] };
function setTankerRunField(k, v) { tankerRunForm[k] = v; renderFleet(); }
function toggleTankerEscort(id) {
  const at = tankerRunForm.escorts.indexOf(id);
  if (at >= 0) tankerRunForm.escorts.splice(at, 1); else tankerRunForm.escorts.push(id);
  renderFleet();
}
// Roster view UI state (status view only): a growing fleet (30+ hulls) turns a flat
// per-role list into a wall of rows, so the roster gets a quick status filter + name
// search (same session-only-var idiom as marketSort, renderProgression.js) and
// collapsible role groups, remembered per role for the session.
let fleetRosterFilter = { status: "all", q: "" };
function setFleetRosterFilter(k, v) { fleetRosterFilter[k] = v; renderFleet(); }
let fleetGroupCollapsed = {};
function toggleFleetGroup(role) { fleetGroupCollapsed[role] = !fleetGroupCollapsed[role]; renderFleet(); }
function renderFleet() {
  const el = (typeof document !== "undefined") && document.getElementById("panel-fleet"); if (!el) return;
  const f = fleetList(), pid = S.location, yard = shipyardTierAt(pid), baseYard = baseShipyardTier(pid);
  const FLEET_VIEWS = [["status", "📊 Fleet Status"], ["assign", "🎯 Assignments"], ["shipyard", "🏗️ Shipyard"]];
  const view = subView("fleet", FLEET_VIEWS);
  let body;
  if (view === "status") {
    const bar = (h, m) => { const pct = Math.max(0, Math.round(h / m * 100)), col2 = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)"; return `<div class="bar"><span style="width:${pct}%;background:${col2}"></span></div>`; };
    const shipRow = s => {
      const def = FLEET_SHIPS[s.key]; if (!def) return "";
      const homeName = (PLANETS.find(p => p.id === s.home) || {}).name || "—", here = s.home === pid && yard > 0, rc = fleetRepairCost(s);
      const onMission = s.status === "mission" && s.mission, onLogi = s.status === "logistics", onConvoy = s.status === "convoy", onPatrol = s.status === "patrol";
      const onRun = s.status === "tanker_run" && s.run, onRunEscort = s.status === "tanker_run" && s.escortFor;
      const status = s.status === "building" ? `<span style="color:var(--warn)">🏗️ building (${s.buildLeft} cyc)</span>`
        : onMission ? `<span style="color:var(--accent)">🎯 ${MANDATE_TASKS[s.mission.task].name} @ ${mdPlanetName(s.mission.planet)} (${s.mission.cyclesLeft} cyc · +${fmt(s.mission.accrued)} cr)</span>`
        : s.status === "escort" ? `<span style="color:var(--accent)">🛡️ escorting a convoy</span>`
        : onRun ? `<span style="color:var(--accent)">⛽ running ${s.run.fuel} fuel to ${mdPlanetName(s.run.to)} (${s.run.cyclesLeft}/${s.run.totalCycles} cyc)</span>`
        : onRunEscort ? `<span style="color:var(--accent)">🛡️ escorting a tanker run</span>`
        : onLogi ? `<span style="color:var(--accent)">${def.role === "freighter" ? "🚚 hauling for" : "🛡️ guarding"} ${mdPlanetName(s.station)}</span>`
        : onConvoy ? `<span style="color:var(--accent)">🚚 riding in your personal convoy</span>`
        : onPatrol ? `<span style="color:var(--accent-2)">🛰️ following you</span>`
        : `<span style="color:var(--good)">idle</span>`;
      const repBtn = (s.status === "idle" && rc.miss > 0 && here) ? `<button class="btn btn-sm" title="Repair at home shipyard" onclick="repairFleetShip('${s.id}')">🔧 ${fmt(rc.credits)}</button>` : "";
      const canReassign = s.status === "idle" && !here && yard > 0 && def.tier <= yard;
      const reassignBtn = canReassign ? `<button class="btn btn-sm" title="Re-register this ship's home port to ${currentPlanet().name} (${fmt(shipyardReassignCost(def))} cr)" onclick="reassignShipyard('${s.id}')">⚓ Reassign here</button>` : "";
      // a warship must follow you before it can answer a raid call (2-ally summon or Battle
      // Group) — this is the assignment action; "Reassign here" (above) only ever moves a
      // ship's home shipyard, a separate concept.
      const canPatrol = s.status === "idle" && def.role === "warship";
      const patrolBtn = canPatrol ? `<button class="btn btn-sm" title="Follow you — on call for raids anywhere (2-ally summon or Battle Group) until recalled" onclick="assignPatrol('${s.id}')">🛰️ Follow me</button>` : "";
      // Tanker Load/Unload: manual cargo management for an idle tanker docked right here — no
      // Shipyard required (just a storeroom to draw from/deposit into), unlike repair/reassign/refit.
      const dockedHere = s.status === "idle" && s.home === pid;
      let loadBtn = "", unloadBtn = "";
      if (dockedHere && def.role === "tanker") {
        const b = S.bases[pid], col = S.colonies[pid];
        const localFuel = ((b && b.storage.fuel) || 0) + ((col && col.storage.fuel) || 0);
        const full = (s.fuel || 0) >= shipCargoCap(s);
        if (localFuel > 0 && !full) loadBtn = `<button class="btn btn-sm" title="Load fuel from the base/colony here" onclick="loadTanker('${s.id}')">⬆️⛽ Load</button>`;
        if ((s.fuel || 0) > 0) unloadBtn = `<button class="btn btn-sm" title="Unload — tops off your own tank first, then the base, then the colony, selling anything left over" onclick="unloadTanker('${s.id}')">⬇️⛽ Unload</button>`;
      }
      const scrapPct = scrapRefundPct(), scrapBonusOn = scrapPct > SCRAP_REFUND_PCT, scrapRefund = Math.round((def.cost.metals || 0) * scrapPct);
      const ctlBtn = onMission ? `<button class="btn btn-sm" title="Recall — bank what it's earned" onclick="recallFleetMission('${s.id}')">↩ Recall</button>`
        : (onRun && s.run.cyclesLeft === s.run.totalCycles) ? `<button class="btn btn-sm" title="Turn back before clearing port — fuel refunded" onclick="recallTankerRun('${s.id}')">↩ Recall</button>`
        : onLogi ? `<button class="btn btn-sm" title="Recall from logistics duty" onclick="recallLogistics('${s.id}')">↩ Recall</button>`
        : onConvoy ? `<button class="btn btn-sm" title="Recall from your convoy" onclick="recallConvoy('${s.id}')">↩ Recall</button>`
        : onPatrol ? `<button class="btn btn-sm" title="Stop following you" onclick="recallPatrol('${s.id}')">↩ Recall</button>`
        : s.status === "building" || s.status === "escort" || onRun || onRunEscort ? "" : `<button class="btn btn-sm btn-bad" title="Scrap this ship (salvages ${scrapRefund} metals${scrapBonusOn ? " — recycling bonus" : ""})" onclick="scrapShip('${s.id}')">♻️ ${scrapRefund}${scrapBonusOn ? "✦" : ""}</button>`;
      const spec = def.role === "warship" ? `🔥${shipStrEff(s)} · 🛡️${s.hullMax}`
        : def.role === "tanker" ? `⛽${shipCargoCap(s)} · 🐌${Math.round(fleetShipSpeed(def) * 100)}%${(s.fuel || 0) > 0 ? ` · 🛢️${s.fuel} loaded` : ""}`
        : `📦${shipCargoCap(s)} cargo`;
      // ---- Small Shipyard customization: commit an idle hull to a Cargo or Combat
      // lean, up to 3 levels, only while docked at its home base's Small Shipyard ----
      const lvl = s.loadoutLevel || 0, maxed = lvl >= LOADOUT_MAX_LEVEL;
      const canRefit = s.status === "idle" && s.home === pid && baseYard > 0;
      let loadoutRow = "";
      if (s.loadout || canRefit) {
        const badge = s.loadout ? `<span class="hint">${LOADOUT_LEANS[s.loadout].ico} ${LOADOUT_LEANS[s.loadout].name} Lv${lvl}/${LOADOUT_MAX_LEVEL}</span>` : `<span class="hint">🛠️ Small Shipyard refit available</span>`;
        let btns = "";
        if (canRefit && !maxed) {
          const cost = loadoutUpgradeCost(lvl + 1), costStr = Object.keys(cost).map(k => `${cost[k]}${COM[k].ico}`).join(" ");
          if (!s.loadout || s.loadout === "cargo") btns += `<button class="btn btn-sm" title="${LOADOUT_LEANS.cargo.hint} (${costStr})" onclick="upgradeLoadout('${s.id}','cargo')">📦 Cargo Lv${lvl + 1}</button> `;
          if (!s.loadout || s.loadout === "combat") btns += `<button class="btn btn-sm" title="${LOADOUT_LEANS.combat.hint} (${costStr})" onclick="upgradeLoadout('${s.id}','combat')">🔥 Combat Lv${lvl + 1}</button>`;
        }
        loadoutRow = `<div class="ship-stat" style="margin-top:2px">${badge}<span class="v">${btns}</span></div>`;
      }
      return `<div class="ship-stat" style="align-items:center">
        <span class="k">${def.ico} ${s.name} <span class="hint">${SHIP_CLASSES[def.cls].name} · ${spec} · ⚓ ${homeName}</span></span>
        <span class="v" style="min-width:160px">${s.status === "building" ? status : bar(s.hull, s.hullMax) + `<span class="hint">${status} · ${Math.round(s.hull)}/${s.hullMax}</span>`} ${repBtn}${reassignBtn}${patrolBtn}${loadBtn}${unloadBtn}${ctlBtn}</span></div>${loadoutRow}`;
    };
    const ROLE_GROUPS = [["warship", "⚔️ Warships"], ["freighter", "🚚 Freighters"], ["tanker", "⛽ Tankers"]];
    const isDamaged = s => s.status !== "building" && s.hullMax > 0 && (s.hull / s.hullMax) < 0.6;
    const idleN = f.filter(s => s.status === "idle").length, buildingN = f.filter(s => s.status === "building").length;
    const damagedN = f.filter(isDamaged).length, dutyN = f.length - idleN - buildingN;
    const STATUS_FILTERS = [["all", "All"], ["idle", "🟢 Idle"], ["duty", "🎯 On duty"], ["damaged", "🩹 Damaged"], ["building", "🏗️ Building"]];
    const matchesRosterFilter = s => {
      const q = fleetRosterFilter.q.trim().toLowerCase();
      if (q && !s.name.toLowerCase().includes(q)) return false;
      const st = fleetRosterFilter.status;
      if (st === "idle") return s.status === "idle";
      if (st === "duty") return s.status !== "idle" && s.status !== "building";
      if (st === "damaged") return isDamaged(s);
      if (st === "building") return s.status === "building";
      return true;
    };
    const byShipName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
    const roleGroup = role => f.filter(s => FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === role).sort(byShipName);
    const roleSection = (role, label) => {
      const all = roleGroup(role); if (!all.length) return "";
      const shown = all.filter(matchesRosterFilter), collapsed = !!fleetGroupCollapsed[role];
      const countLabel = shown.length === all.length ? `${all.length}` : `${shown.length}/${all.length}`;
      return `<div class="ship-stat" style="margin-top:6px;cursor:pointer" onclick="toggleFleetGroup('${role}')">
        <span class="k">${collapsed ? "▸" : "▾"} ${label} <span class="hint">${countLabel}</span></span></div>
        ${collapsed ? "" : (shown.length ? shown.map(shipRow).join("") : '<div class="hint" style="margin-left:14px">No ships here match your filter.</div>')}`;
    };
    const filterBtns = STATUS_FILTERS.map(([k, l]) => `<button class="btn btn-sm ${fleetRosterFilter.status === k ? "btn-primary" : ""}" onclick="setFleetRosterFilter('status','${k}')">${l}</button>`).join(" ");
    const searchBox = `<input class="chat-field" style="max-width:180px" type="text" placeholder="Search by name…" value="${escapeChatHtml(fleetRosterFilter.q)}" oninput="setFleetRosterFilter('q', this.value)" />`;
    const anyShown = ROLE_GROUPS.some(([role]) => roleGroup(role).some(matchesRosterFilter));
    body = `<div class="card"><h4>✦ Your Fleet <span class="hint">${f.length} ship(s) · upkeep ${fmt(fleetUpkeep())} cr/cyc</span></h4>
      ${f.length ? `<div class="hint">${idleN} 🟢 idle · ${dutyN} 🎯 on duty · ${damagedN} 🩹 damaged${buildingN ? ` · ${buildingN} 🏗️ building` : ""}</div>
        ${f.length > 8 ? `<div class="row" style="margin-top:4px;flex-wrap:wrap;gap:4px;align-items:center">${filterBtns} ${searchBox}</div>` : ""}
        ${ROLE_GROUPS.map(([role, label]) => roleSection(role, label)).join("")}
        ${anyShown ? "" : '<div class="hint" style="margin-top:8px">No ships match your filter.</div>'}`
        : '<div class="hint">No ships yet — lay down a hull in the 🏗️ Shipyard tab.</div>'}</div>`;
  } else if (view === "assign") {
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
      const idleWar2 = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
      const frBtns = idleFr.map(s => `<button class="btn btn-sm btn-good" onclick="assignLogistics('${s.id}','${lf.planet}')">🚚 ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
      const warBtns = idleWar2.map(s => `<button class="btn btn-sm" onclick="assignLogistics('${s.id}','${lf.planet}')">🛡️ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
      logiCard = `<div class="card"><h4>🚚 Logistics duty</h4>
        <div class="hint">Station <b>freighters</b> at one of your colonies to haul its goods — cutting its market import fee and base↔colony freight. Pirate-active systems risk an <b>ambush</b> (your freighter takes damage and loses goods); station a <b>warship</b> there to guard the convoy and cut that risk. Activity shows for systems you hold intel on.</div>
        <div class="row" style="margin-top:8px;align-items:center"><span class="hint">Colony</span> <select onchange="setFleetLogiField('planet',this.value)">${colOpts}</select></div>
        <div class="ship-stat" style="margin-top:6px"><span class="k">Stationed</span><span class="v">${haulers.length} hauler(s) · ${guards.length} guard(s)</span></div>
        <div class="ship-stat"><span class="k">Transport savings</span><span class="v">−${feeDisc}% import fee · −${frDisc}% freight</span></div>
        ${haulers.length ? `<div class="ship-stat"><span class="k">Ambush risk</span><span class="v" style="color:${risk >= 15 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--good)"}">${risk}%/cyc${guards.length ? " (guarded)" : plv > 0 ? " — unguarded!" : ""}</span></div>` : ""}
        ${idleFr.length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign hauler</span> ${frBtns}</div>` : ""}
        ${idleWar2.length ? `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Assign guard</span> ${warBtns}</div>` : ""}
        ${!idleFr.length && !idleWar2.length ? '<div class="hint" style="margin-top:6px">No idle ships to assign — build more, or recall some.</div>' : ""}</div>`;
    }
    // ---- personal convoy: freighters ride WITH you; warships + following bands escort ----
    let convoyCard = "";
    if (f.length) {
      const inConvoy = convoyShips(), frGuardN = convoyWarships().length, bandGuards = bandList().filter(bandFollowing);
      const guards = frGuardN + bandGuards.length;
      const bonus = convoyCargoBonus(), ceil = convoyCargoCeiling();
      const surcharge = Math.round(convoyFuelSurcharge() * 100);
      const oddsPct = Math.round(Math.pow(0.45, guards) * 100);
      const idleFrHere = f.filter(s => s.status === "idle" && s.home === S.location && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "freighter");
      const idleWarHere = f.filter(s => s.status === "idle" && s.home === S.location && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
      const rosterRows = inConvoy.map(s => { const d = FLEET_SHIPS[s.key];
        return `<div class="ship-stat"><span class="k">${d.ico} ${s.name}</span><span class="v">${d.role === "freighter" ? `📦${shipCargoCap(s)}` : `🔥${shipStrEff(s)}`} · ${Math.round(s.hull)}/${s.hullMax} <button class="btn btn-sm" onclick="recallConvoy('${s.id}')">↩ Recall</button></span></div>`;
      }).join("");
      const frBtns = idleFrHere.map(s => `<button class="btn btn-sm btn-good" onclick="assignConvoy('${s.id}')">🚚 ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
      const warBtns = idleWarHere.map(s => `<button class="btn btn-sm" onclick="assignConvoy('${s.id}')">🛡️ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join(" ");
      convoyCard = `<div class="card"><h4>🚚 Personal Convoy</h4>
        <div class="hint">Have freighters ride with you on every jump — a second hold on the road, on top of your own ship's. It costs extra fuel to tow, and it isn't risk-free: pirates ambushing you also take a swipe at the convoy. Warships (and any pirate bands currently riding with you) escort it — cutting the odds of a travel ambush, and softening the blow if one slips through anyway. Only idle ships docked <b>here</b>, at their home port, can come aboard.</div>
        <div class="ship-stat"><span class="k">Bonus cargo</span><span class="v">+${fmt(bonus)}${bonus >= ceil && ceil > 0 ? ` <span class="hint">(capped — Cargo Hold upgrade sets the ceiling: ${fmt(ceil)})</span>` : ` <span class="hint">of a ${fmt(ceil)} ceiling</span>`}</span></div>
        <div class="ship-stat"><span class="k">Fuel surcharge</span><span class="v">+${surcharge}% per jump</span></div>
        <div class="ship-stat"><span class="k">Guards</span><span class="v">${frGuardN} warship(s)${bandGuards.length ? ` + ${bandGuards.length} following band(s)` : ""} → ambush odds ×${oddsPct}%</span></div>
        ${bandGuards.length ? `<div class="hint">🏴 Following: ${bandGuards.map(b => b.ico + " " + b.name).join(", ")} (manage from 🤝 Contacts).</div>` : ""}
        ${inConvoy.length ? rosterRows : '<div class="hint">No ships in your convoy yet.</div>'}
        ${idleFrHere.length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Add freighter</span> ${frBtns}</div>` : ""}
        ${idleWarHere.length ? `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Add warship</span> ${warBtns}</div>` : ""}
        ${!idleFrHere.length && !idleWarHere.length && !inConvoy.length ? '<div class="hint" style="margin-top:6px">No idle ships docked here — build one, or fly to where an idle ship of yours is stationed.</div>' : ""}</div>`;
    }
    // ---- Tanker Runs: dispatch an idle tanker on an autonomous, multi-cycle fuel-hauling run ----
    const idleTankers = f.filter(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "tanker");
    let tankerCard = "";
    if (idleTankers.length) {
      const tf = tankerRunForm;
      if (!tf.ship || !idleTankers.some(s => s.id === tf.ship)) { tf.ship = idleTankers[0].id; tf.escorts = []; }
      const ship = fleetList().find(x => x.id === tf.ship);
      const home = PLANETS.find(p => p.id === ship.home);
      const known = PLANETS.filter(p => isActive(p) && galaxyKnown(p) && p.id !== ship.home);
      if (!tf.planet || !known.some(p => p.id === tf.planet)) tf.planet = known.length ? known[0].id : null;
      const shipOpts = idleTankers.map(x => `<option value="${x.id}" ${x.id === tf.ship ? "selected" : ""}>${FLEET_SHIPS[x.key].ico} ${x.name} (⚓ ${mdPlanetName(x.home)})</option>`).join("");
      const planetOpts = known.map(p => `<option value="${p.id}" ${p.id === tf.planet ? "selected" : ""}>${p.name} · ${pirateIntelKnows(p.id) ? pirateLevelLabel(pirateLevel(p.id)) : "activity ❔"}</option>`).join("");
      const idleWarHome = f.filter(s => s.status === "idle" && s.home === ship.home && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship");
      tf.escorts = tf.escorts.filter(id => idleWarHome.some(s => s.id === id));
      const escortBtns = idleWarHome.map(s => `<button class="btn btn-sm ${tf.escorts.includes(s.id) ? "btn-primary" : ""}" onclick="toggleTankerEscort('${s.id}')">🛡️ ${s.name}</button>`).join(" ");
      const dist = tf.planet ? ((home && home.distances && home.distances[tf.planet]) || 6) : 0;
      const speed = fleetShipSpeed(FLEET_SHIPS[ship.key]);
      const cycles = tf.planet ? tankerRunCycles(dist, speed) : 0;
      const cap = shipCargoCap(ship);
      const local = shipyardLocalStorage(ship.home);
      const already = ship.fuel || 0;
      const avail = already + Math.min(cap - already, ((local && local.fuel) || 0) + (S.res.fuel || 0));
      const destPlanet = tf.planet && PLANETS.find(p => p.id === tf.planet);
      const risk = tf.planet ? Math.round((0.05 + Math.max(pirateLevel(tf.planet), pirateLevel(ship.home)) * 0.04) * Math.pow(0.45, tf.escorts.length) * 100) : 0;
      const escortArgs = `[${tf.escorts.map(id => `'${id}'`).join(",")}]`;
      tankerCard = `<div class="card"><h4>⛽ Dispatch a tanker run</h4>
        <div class="hint">Send an idle tanker to haul fuel to another world on its own — any fuel already loaded aboard (⬆️⛽ Load, in the roster) tops off first, then it draws the rest from its home's stockpile (then your hold), and takes several cycles to arrive since tankers are slow by design. Delivering to one of your own colonies/bases tops up its storage; anywhere else, the fuel is sold at the local market. The trip risks a pirate ambush (damage &amp; lost fuel — an escorting warship cuts the odds) and, if you're Wanted, a navy interception that confiscates the cargo outright.</div>
        <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
          <span class="hint">Tanker</span><select onchange="setTankerRunField('ship',this.value)">${shipOpts}</select>
          <span class="hint">Destination</span><select onchange="setTankerRunField('planet',this.value)">${planetOpts}</select></div>
        ${idleWarHome.length ? `<div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Escort (from the same home port)</span> ${escortBtns}</div>` : ""}
        <div class="ship-stat" style="margin-top:8px"><span class="k">Load</span><span class="v">${avail} fuel ⛽ · ${cycles} cycle(s)${destPlanet ? ` to ${destPlanet.name}` : ""}</span></div>
        ${tf.planet ? `<div class="ship-stat"><span class="k">Piracy risk</span><span class="v" style="color:${risk >= 15 ? "var(--bad)" : risk > 0 ? "var(--warn)" : "var(--good)"}">${risk}%/cyc${tf.escorts.length ? " (escorted)" : ""}</span></div>` : ""}
        ${(S.pirate && S.pirate.wanted >= 25) ? `<div class="hint" style="color:var(--bad)">⚠️ You're Wanted — lawful worlds may intercept the run and confiscate its cargo.</div>` : ""}
        <div class="row" style="margin-top:8px"><button class="btn btn-primary" ${tf.planet && avail > 0 ? "" : "disabled"} onclick="assignTankerRun('${tf.ship}','${tf.planet}',${escortArgs})">⛽ Dispatch (${cycles} cyc)</button></div>
      </div>`;
    }
    // ---- reinforce a Tanker Run already under way — same idea as escortRallyFleet rallying more
    // hulls into an already-active Escort convoy, but for a tanker traveling on its own ----
    const activeRuns = f.filter(s => s.status === "tanker_run" && s.run);
    let reinforceCard = "";
    if (activeRuns.length) {
      const rows = activeRuns.map(s => {
        const runDef = FLEET_SHIPS[s.key];
        const idleWarHome2 = f.filter(w => w.status === "idle" && w.home === s.home && FLEET_SHIPS[w.key] && FLEET_SHIPS[w.key].role === "warship");
        const guardBtns = idleWarHome2.map(w => `<button class="btn btn-sm" onclick="reinforceTankerRun('${s.id}','${w.id}')">🛡️ ${w.name}</button>`).join(" ");
        return `<div class="ship-stat" style="align-items:center">
          <span class="k">${runDef.ico} ${s.name} <span class="hint">→ ${mdPlanetName(s.run.to)} · ${s.run.cyclesLeft}/${s.run.totalCycles} cyc · ${tankerRunGuards(s)} escort(s) · from ⚓ ${mdPlanetName(s.home)}</span></span>
          <span class="v">${idleWarHome2.length ? guardBtns : '<span class="hint">No idle warships at its home port</span>'}</span></div>`;
      }).join("");
      reinforceCard = `<div class="card"><h4>🛡️ Reinforce a tanker run</h4>
        <div class="hint">Send more of your idle warships — docked at the same home port the tanker departed from — to join its escort mid-transit, cutting the odds of a pirate ambush for the rest of the trip.</div>
        ${rows}</div>`;
    }
    body = `${missionCard}${logiCard}${convoyCard}${tankerCard}${reinforceCard}${!missionCard && !logiCard && !convoyCard && !tankerCard && !reinforceCard ? '<div class="card"><div class="hint">No idle warships to dispatch, no colonies yet to station freighters at, no idle ships docked here for a convoy, no idle tankers for a fuel run, and no tanker runs to reinforce. Build a ship in the 🏗️ Shipyard tab, or found a colony first.</div></div>' : ""}`;
  } else {
    let yardCard;
    if (yard <= 0) {
      yardCard = `<div class="card"><div class="hint">🏗️ Dock at one of your colonies with a <b>Shipyard</b> (🌍 Colonies tab, needs Metallurgy), or a base with a <b>Small Shipyard</b> module (🏗️ Bases tab), to build ships.</div></div>`;
    } else {
      const venue = shipyardVenueAt(pid);
      const slips = fleetBuildingAt(pid);
      const local = shipyardLocalStorage(pid);
      const rows = FLEET_SHIP_KEYS.filter(k => FLEET_SHIPS[k].tier <= yard).map(k => {
        const d = FLEET_SHIPS[k], mats = fleetMatsOf(d), matStr = fleetMatsString(mats, local);
        const ok = (S.res.credits || 0) >= d.cost.credits && canAffordMats(mats, local) && slips < yard;
        const spec = d.role === "warship" ? `🔥${fleetShipStr(d)} · 🛡️${fleetShipHullMax(d)}` : d.role === "tanker" ? `⛽${d.cap} · 🐌${Math.round(fleetShipSpeed(d) * 100)}%` : `📦${d.cap}`;
        return `<div class="ship-stat" style="align-items:center"><span class="k">${d.ico} ${d.name} <span class="hint">${spec} · ⏱️${d.build} cyc · T${d.tier}</span></span>
          <span class="v"><span class="hint">${fmt(d.cost.credits)} cr ${matStr}</span> <button class="btn btn-sm ${ok ? "btn-good" : ""}" ${ok ? "" : "disabled"} title="${slips >= yard ? "All slipways busy" : ""}" onclick="orderShip('${k}')">Build</button></span></div>`;
      }).join("");
      const upgradeHint = venue === "base" ? "upgrade the Small Shipyard module in the 🏗️ Bases tab" : "upgrade it in the 🌍 Colonies tab";
      const venueNote = venue === "base" ? ` <span class="hint">(Small Shipyard — light hulls only)</span>` : "";
      const sourceNote = venue === "colony" ? "the colony's stockpile" : "the base's stockpile";
      yardCard = `<div class="card"><h4>🏗️ ${currentPlanet().name} Shipyard <span class="hint">Tier ${yard} · slipways ${slips}/${yard}</span>${venueNote}</h4>
        <div class="hint">Lay down hulls up to Tier ${yard}; construction takes several cycles and draws materials from ${sourceNote} first, then your own hold for any shortfall. A bigger yard adds slipways for parallel builds (${upgradeHint}).</div>
        ${rows}</div>`;
    }
    body = yardCard;
  }
  el.innerHTML = `<h2>✦ Fleet</h2>
    <div class="subtitle">Your own ships, built at colony shipyards — loyal and fully under your command. <b>Freighters</b> haul your goods; <b>warships</b> fight or work systems on contract; <b>tankers</b> haul fuel on their own multi-cycle runs, slow but built for the job. They cost credits &amp; materials to build and draw upkeep each cycle (see the 💰 Cycle accounts log). Call ships into your raids/escorts, or deploy your whole idle fleet as a raid Battle Group.</div>
    ${subTabBar("fleet", FLEET_VIEWS)}
    ${body}`;
}

/* ----- Fortunes ----- */
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

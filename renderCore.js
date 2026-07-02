/* ============================================================
   STELLAR FRONTIER — core rendering: chrome & galaxy
   The first slice of the rendering layer: the always-visible UI chrome
   (the top resources bar, the sidebar ship-stats card, the live
   Operations digest of every timed/background activity, active
   Fortunes/Signals sidebar widgets, the ship log, Sector Relations and
   Contested Worlds cards, repBar()) and the Galaxy tab (the starmap
   and its lane-graph SVG, plus the exploration cards). Every other
   render* function (Market, Industry, Research, Politics, Missions,
   Ship, Raid, Contacts, Bases, Colonies, Escort, and renderAll() the
   master dispatcher) stays in game.js for its own future slice —
   this is the first cut of a domain too large for one, not the whole
   thing.

   Loaded after escort.js, before game.js. S, log, saveGame and every
   render* function not listed above still live in game.js at this
   point in the split — safe, since every function here is only
   CALLED later (by renderAll(), itself only ever called after a
   player action, once every script has finished loading), same
   pattern as every prior slice.
   ============================================================ */

"use strict";

function renderResources() {
  const el = document.getElementById("resources");
  const items = [
    ["credits", fmt(S.res.credits), ""],
    ["fuel", `${S.res.fuel}/${fuelCap()}`, ""],
    ["tech", fmt(S.res.tech), ""],
    ["influence", fmt(S.res.influence), ""],
  ].map(([k, v]) => `<div class="res" title="${META[k].name}"><span class="ico">${META[k].ico}</span><span class="val">${v}</span></div>`);
  items.push(`<div class="res" title="Cargo hold"><span class="ico">🚚</span><span class="val">${cargoUsed()}/${cargoCap()}</span></div>`);
  el.innerHTML = items.join("");
}
function renderShip() {
  document.getElementById("currentPlanet").textContent = currentPlanet().name;
  const cu = cargoUsed(), cc = cargoCap();
  const held = CARGO_IDS.filter(c => S.res[c] > 0)
    .map(c => `${COM[c].ico}${S.res[c]}`).join("  ") || '<span class="hint">empty</span>';
  const mods = UPGRADES.filter(u => S.upgrades[u.id] > 0).map(u => `${u.ico}${S.upgrades[u.id]}`).join(" ");
  const modeBadges = [
    S.ironman ? '<span class="pill bad" title="Loading a save is disabled for this run">☠️ Ironman</span>' : "",
    S.lengthMult && S.lengthMult < 1 ? '<span class="pill" title="Shorter net-worth &amp; colony legacy goals">🏃 Sprint</span>' : "",
    S.lengthMult && S.lengthMult > 1 ? '<span class="pill" title="Bigger net-worth &amp; colony legacy goals">🏔️ Marathon</span>' : "",
    S.trimRefit ? `<span class="pill" title="Refitting to ${SHIP_TRIMS[S.trimRefit.target].name} — ${S.trimRefit.cyclesLeft} cyc left">🛠️ Refitting (${S.trimRefit.cyclesLeft}c)</span>`
      : S.trim && S.trim !== "balanced" ? `<span class="pill" title="${shipTrim().hint}">${shipTrim().ico} ${shipTrim().name} trim</span>` : "",
  ].join(" ").trim();
  document.getElementById("shipStats").innerHTML =
    `${modeBadges ? `<div class="ship-stat" style="margin-bottom:6px">${modeBadges}</div>` : ""}
     <div class="ship-stat"><span class="k">Cargo</span><span class="v">${cu}/${cc}</span></div>
     <div class="bar"><span style="width:${Math.min(100, cu/cc*100)}%"></span></div>
     <div class="ship-stat" style="margin-top:6px"><span class="k">Fuel</span><span class="v">${S.res.fuel}/${fuelCap()}</span></div>
     <div class="bar"><span style="width:${Math.min(100, S.res.fuel/fuelCap()*100)}%"></span></div>
     <div class="ship-stat" style="margin-top:8px"><span class="k">Actions</span><span class="v">${actionsLeft()}/${actionsMax()}</span></div>
     ${(S.pirate && S.pirate.hull < HULL_MAX) ? `<div class="ship-stat" style="margin-top:6px"><span class="k">Hull</span><span class="v" style="color:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}">${S.pirate.hull}/${HULL_MAX}</span></div>
     <div class="bar"><span style="width:${S.pirate.hull}%;background:${S.pirate.hull>=60?'var(--good)':S.pirate.hull>=30?'var(--warn)':'var(--bad)'}"></span></div>` : ""}
     <div class="ship-stat" style="margin-top:8px"><span class="k">Hold</span></div>
     <div style="font-size:12px;line-height:1.7">${held}</div>
     ${mods ? `<div class="ship-stat" style="margin-top:8px"><span class="k">Mods</span></div><div style="font-size:13px">${mods}</div>` : ""}`;
}
// ---- Operations board: one live digest of every timed/background activity ----
function renderOps() {
  const el = (typeof document !== "undefined") && document.getElementById("opsPanel"); if (!el) return;
  const rows = [];
  const row = (ico, txt, cyc, tab, col) => rows.push(`<div class="ship-stat" style="align-items:center${tab ? ";cursor:pointer" : ""}"${tab ? ` onclick="setTab('${tab}')" title="Open the ${tab} tab"` : ""}>
    <span class="k">${ico} <span class="hint">${txt}</span></span>${cyc != null ? `<span class="v"${col ? ` style="color:${col}"` : ""}>${cyc}</span>` : ""}</div>`);
  // combat first (most urgent)
  if (S.interdiction) row("🚨", "Navy interdiction", null, "raid", "var(--bad)");
  if (S.encounter) row("🏴", `Ambush: ${S.encounter.name}`, null, "raid", "var(--bad)");
  if (S.prey) row("🎯", `Engaging ${S.prey.name}`, null, "raid", "var(--warn)");
  if (S.jail > 0) row("⛓️", "In detention", S.jail + "c", null, "var(--bad)");
  if (S.trimRefit) row("🛠️", `Refitting → ${SHIP_TRIMS[S.trimRefit.target].ico} ${SHIP_TRIMS[S.trimRefit.target].name} trim`, S.trimRefit.cyclesLeft + "c", "ship", "var(--warn)");
  // your fleet
  fleetList().forEach(s => { const def = FLEET_SHIPS[s.key]; if (!def) return;
    if (s.status === "building") row("🏗️", `${def.ico} ${s.name} building`, s.buildLeft + "c", "fleet", "var(--warn)");
    else if (s.status === "mission" && s.mission) row(MANDATE_TASKS[s.mission.task].ico, `${def.ico} ${s.name} · ${MANDATE_TASKS[s.mission.task].name} @ ${mdPlanetName(s.mission.planet)} <span style="color:var(--gold)">+${fmt(s.mission.accrued)}</span>`, s.mission.cyclesLeft + "c", "fleet", "var(--accent)");
    else if (s.status === "logistics") row(def.role === "freighter" ? "🚚" : "🛡️", `${def.ico} ${s.name} · ${def.role === "freighter" ? "hauling for" : "guarding"} ${mdPlanetName(s.station)}`, null, "fleet", "var(--accent)");
    else if (s.status === "escort") row("🛡️", `${def.ico} ${s.name} · escorting`, null, "escort", "var(--accent)");
    else if (s.status === "battle") row(FORMATION_SLOTS[shipFormation(s)].ico, `${def.ico} ${s.name} · ${FORMATION_SLOTS[shipFormation(s)].name} (${Math.round(s.hull)}/${s.hullMax})`, null, "raid", "var(--bad)");
    else if (s.status === "convoy") row("🚚", `${def.ico} ${s.name} · riding in your convoy (${Math.round(s.hull)}/${s.hullMax})`, null, "fleet", "var(--accent)");
  });
  // pirate mandates
  (S.mandates || []).forEach(m => { const b = bandById(m.bandId), t = MANDATE_TASKS[m.task]; if (!t) return;
    row(t.ico, `${b ? b.ico + " " + b.name : "crew"} · ${t.name} @ ${mdPlanetName(m.planet)} <span style="color:var(--gold)">+${fmt(m.accrued)}</span>`, m.cyclesLeft + "c", "contacts", "var(--accent)"); });
  // active escort run
  if (S.escort && S.escort.active && S.escort.mission) { const m = S.escort.mission, left = m.deadline != null ? Math.max(0, m.deadline - S.turn) : null;
    row(m.pirate ? "🏴" : "🛡️", `${m.pirate ? "Smuggling run" : "Escort"} → ${mdPlanetName(m.to)} · leg ${m.legs - m.legsLeft}/${m.legs}`, left != null ? left + "c" : null, "escort", left != null && left <= 2 ? "var(--bad)" : "var(--warn)"); }
  // letter of marque
  if (S.commission) { const c = S.commission; row("📜", `Marque vs ${FACTIONS[c.target].name} · ${c.done}/${c.quota} raids`, Math.max(0, c.expires - S.turn) + "c", "raid", "var(--good)"); }
  // sector relations: only the newsworthy tiers (war/alliance) — cold war & peace are the boring baseline
  ensureFactionRel();
  FACTION_KEYS.forEach((a, i) => FACTION_KEYS.slice(i + 1).forEach(b => {
    const rel = factionRelation(a, b);
    if (rel.tier === "war") row("⚔️", `${FACTIONS[a].name} &amp; ${FACTIONS[b].name} at war`, null, "politics", "var(--bad)");
    else if (rel.tier === "alliance") row("🤝", `${FACTIONS[a].name} &amp; ${FACTIONS[b].name} allied`, null, "politics", "var(--good)");
  }));
  // brotherhood: following / standing by / inbound
  bandList().forEach(b => {
    if (bandFollowing(b)) row("🛰️", `${b.ico} ${b.name} following`, (b.followUntil - S.turn) + "c", "contacts", "var(--good)");
    else if (bandOnCall(b)) row("📣", `${b.ico} ${b.name} standing by`, (b.onCallUntil - S.turn) + "c", "contacts", "var(--good)");
    else if (bandInbound(b)) row("📣", `${b.ico} ${b.name} inbound`, (b.inboundTurn - S.turn) + "c", "contacts", "var(--warn)");
  });
  // rising pirate powers: any band that's carved out its own haven
  bandsWithHaven().forEach(b => row("👑", `${b.ico} ${b.name}'s haven @ ${mdPlanetName(b.haven.planet)} · tier ${b.haven.tier}`, null, "contacts", "var(--bad)"));
  // territory under active contest
  Object.entries(S.territoryControl || {}).forEach(([pid, c]) => row("🚩", `${mdPlanetName(pid)} contested by ${FACTIONS[c.challenger].name}`, Math.round(c.meter) + "%", "galaxy", "var(--bad)"));
  const opsHtml = rows.join("");
  const fxHtml = renderFortunes(), sigHtml = renderSignals();   // active Fortunes (clearable) + signals (investigate)
  el.innerHTML = (opsHtml || fxHtml || sigHtml) ? `<h3>📋 Operations</h3>${opsHtml}${fxHtml}${sigHtml}` : "";
}
function renderSignals() {
  const sig = Array.isArray(S.signals) ? S.signals : [];
  if (!sig.length) return "";
  const rows = sig.map(s => {
    const k = SIGNAL_KINDS[s.kind], here = s.planet === S.location;
    const dist = here ? 0 : ((currentPlanet().distances || {})[s.planet] || "?");
    const fuel = SIGNAL_FUEL[s.tier] || 6, tl = ["", "faint", "strong", "rare"][s.tier];
    const can = here && actionsLeft() > 0 && S.res.fuel >= fuel && !(typeof combatLocked === "function" && combatLocked());
    const ctl = here
      ? `<button class="btn btn-sm ${can ? "btn-good" : ""}" ${can ? "" : "disabled"} title="${k.blurb} — spend 1 action + ${fuel}⛽" onclick="investigateSignal('${s.id}')">🔍 Investigate (${fuel}⛽)</button>`
      : `<span class="hint">travel to ${sigPlanetName(s.planet)} (${dist} ly)</span>`;
    return `<div class="ship-stat" style="margin-top:4px"><span class="k" title="${k.blurb}">${k.ico} ${tl} ${k.name}</span><span class="v">${s.ttl}c · ${ctl}</span></div>`;
  }).join("");
  return `<div class="ship-stat" style="margin-top:8px"><span class="k">📡 Signals</span></div>${rows}`;
}
function renderFortunes() {
  const act = fxActive();
  if (!act.length) return "";
  const chips = act.map(f => {
    const def = FX[f.key], good = def.kind === "boon";
    const cc = fxClearCost(f);
    const clr = (def.kind === "bane" && cc) ? ` <button class="btn btn-sm" title="Pay ${fmt(cc)} cr to shake it off now (cheaper as it nears its end)" onclick="clearFx('${f.key}')">🧹 ${fmt(cc)}</button>` : "";
    return `<div class="ship-stat" style="margin-top:4px"><span class="k" style="color:${good ? "var(--good)" : "var(--bad)"}" title="${def.blurb}">${def.ico} ${def.name}</span><span class="v">${f.cyclesLeft} cyc${clr}</span></div>`;
  }).join("");
  return `<div class="ship-stat" style="margin-top:8px"><span class="k">✨ Fortunes</span></div>${chips}`;
}
function renderLog() {
  const el = document.getElementById("log"); if (!el) return;
  el.innerHTML = S.log.map(e => `<div class="log-entry ${e.type}"><span style="opacity:.5">[${e.turn}]</span> ${e.msg}</div>`).join("");
}

function renderSectorRelations() {
  ensureFactionRel();
  const pairs = [];
  FACTION_KEYS.forEach((a, i) => FACTION_KEYS.slice(i + 1).forEach(b => pairs.push([a, b])));
  const rows = pairs
    .map(([a, b]) => ({ a, b, rel: factionRelation(a, b) }))
    .sort((x, y) => x.rel.score - y.rel.score)   // most tense (war) first
    .map(({ a, b, rel }) => {
      const pct = Math.round((rel.score + 100) / 2);
      const col = rel.tier === "war" ? "var(--bad)" : rel.tier === "cold" ? "var(--warn)" : "var(--good)";
      return `<div class="ship-stat"><span class="k">${FACTIONS[a].ico} ${FACTIONS[a].name} ↔ ${FACTIONS[b].ico} ${FACTIONS[b].name}</span>
        <span class="v"><span class="pill" style="border-color:${col};color:${col}">${rel.ico} ${rel.label}</span></span></div>
        <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
    }).join("");
  return `<div class="card"><h4>🌐 Sector Relations</h4>
    <div class="hint">How the great powers stand with each other — independent of your own standing with them. Drifts each cycle; rivals trend toward war unless something intervenes, and an active letter of marque stokes the rivalry it's fighting for.</div>
    ${rows}</div>`;
}
function renderTerritoryContests() {
  const entries = Object.entries(S.territoryControl || {});
  if (!entries.length) return "";
  const rows = entries.map(([pid, c]) => {
    const p = PLANETS.find(x => x.id === pid); if (!p) return "";
    const pct = Math.round(c.meter);
    const col = pct >= 75 ? "var(--bad)" : pct >= 40 ? "var(--warn)" : "var(--good)";
    return `<div class="ship-stat"><span class="k">${p.name} <span class="hint">${FACTIONS[c.owner].ico} ${FACTIONS[c.owner].name} held</span></span>
      <span class="v">${FACTIONS[c.challenger].ico} ${FACTIONS[c.challenger].name} <span style="color:${col}">${pct}%</span></span></div>
      <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
  }).join("");
  return `<div class="card"><h4>🚩 Contested Worlds</h4>
    <div class="hint">Worlds whose owner is at open War can actually change hands — the meter shows how close the challenger is to seizing it. A faction is never conquered down to its last world.</div>
    ${rows}</div>`;
}
function repBar(f) {
  const r = S.rep[f] || 0;
  const pct = (r + 100) / 2;
  const col = r >= 0 ? "var(--good)" : "var(--bad)";
  const st = standing(f);
  return `<div class="ship-stat"><span class="k">${FACTIONS[f].ico} ${FACTIONS[f].name}</span>
      <span class="v"><span class="pill ${st.cls}">${st.label}</span> <span style="color:${col}">${r>0?"+":""}${r}</span></span></div>
    <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
}

/* ----- Galaxy ----- */
/* ---------- Starmap — slice 5 of procedural galaxy generation ----------
   The lane graph (slice 2) has had real topology — hazard stretches,
   hyperlane shortcuts — since it shipped, but the Galaxy tab only ever
   surfaced it as text: a "🛰️ hyperlane" pill, an "ly" number on a card.
   This draws it: an SVG node-link map of every world the player already
   knows about, laid out by rank along x (not raw x, which would let a
   handful of far-flung frontier worlds squash everything else into one
   corner) on a gentle sine curve so it reads as a starlane, not a ruler.
   Purely additive — the existing card grid is untouched, right below it,
   with all the same detail and Travel buttons; this is a second, more
   legible view onto data slice 2 already computed, not a replacement.
   Same spoiler discipline as everywhere else in this arc: an edge only
   draws when BOTH ends are already `galaxyKnown` — a hidden world's
   hyperlanes never leak as a line pointing off into the dark.
*/
function renderStarmap(known) {
  if (known.length < 2) return '';
  const W = 760, H = 220, pad = 36;
  const sorted = known.slice().sort((a, b) => a.x - b.x);
  const n = sorted.length;
  const pos = {};
  sorted.forEach((p, i) => {
    const t = n > 1 ? i / (n - 1) : 0.5;
    pos[p.id] = { x: pad + t * (W - 2 * pad), y: H / 2 + Math.sin(i * 1.7) * (H / 2 - pad) * 0.65 };
  });
  const knownIds = new Set(known.map(p => p.id));
  const drawn = new Set();
  let edges = '';
  known.forEach(p => {
    (p.hyperlanes || []).forEach(nid => {
      if (!knownIds.has(nid)) return;   // never draw toward an undiscovered world — the line itself would spoil it
      const key = [p.id, nid].sort().join("|");
      if (drawn.has(key)) return; drawn.add(key);
      const a = pos[p.id], b = pos[nid], hot = p.id === S.location || nid === S.location;
      edges += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${hot ? "var(--good)" : "#334155"}" stroke-width="${hot ? 2 : 1}" opacity="${hot ? 0.9 : 0.45}"/>`;
    });
  });
  let nodes = '';
  known.forEach(p => {
    const here = p.id === S.location, q = pos[p.id];
    nodes += `<g${here ? "" : ` style="cursor:pointer" onclick="travel('${p.id}')"`}>
      <circle cx="${q.x}" cy="${q.y}" r="${here ? 9 : 5}" fill="${p.color}" stroke="${here ? "#fff" : "#0f172a"}" stroke-width="${here ? 2 : 1}"><title>${p.name}${here ? " — you are here" : ` — ${fuelCost(p.id)}⛽`}</title></circle>
    </g>`;
  });
  return `<div class="card" style="overflow:auto">
    <h4>🗺️ Starmap</h4>
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;min-height:160px" preserveAspectRatio="xMidYMid meet">${edges}${nodes}</svg>
    <div class="hint">Lines are the direct hyperlanes/routes on your ship's own charts — the bright ones touch wherever you're standing. Click a world to travel.</div>
  </div>`;
}
function renderGalaxy() {
  const el = document.getElementById("panel-galaxy");
  const known = PLANETS.filter(galaxyKnown);
  const cards = known.map(p => {
    const here = p.id === S.location;
    const fc = here ? 0 : fuelCost(p.id);
    const canGo = !here && S.res.fuel >= fc;
    const deps = Object.keys(p.deposits || {}).map(c => COM[c].ico).join(" ")
      + (p.salvage ? " 🧲" : "") + (p.bounty ? " 🎯" : "");
    const enf = p.enforce > 0.7 ? '<span class="pill bad">strict law</span>'
      : p.enforce < 0.25 ? '<span class="pill good">lawless</span>' : '<span class="pill">patrolled</span>';
    const pol = pollutionOf(p.id);
    const polPill = pol >= 60 ? '<span class="pill bad" title="Heavy industrial pollution">☁️ fouled</span>'
      : pol >= 25 ? '<span class="pill" title="Rising industrial pollution">☁️ smoggy</span>' : '';
    const _cr = S.crises && S.crises[p.id];
    const crisisPill = _cr ? `<span class="pill bad" title="${CRISES[_cr.type].name} — prices spiking, ${_cr.cyclesLeft} cyc left">${CRISES[_cr.type].ico} ${CRISES[_cr.type].name}</span>` : '';
    const _plv = pirateLevel(p.id);
    const piratePill = pirateIntelKnows(p.id)
      ? (_plv > 0 ? `<span class="pill ${_plv >= 2 ? "bad" : ""}" title="Pirate activity level ${_plv} (from your charts)">🏴 pirates ${_plv}</span>` : `<span class="pill good" title="No pirate activity (from your charts)">🏴 clear</span>`)
      : '';
    const tag = p.colonizable
      ? `<span class="pill good">${S.colonies[p.id] ? "your colony 🌍" : "colonizable"}</span>`
      : `${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}`;
    const escortPill = (S.escort && S.escort.active && S.escort.mission && S.escort.mission.to === p.id)
      ? `<span class="pill" title="Your active convoy is bound here (${S.escort.mission.legsLeft} leg(s) left)">🛡️ convoy bound</span>` : '';
    const _fMissions = fleetList().filter(s => s.status === "mission" && s.mission && s.mission.planet === p.id);
    const fleetMissionPill = _fMissions.length
      ? `<span class="pill" title="${_fMissions.map(s => `${FLEET_SHIPS[s.key].ico} ${s.name} — ${MANDATE_TASKS[s.mission.task].name} (${s.mission.cyclesLeft} cyc)`).join(" · ")}">🎯 fleet mission ×${_fMissions.length}</span>` : '';
    const _fLogi = fleetList().filter(s => s.status === "logistics" && s.station === p.id);
    const fleetLogiPill = _fLogi.length
      ? `<span class="pill" title="${_fLogi.map(s => `${FLEET_SHIPS[s.key].ico} ${s.name} (${FLEET_SHIPS[s.key].role === "freighter" ? "hauler" : "guard"})`).join(" · ")}">🚚 convoy stationed</span>` : '';
    const _mandatesHere = (S.mandates || []).filter(m => m.planet === p.id);
    const mandatePill = _mandatesHere.length
      ? `<span class="pill" title="${_mandatesHere.map(m => `${(bandById(m.bandId) || {}).name || "crew"} — ${MANDATE_TASKS[m.task].name} (${m.cyclesLeft} cyc)`).join(" · ")}">📜 mandate ×${_mandatesHere.length}</span>` : '';
    const _sig = (S.signals || []).find(s => s.planet === p.id);
    const signalPill = _sig ? `<span class="pill good" title="${SIGNAL_KINDS[_sig.kind].blurb} — ${_sig.ttl} cyc to investigate">${SIGNAL_KINDS[_sig.kind].ico} ${["", "faint", "strong", "rare"][_sig.tier]} signal</span>` : '';
    const sectorPill = (!p.colonizable && p.faction) ? factionWarFrontPill(p.faction) : '';
    const _pirHaven = bandsWithHaven().find(hb => hb.haven.planet === p.id);
    const pirateHavenPill = _pirHaven ? `<span class="pill bad" title="The ${_pirHaven.name} command a pirate haven here (tier ${_pirHaven.haven.tier}) — see 🏴‍☠️ Contacts">👑 ${_pirHaven.name}'s haven T${_pirHaven.haven.tier}</span>` : '';
    const _contest = (S.territoryControl || {})[p.id];
    const territoryPill = _contest ? `<span class="pill bad" title="The ${FACTIONS[_contest.challenger].name} are contesting this world, ${territoryControlPct(p.id)}% of the way to seizing it">🚩 contested by ${FACTIONS[_contest.challenger].ico} ${Math.round(_contest.meter)}%</span>` : '';
    const hyperlanePill = (!here && (currentPlanet().hyperlanes || []).includes(p.id))
      ? `<span class="pill good" title="A direct hyperlane bypasses the usual route — cheaper to reach than the map might suggest">🛰️ hyperlane</span>` : '';
    const sigFuel = _sig ? (SIGNAL_FUEL[_sig.tier] || 6) : 0;
    const sigBtn = (_sig && here) ? `<button class="btn btn-sm ${actionsLeft() > 0 && S.res.fuel >= sigFuel ? "btn-good" : ""}" ${actionsLeft() > 0 && S.res.fuel >= sigFuel ? "" : "disabled"} title="${SIGNAL_KINDS[_sig.kind].blurb}" onclick="investigateSignal('${_sig.id}')">🔍 Investigate signal (${sigFuel}⛽)</button>` : '';
    return `<div class="planet-card ${here ? "current" : ""}">
      <div class="planet-orb" style="background:radial-gradient(circle at 35% 30%, ${p.color}, #000 130%)"></div>
      <div class="planet-name">${p.name} ${S.visited[p.id] ? "" : '<span class="badge">unknown</span>'}</div>
      <div class="planet-tag">${p.tag} · ${tag}</div>
      <div class="planet-desc">${p.desc}</div>
      <div class="planet-levels">
        <span class="lvl-chip">🏭 Ind ${effIndustry(p)}</span>
        <span class="lvl-chip">🔬 Tech ${effTech(p)}</span>
        ${enf}${polPill}${crisisPill}${piratePill}${escortPill}${fleetMissionPill}${fleetLogiPill}${mandatePill}${signalPill}${sectorPill}${pirateHavenPill}${territoryPill}${hyperlanePill}
      </div>
      <div class="hint" style="margin-bottom:8px">Extract: ${deps || "—"}</div>
      ${sigBtn ? `<div class="row" style="margin-bottom:8px">${sigBtn}</div>` : ""}
      ${here ? `<div class="pill good">◉ You are here</div>`
        : `<div class="row"><button class="btn btn-primary" ${canGo ? "" : "disabled"} onclick="travel('${p.id}')">Travel ▸</button>
            <span class="distance">⛽ ${fc} · ${currentPlanet().distances[p.id]} ly</span></div>`}
    </div>`;
  }).join("");
  const unknownCount = undiscoveredHidden().length;
  const survey = canColonize() ? `<div class="card">
    <h4>🛰️ Deep-Space Survey</h4>
    <div class="desc">Scan the dark for uncharted worlds to chart and colonize. ${unknownCount ? unknownCount + " world(s) still hidden." : "All worlds discovered."} A Research Lab improves your sensors.</div>
    <button class="btn btn-primary" ${unknownCount && actionsLeft() > 0 ? "" : "disabled"} onclick="explore()">Survey (1 action)</button>
  </div>` : `<div class="card">
    <h4>🛰️ Deep-Space Survey <span class="pill bad">locked</span></h4>
    <div class="desc">Uncharted worlds lie beyond the dark. Research <b>Colonial Charter</b> (in the Research tab) to build the sensors and authority to chart and settle them.</div>
  </div>`;
  const frontierUnknown = undiscoveredHidden().filter(p => p.frontier).length;
  const probeCard = canColonize() ? `<div class="card">
    <h4>🔭 Probe the Frontier</h4>
    <div class="desc">Push a probe straight at the frontier ring instead of waiting on a routine survey — fuel spent whether it pays off or not, and a lawless target can draw an ambush. But a frontier world charted this way turns up richer signals. ${frontierUnknown ? frontierUnknown + " frontier world(s) still uncharted." : "All frontier worlds charted."}</div>
    <button class="btn btn-primary" ${frontierUnknown && actionsLeft() > 0 && S.res.fuel >= PROBE_FUEL_COST ? "" : "disabled"} onclick="probeFrontier()">Probe (1 action, ${PROBE_FUEL_COST}⛽)</button>
  </div>` : '';
  const nCrises = S.crises ? Object.keys(S.crises).length : 0;
  const crisisBadge = nCrises ? `<span class="pill bad" title="Worlds in crisis — relief needed, prices spiking">🆘 ${nCrises} in crisis</span>` : "";
  const cl = Math.round(S.climate || 0);
  const climateBadge = cl >= 40 ? `<span class="pill bad" title="Sector-wide climate stress from industrial pollution">🌡️ climate stress ${cl}</span>`
    : cl >= 12 ? `<span class="pill" title="Sector-wide climate stress from industrial pollution">🌡️ climate ${cl}</span>` : "";
  // pirate-chart summary, like the crisis badge — live for the chart's validity window
  let intelBadge = "";
  if (pirateIntelActive()) {
    const left = S.pirateIntel.until - S.turn;
    const hot = S.pirateIntel.worlds.filter(id => pirateLevel(id) >= 2).length;
    intelBadge = `<span class="pill ${hot ? "bad" : "good"}" title="Active pirate chart — ${left} cycle(s) left. Activity updates live on the map.">🏴 ${hot ? hot + " pirate hotspot" + (hot > 1 ? "s" : "") : "lanes charted"} · ${left}cyc</span>`;
  }
  el.innerHTML = `<h2>Galactic Map ${crisisBadge}${climateBadge}${intelBadge}</h2>
    <div class="subtitle">A random ${activeCoreTotal()} of 15 core worlds feature this game, so every run charts a different sector. Each world has its own resources, industry, laws and faction; extraction is bound to where the resource exists — and every deposit is finite: strip a world and yields fall, prices climb, and the region feels it. This sector's own Sector Code also jitters every core world's deposits, industry, tech and law level a little, so exact yields vary game to game even though names and history never do. Industry breeds <b>pollution</b>; the sector's aggregate drives <b>climate stress</b> that withers farms everywhere. Frontier worlds marked <span class="pill good">colonizable</span> are fresh: full reserves, clean skies. Beyond the charted 20 lies a further, procedurally-generated <b>frontier ring</b> — different every game — waiting to be found with the 🛰️ Deep-Space Survey below. Travelling costs fuel and advances a cycle. <span class="hint">Sector code: <b>${seedCodeFor(S.frontierSeed)}</b> — share it, or start a new game from one, with the 🔑 Seed button.</span></div>
    ${renderStarmap(known)}
    <div class="planet-grid">${cards}</div>
    ${(() => { const beyond = PLANETS.filter(p => isActive(p) && !p.hidden && !p.colonizable && !galaxyKnown(p)).length; return beyond ? `<div class="hint" style="margin-top:8px">🛰️ ${beyond} more world(s) lie beyond your sensor range (~${GALAXY_FUEL_HORIZON} fuel) — travel toward the frontier to chart them.</div>` : ""; })()}
    <div class="section-title">🔭 Exploration</div>
    <div class="cards">${survey}${probeCard}</div>
    <div class="hint" style="margin-top:14px">🏆 Your long-term legacy goals and all contracts now live in the <b>🎯 Missions</b> tab.</div>`;
}

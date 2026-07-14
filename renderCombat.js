/* ============================================================
   STELLAR FRONTIER — rendering: Raid, Contacts & Ship
   Third slice of the rendering layer (see renderCore.js and
   renderProgression.js for the first two): the tactical combat-card
   helper (tacticalHTML) and the panel-render functions for the Raid
   tab (piracy/bounty hunting, Pirate Haven, Privateer Commissions,
   capstone legacies), the Contacts tab (the bands you've built
   history with, and Mandates), and the Ship tab (upgrades, repair).
   Bases, Colonies, Escort rendering and renderAll() the master
   dispatcher stay in game.js for their own future slice(s).

   Loaded after renderProgression.js, before game.js. S, subView,
   subTabBar, polMeter and every render* function not listed above
   still live in game.js/renderProgression.js at this point in the
   split — safe, since every function here is only CALLED later (by
   renderAll(), itself only ever called after a player action, once
   every script has finished loading), same pattern as every prior
   slice.
   ============================================================ */

"use strict";

/* ----- Raid ----- */
/* tactical readout + weapon buttons for a prey/encounter card */
function tacticalHTML(t, attackFn) {
  const al = actionsLeft();
  const scanBtn = t.scanned ? "" :
    `<button class="btn btn-sm" title="Reveal defenses, weapon class and the best counter${S.upgrades.aimain >= 1 ? " (free — AI Mainframe)" : " (4 ⚡)"}" onclick="deepScan()">🔍 Deep Scan${S.upgrades.aimain >= 1 ? "" : " (4⚡)"}</button>`;
  foeHp(t);                                  // lock in the real (rubber-banded) hull so the readout doesn't jump after the first shot
  const _max = t.maxhp, _hp = t.hp;
  const _pct = Math.max(0, Math.min(100, _hp / _max * 100));
  const _hpCol = _pct >= 60 ? "var(--good)" : _pct >= 30 ? "var(--warn)" : "var(--bad)";
  const badges = `${t.elite ? '<span class="pill bad" title="Elite captain — tougher, hardened against your favourite weapon">💀 ELITE</span> ' : ""}${(t.escorts || 0) > 0 ? `<span class="pill" title="Fights with ${t.escorts} escort(s) — more hull, heavier fire">🛰️ ${t.escorts} escort${t.escorts > 1 ? "s" : ""}</span> ` : ""}`;
  const hullBar = `${badges ? `<div style="margin-top:4px">${badges}</div>` : ""}<div class="ship-stat" style="margin-top:4px"><span class="k">Foe hull</span><span class="v" style="color:${_hpCol}">${Math.max(0, Math.round(_hp))}/${_max}</span></div>
    <div class="bar"><span style="width:${_pct}%;background:${_hpCol}"></span></div>`;
  // live tactical stats: revealed by a scan, or learned once you've traded fire —
  // so you can watch Weapons-targeting drop its strength and Defenses-targeting strip its layers
  const known = t.scanned || t._engaged;
  const engDots = (t.enginesMax || 0) > 0 ? Array.from({ length: t.enginesMax }, (_, i) => i < (t.engines || 0) ? "●" : "○").join("") : "";
  const profile = known
    ? `<div class="hint">💥 strength <b>${Math.round(t.strength)}</b> · 🛡️ <b>${t.def.armor}</b> 🔰 <b>${t.def.shield}</b> 📡 <b>${t.def.pd}</b>${engDots ? ` · 🚀 drive <b>${engDots}</b>` : ""}${t.scanned ? ` · fires <b>${t.wtype}</b> — counter <b>${bestWeaponHint(t).ico} ${bestWeaponHint(t).name}</b>` : ""}</div>`
    : `<div class="hint">Capabilities unknown — a 🔍 Deep Scan reveals its defenses and the best counter.</div>`;
  // warn when a hurt foe with live engines may bolt
  const fleeWarn = (t.engines || 0) > 0 && t.hp != null && t.hp / t.maxhp < 0.55
    ? `<div class="hint" style="color:var(--warn)">⚠️ Drive still live — it may jump away. Target 🚀 Engines to pin it.</div>` : "";
  const lastW = combatState().lastWeapon;
  const recW = t.scanned ? bestWeaponHint(t) : null;
  const weapons = Object.keys(WEAPONS).filter(weaponAvailable).map(w => {
    const W = WEAPONS[w];
    const ammoStr = Object.entries(W.ammo).map(([c, q]) => `${q}${COM[c].ico}`).join("") || "free";
    const eff = t.scanned ? ` ×${weaponEff(w, t).toFixed(2)}` : "";
    const ok = weaponAffordable(w);   // combat is a free sub-loop — attacking costs no cycle-actions (the sweep paid)
    const isSel = lastW === w;        // the weapon you last fired — the active one
    const isRec = recW === W;         // the recommended counter (a hint, not a selection)
    return `<button class="btn btn-sm ${isSel ? "btn-primary" : ""}" ${ok ? "" : "disabled"}
      title="${W.name} — ammo: ${ammoStr}${isRec ? " · ★ recommended counter" : ""}${t.scanned ? ` · effectiveness vs this target${eff}` : ""}"
      onclick="${attackFn}('${w}')">${W.ico}${isRec ? "★" : ""}${eff}</button>`;
  }).join(" ");
  const dr = dronesDeployable();
  const droneLine = (S.upgrades.dronebay || 0) > 0
    ? `<div class="hint">🛸 ${dr > 0 ? `Will deploy <b>${dr}</b> drone${dr > 1 ? "s" : ""}${t.scanned && t.def.pd > 0 ? " (their point-defense will thin them)" : ""}` : "Drone Bay empty — stock 🛸 Combat Drones"}</div>` : "";
  const c = combatState();
  const budget = combatBudget();
  const postureBtns = Object.entries(COMBAT_PRESETS).map(([k, pre]) =>
    `<button class="btn btn-sm ${c.posture === k && !c.advanced ? "btn-primary" : ""}" title="${pre.hint}" onclick="setCombatPosture('${k}')">${pre.label}</button>`).join(" ");
  const advBtn = `<button class="btn btn-sm ${c.advanced ? "btn-primary" : ""}" title="Fine-tune the offense/defense split" onclick="setCombatOffense(${c.offense})">⚙️ Advanced</button>`;
  const advRow = c.advanced
    ? `<div class="row" style="margin-top:4px;align-items:center"><span class="hint">Offense ${c.offense}% / Defense ${100 - c.offense}%</span>
       <input type="range" min="0" max="100" step="5" value="${c.offense}" oninput="setCombatOffense(this.value)" style="flex:1;min-width:120px" /></div>`
    : "";
  const budgetNote = budget > 100 ? ` <span class="hint">· power budget ${budget}% (reactor/AI)</span>` : "";
  const targetBtns = Object.entries(COMBAT_TARGETS).map(([k, tg]) =>
    `<button class="btn btn-sm ${c.target === k ? "btn-primary" : ""}" title="${tg.hint}" onclick="setCombatTarget('${k}')">${tg.ico} ${tg.name}</button>`).join(" ");
  const frWorth = fieldRepairWorthwhile(), frHasMat = canFieldRepair(), frUsable = frWorth && frHasMat;
  const frMatsPlain = Object.entries(FIELD_REPAIR.mats).map(([c, q]) => `${q}${COM[c].ico}`).join(" + ");   // plain text — safe inside the title attribute
  const frLabel = !frWorth ? "🔧 Field Repair — hull & systems sound"
    : !frHasMat ? `🔧 Field Repair — need ${frMatsPlain} aboard`
    : `🔧 Field Repair (+${FIELD_REPAIR.hull} hull · ${frMatsPlain})`;
  const frBtn = `<button class="btn btn-sm ${frUsable ? "btn-good" : ""}" ${frUsable ? "" : "disabled"} title="Emergency patch: +${FIELD_REPAIR.hull} hull and shore up your worst subsystem for ${frMatsPlain} — but you hold fire this round and the foe attacks" onclick="fieldRepair()">${frLabel}</button>`;
  const ownHullCol = S.pirate.hull >= 60 ? "var(--good)" : S.pirate.hull >= 30 ? "var(--warn)" : "var(--bad)";
  return `${hullBar}${profile}${fleeWarn}${droneLine}
    <div class="row" style="margin-top:8px;align-items:center"><span class="hint">Posture:</span> ${postureBtns} ${advBtn}${budgetNote}</div>
    ${advRow}
    <div class="row" style="margin-top:4px;align-items:center"><span class="hint">Target:</span> ${targetBtns}</div>
    <div class="row" style="margin-top:6px;align-items:center">${scanBtn} <span class="hint">Fire:</span> ${weapons}${t._engaged && combatState().lastWeapon ? ` <button class="btn btn-sm" title="Repeat your last attack (${WEAPONS[combatState().lastWeapon] ? WEAPONS[combatState().lastWeapon].name : ""}) for up to 5 rounds — handy for grinding down big hulls" onclick="raidVolley(5)">⏩ Volley ×5</button>` : ""}</div>
    <div class="row" style="margin-top:6px;align-items:center"><span class="hint">🛡️ Your hull <b style="color:${ownHullCol}">${S.pirate.hull}/${HULL_MAX}</b> ·</span> ${frBtn}</div>`;
}
function preyCombatCard(prey, al) {
  const isPirate = prey.isPirate;
  const who = isPirate ? `<span class="pill bad">🏴 Pirate</span>` : `<span class="pill">${FACTIONS[prey.faction].ico} ${FACTIONS[prey.faction].name}</span>`;
  const reward = isPirate
    ? `<span class="pill good">🎯 bounty ${fmt(prey.bounty)} 💰</span>`
    : `<span class="hint">Hold: ${Object.keys(prey.cargo).map(c => `${prey.cargo[c]}${COM[c].ico}`).join(" ") || "scant"} · ${fmt(prey.credits)} 💰</span>`;
  const pinned = (prey.engines || 0) <= 0;
  const lawNote = isPirate
    ? `A <b>lawful kill</b> — bounty, salvage, faction goodwill, no Wanted.`
    : prey.isPlanetPatrol || prey.isPlanetRaid
    ? `An <b>act of war</b> on ${FACTIONS[prey.faction] ? FACTIONS[prey.faction].name : "the coalition"} — every kill earns <b>Wanted</b>, and the sack itself far more.`
    : `Raiding coalition shipping earns <b>Wanted</b>. ${pinned ? "" : "Cripple its 🚀 engines so it can't run."}`;
  // planetary assault: a phase banner over the same wave-combat UI the Escort tab uses —
  // phase 1 clear the orbital picket, phase 2 break the ground garrison, THEN the loot
  let assaultLine = "";
  const A = S.planetAssault;
  if (A && (prey.isPlanetPatrol || prey.isPlanetRaid)) {
    const ap = PLANETS.find(x => x.id === A.planetId);
    const defenders = allHostiles(prey).filter(h => h.hp == null || h.hp > 0).length;
    const moreComing = (A.called || 0) < assaultReinforceCap(ap || currentPlanet()) && assaultCoalitionSources(ap || currentPlanet()).length > 0;
    const alertLvl = Math.round(planetAlertLevel(A.planetId));
    const alertNote = alertLvl >= 15 ? ` <span style="color:var(--bad)">🚨 Reinforced by past raids (alert ${alertLvl}%) — expect a harder fight than a fresh world's.</span>` : "";
    assaultLine = A.phase === "patrols"
      ? `<div class="hint" style="margin-top:4px;color:var(--warn)">🛰️ <b>Planetary assault — phase 1: the orbital picket.</b> <b>${defenders}</b> space defender${defenders === 1 ? "" : "s"} hold${defenders === 1 ? "s" : ""} the sky over ${ap ? ap.name : "the world"}. Clear them <b>all</b> — the 🏰 ground garrison (and the plunder behind it) is out of reach until the orbit is yours.${moreComing ? " ⚠️ Their coalition may jump in reinforcements from other worlds." : ""}${alertNote}</div>`
      : `<div class="hint" style="margin-top:4px;color:var(--warn)">🏰 <b>Planetary assault — phase 2: the ground garrison.</b> The orbit over ${ap ? ap.name : "the world"} is swept clean. Break the garrison to sack the surface and take the plunder.${moreComing ? " ⚠️ Watch the sky — coalition ships may still jump in." : ""}${alertNote}</div>`;
  }
  // pirates loitering in the area you can recruit (loot shared); rescuers already engaged
  const areaPirates = (prey._others || []).filter(o => o.isPirate).length;
  const allyN = (S.allies && S.allies.length) || 0;
  const packN = (prey.pack || []).length;
  const callBtn = (areaPirates > 0 && allyN < 2)
    ? `<button class="btn btn-sm" title="Call ${areaPirates} pirate(s) in the area to your side — they fire independently, loot splits evenly" onclick="raidCallAllies()">📣 Call pirate allies (${areaPirates})</button>`
    : "";
  const onCallBtns = (allyN < 2 ? bandsRaidable().filter(b => b.id !== prey.bandId && !bandRivalServing(b) && !(S.allies || []).some(a => a.bandId === b.id)) : [])
    .map(b => `<button class="btn btn-sm btn-good" title="${bandTagMark(b)} ${b.name} ${bandFollowing(b) ? "are riding with you" : bandOnCall(b) ? "are standing by" : "are based here"} — bring them in (${Math.round(bandLootShare(b) * 100)}% cut)" onclick="raidSummonOnCall('${b.id}')">📣 ${bandTagMark(b)}${b.ico} ${b.name}</button>`).join("");
  // your own loyal warships — callable into any fight, no loot cut, but only those following you
  const fleetBtns = (allyN < 2 ? fleetRaidable().filter(s => !(S.allies || []).some(a => a.fleetId === s.id)) : [])
    .map(s => `<button class="btn btn-sm btn-good" title="Your ${FLEET_SHIPS[s.key].name} — joins loyally, no loot cut" onclick="raidSummonFleet('${s.id}')">✦ ${FLEET_SHIPS[s.key].ico} ${s.name}</button>`).join("");
  // no warship following the player, but idle warships exist elsewhere — point them at the Fleet tab
  const patrolHint = (allyN < 2 && fleetRaidable().length === 0 && fleetList().some(s => s.status === "idle" && FLEET_SHIPS[s.key] && FLEET_SHIPS[s.key].role === "warship"))
    ? `<div class="hint">✦ You have idle warships, but none following you — assign one from the ✦ <b>Fleet</b> tab to call it into fights.</div>` : "";
  const allyLine = allyN > 0 ? `<div class="hint"><span class="pill good">🤝 ${allyN} ally${allyN > 1 ? "ies" : ""} · loot split ${allyN + 1} ways</span></div>` : "";
  // telegraphed enemy intent: every primed move is announced with its counter — the round
  // you get to react is the whole point, so make it impossible to miss
  const primed = allHostiles(prey).filter(h => h.hp > 0 && h.intent && RAID_INTENT_META[h.intent]);
  const intentLine = primed.length
    ? `<div class="hint" style="margin-top:4px;color:var(--bad)">⚠️ <b>Enemy intent:</b> ${primed.map(h => `${RAID_INTENT_META[h.intent].ico} <b>${h.name}</b> is ${RAID_INTENT_META[h.intent].name} — <i>${RAID_INTENT_META[h.intent].counter}</i>`).join(" · ")}</div>`
    : "";
  const brokenLine = (typeof raidGroupBroken === "function" && raidGroupBroken(prey) && allHostiles(prey).some(h => h.hp > 0 && !h.ground))
    ? `<div class="hint" style="margin-top:4px;color:var(--good)">🏳️ <b>Their formation is breaking</b> — survivors may cut and run each round (your Dread hurries them). Strip 🚀 engines to pin the loot, or let them scatter and take the field.</div>`
    : "";
  // multiple hostiles now fight as one pooled group — a roster with Target/Focus buttons per
  // hostile, mirroring the Escort tab's wave combat, replaces the old one-line pack pill.
  let hostileRoster = "";
  if (packN > 0) {
    const hostiles = allHostiles(prey);
    const selected = (S.raidTargets || []).filter(i => hostiles[i] && hostiles[i].hp > 0);
    const nT = selected.length || hostiles.filter(h => h.hp > 0).length;
    const rows = hostiles.map((h, i) => {
      if (h.hp <= 0) return "";
      const sel = selected.includes(i);
      const pct = Math.max(0, Math.round(h.hp / h.maxhp * 100));
      const col = pct >= 60 ? "var(--good)" : pct >= 30 ? "var(--warn)" : "var(--bad)";
      const im = h.intent && RAID_INTENT_META[h.intent];
      return `<div class="ship-stat" style="align-items:center${sel ? ";border-color:var(--accent)" : ""}">
          <span class="k">${h === prey ? "🎯 " : ""}${classLabel(h)} <span class="hint">${h.name}</span>${im ? ` <span title="${im.name} — ${im.counter}">${im.ico}</span>` : ""}</span>
          <span class="v">${Math.round(h.hp)}/${h.maxhp}
            <button class="btn btn-sm ${sel ? "btn-good" : ""}" onclick="raidToggleTarget(${i})">${sel ? "✓ Targeted" : "Target"}</button>
            <button class="btn btn-sm" onclick="raidFocusTarget(${i})">Focus</button></span></div>
        <div class="bar"><span style="width:${pct}%;background:${col}"></span></div>`;
    }).join("");
    hostileRoster = `<div class="hint" style="margin-top:6px">⚔️ <b>${packN + 1} hostiles</b> defending together — pooled fire splits across <b>${nT}</b> ${nT === 1 ? "target" : "targets"}${selected.length ? "" : " (all, none picked)"}.</div>
      ${rows}`;
  }
  const spareBtn = (typeof raidCanSpare === "function" && raidCanSpare())
    ? `<button class="btn btn-sm btn-good" title="Hold fire and let the beaten crew live — a big boost to their collaboration" onclick="raidSpareRecruit()">🤝 Spare crew (+standing)</button>` : "";
  const buttons = isPirate
    ? `${spareBtn}${callBtn}${onCallBtns}${fleetBtns}<button class="btn btn-sm" onclick="raidDisengage()">Break off</button>`
    : `<button class="btn btn-bad" title="Slaughter the crew: more Dread, more Wanted" onclick="raidNoQuarter()">☠️ No Quarter</button>
       <button class="btn btn-sm" title="Spend Dread to extort tribute — no fight (Dread −12)" onclick="raidExtort()">💀 Extort</button>
       ${callBtn}${onCallBtns}${fleetBtns}<button class="btn btn-sm" onclick="raidDisengage()">Disengage</button>`;
  // no crew at hand, but you have friends out there — tell the player how to bring them
  const willingElsewhere = bandList().filter(b => b.status !== "dead" && bandWillAlly(b) && b.id !== prey.bandId).length;
  const crewHint = (allyN === 0 && callBtn === "" && onCallBtns === "" && willingElsewhere > 0)
    ? `<div class="hint">🤝 No allied crew on the scene. Summon one from the 🏴‍☠️ <b>Contacts</b> tab (📣 Call for support) or set a crew to 🛰️ <b>Follow</b> you — standing-by, following, and locally-based crews fight at your side here, even under a letter of marque.</div>` : "";
  const preyBand = prey.bandId ? bandById(prey.bandId) : null;
  const bandLine = preyBand ? `<div class="hint">${bandTagMark(preyBand)} of the <b>${preyBand.name}</b> · ${bandPers(preyBand).ico} ${bandPers(preyBand).name} · ${bandTier(preyBand).label} (${preyBand.rep}) · based at ${bandLocName(preyBand)}</div>` : "";
  // Battle Group: every warship following the player, pooled into a formation, separate from the 2-ally cap
  const bgShips = battleGroupShips(), bgIdle = fleetRaidable();
  let bgBlock = "";
  if (bgShips.length) {
    const posture = S.battleGroupPosture || "balanced";
    const postBtns = Object.entries(ESCORT_POSTURES).map(([k, p]) => `<button class="btn btn-sm ${posture === k ? "btn-primary" : ""}" title="${p.hint}" onclick="setBattleGroupPosture('${k}')">${p.label}</button>`).join(" ");
    const bgHull = bgShips.reduce((s, x) => s + x.hull, 0), bgHullMax = bgShips.reduce((s, x) => s + x.hullMax, 0);
    const frontTier = shipFormation(battleGroupFrontTier()[0] || {});
    const playerTier = playerFormation(), playerExposed = raidPlayerFrontline();
    const tierRows = FORMATION_TIERS.map(t => {
      const def = FORMATION_SLOTS[t];
      const members = bgShips.filter(s => shipFormation(s) === t);
      const youHere = playerTier === t;
      const tHull = members.reduce((s, x) => s + x.hull, 0) + (youHere ? S.pirate.hull : 0);
      const tHullMax = members.reduce((s, x) => s + x.hullMax, 0) + (youHere ? HULL_MAX : 0);
      const holding = t === frontTier;
      const youRow = youHere
        ? `<div class="ship-stat" style="align-items:center;font-size:12px"><span class="k">🚀 You ${playerExposed ? '<span style="color:var(--bad)">◀ exposed</span>' : '<span style="color:var(--good)">🛡️ screened</span>'}</span><span class="v">${Math.round(S.pirate.hull)}/${HULL_MAX} ${FORMATION_TIERS.filter(k => k !== t).map(k => `<button class="btn btn-sm" title="Move to ${FORMATION_SLOTS[k].name}" onclick="setPlayerFormation('${k}')">${FORMATION_SLOTS[k].ico}</button>`).join("")}</span></div>`
        : "";
      const shipRows = members.map(s => {
        const otherSlots = FORMATION_TIERS.filter(k => k !== t);
        const moveBtns = otherSlots.map(k => `<button class="btn btn-sm" title="Move to ${FORMATION_SLOTS[k].name}" onclick="setBattleGroupFormation('${s.id}','${k}')">${FORMATION_SLOTS[k].ico}</button>`).join("");
        return `<div class="ship-stat" style="align-items:center;font-size:12px"><span class="k">${FLEET_SHIPS[s.key].ico} ${s.name}</span><span class="v">${Math.round(s.hull)}/${s.hullMax} ${moveBtns}</span></div>`;
      }).join("");
      const anyHere = members.length || youHere;
      return `<div style="margin-top:4px${anyHere ? "" : ";opacity:.5"}">
        <div class="hint" title="${def.hint}"><b>${def.ico} ${def.name}</b>${anyHere ? ` — ${members.length + (youHere ? 1 : 0)} ship(s), ${Math.round(tHull)}/${tHullMax} hull${holding ? ' <span style="color:var(--bad)">◀ taking fire</span>' : ""}` : " — empty"}</div>
        ${youRow}${shipRows}</div>`;
    }).join("");
    bgBlock = `<div class="hint" style="margin-top:6px">✦ <b>Battle fleet</b> (${bgShips.length} ship${bgShips.length === 1 ? "" : "s"}): 🔥${battleGroupFirepower()} pooled firepower · 🛡️ ${Math.round(bgHull)}/${bgHullMax} hull</div>
      <div class="row" style="margin-top:4px;flex-wrap:wrap;gap:4px"><span class="hint">Posture:</span> ${postBtns} <button class="btn btn-sm" onclick="recallBattleGroup()">↩ Recall fleet</button></div>
      ${tierRows}`;
  } else if (bgIdle.length) {
    bgBlock = `<div class="row" style="margin-top:6px"><button class="btn btn-sm btn-good" title="Deploy every warship following you (${bgIdle.length}) as a pooled formation — no loot cut, escort-style posture, but they take real damage and can be lost" onclick="deployBattleGroup()">✦ Deploy Battle Fleet (${bgIdle.length})</button></div>`;
  }
  return `<div class="card" style="border-color:${isPirate ? "var(--good)" : "var(--warn)"}">
    <h4>${preyBand ? bandTagMark(preyBand) : ""}${classLabel(prey)} <span class="hint">— ${prey.name}</span> ${who} ${reward}${prey.ground ? ' <span class="pill bad">🏔️ dug in</span>' : pinned ? ' <span class="pill bad">🚀 pinned</span>' : ""}</h4>
    ${bandLine}
    <div class="hint">${lawNote}</div>
    ${assaultLine}${intentLine}${brokenLine}${allyLine}${hostileRoster}${patrolHint}${crewHint}
    ${tacticalHTML(prey, "raidAttack")}
    <div class="row" style="margin-top:6px">${buttons}</div>
    ${bgBlock}
  </div>`;
}
function renderRaid() {
  const el = document.getElementById("panel-raid");
  if (!el) return;
  const P = S.pirate, p = currentPlanet(), al = actionsLeft();
  const wantedCol = P.wanted >= 60 ? "var(--bad)" : P.wanted >= 30 ? "var(--warn)" : "var(--good)";
  const hullCol = P.hull >= 60 ? "var(--good)" : P.hull >= 30 ? "var(--warn)" : "var(--bad)";
  const noto = notoriety();
  const corruptible = p.enforce <= 0.6;
  const settleCost = P.wanted > 0 ? Math.round(Math.min(P.wanted, 15 + Math.round(P.wanted * 0.25)) * (60 + p.enforce * 120)) : 0;
  const status = `<div class="card"><h4>🏴‍☠️ Outlaw Status <span class="pill" style="border-color:${noto.col};color:${noto.col}">${noto.label}</span></h4>
    ${polMeter("Wanted", "🎯", P.wanted, 100, wantedCol)}
    ${polMeter("Dread", "💀", P.dread, 100, "var(--accent-2)")}
    ${polMeter("Hull", "🛡️", P.hull, 100, hullCol)}
    <div class="ship-stat" style="margin-top:6px"><span class="k">Raids pulled</span><span class="v">${fmt(P.raids)}</span></div>
    ${(P.bountyKills || 0) > 0 ? `<div class="ship-stat"><span class="k">Pirates hunted</span><span class="v">${fmt(P.bountyKills)} · ${fmt(P.bountyEarned)} cr</span></div>` : ""}
    <div class="ship-stat"><span class="k">Total plundered</span><span class="v">${fmt(P.plundered)} cr</span></div>
    <div class="ship-stat"><span class="k">Raid power</span><span class="v">${Math.round(raidPower())}</span></div>
    <div class="ship-stat" style="margin-top:10px"><span class="k">🛠️ Subsystems</span><span class="v">${SUBSYS.every(k => shipCond(k) >= 100) ? '<span class="pill good">all nominal</span>' : '<span class="pill bad">damaged</span>'}</span></div>
    ${SUBSYS.map(k => { const c = shipCond(k), col = c >= 60 ? "var(--good)" : c >= 30 ? "var(--warn)" : "var(--bad)", m = SUBSYS_META[k];
      return `<div class="ship-stat"><span class="k">${m.ico} ${m.name}</span><span class="v" style="color:${col}">${c}%</span></div>
        <div class="bar"><span style="width:${c}%;background:${col}"></span></div>`;
    }).join("")}
    ${(P.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100)) ? `<div class="hint" style="margin-top:6px">🔧 Full repairs at the 🚀 <b>Ship</b> tab (Repair Bay). Mid-fight, use 🔧 Field Repair below.</div>` : ""}
    ${P.wanted > 0 && !S.interdiction ? (corruptible
      ? `<button class="btn btn-sm" style="margin-top:6px" ${al > 0 && S.res.credits >= settleCost ? "" : "disabled"} title="Bribe corruptible officials to wipe warrants" onclick="settleWarrants()">📝 Settle warrants (${fmt(settleCost)} 💰)</button>`
      : `<div class="hint" style="margin-top:6px">Officials here are incorruptible — settle warrants in lawless space.</div>`) : ""}
  </div>`;
  let action;
  if (S.encounter) {
    const e = S.encounter;
    const rp = raidPower();
    const odds = rp >= e.strength * 1.2 ? "favorable" : rp >= e.strength * 0.8 ? "even" : "grim";
    const oddsCol = odds === "favorable" ? "var(--good)" : odds === "even" ? "var(--warn)" : "var(--bad)";
    const fleeOdds = Math.round(Math.max(5, Math.min(95, (0.45 + S.upgrades.engine * 0.15 * trimMult("autonomy") + (S.upgrades.aimain || 0) * 0.08 - e.level * 0.05) * 100)));
    action = `<div class="card" style="border-color:var(--bad)">
      <h4>🏴‍☠️ Ambush: ${classLabel(e)} <span class="hint">— ${e.name}</span> <span class="pill bad">🏴 Pirate</span></h4>
      <div class="hint">It demands <b>${fmt(e.toll)} 💰</b> to let you pass. Bounty on its head ${fmt(e.bounty)} cr. ${(e.engines||0)>0 ? "Cripple its 🚀 engines if you mean to stop it running." : ""}</div>
      <div class="meta"><span class="hint">Fight odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${e.strength}</span></div>
      ${tacticalHTML(e, "encounterFight")}
      <div class="row" style="margin-top:6px">
        <button class="btn btn-sm" ${S.res.credits >= e.toll ? "" : "disabled"} title="Pay the toll — bloodless, but galling" onclick="encounterPay()">💰 Pay ${fmt(e.toll)}</button>
        <button class="btn btn-sm" title="Burn for it — failing costs hull" onclick="encounterFlee()">🏃 Flee (~${fleeOdds}%)</button>
      </div>
    </div>`;
  } else if (S.interdiction) {
    const it = S.interdiction, ip = PLANETS.find(x => x.id === it.planet) || p;
    const rp = raidPower();
    const odds = rp >= it.strength * 1.2 ? "favorable" : rp >= it.strength * 0.8 ? "even" : "grim";
    const oddsCol = odds === "favorable" ? "var(--good)" : odds === "even" ? "var(--warn)" : "var(--bad)";
    const canBribe = ip.enforce <= 0.75;
    action = `<div class="card" style="border-color:var(--bad)">
      <h4>🚨 Navy Interdiction <span class="pill bad">${ip.name}</span></h4>
      <div class="hint">${it.kind === "dock" ? "A cutter locked onto your transponder as you docked." : "A patrol sweep caught you red-handed on the lanes."} Cutter strength ~${it.strength}.</div>
      <div class="meta"><span class="hint">Fight odds</span><span class="cost" style="color:${oddsCol}">${odds} — power ${Math.round(rp)} vs ~${it.strength}</span></div>
      <div class="row" style="margin-top:6px">
        ${canBribe
          ? `<button class="btn btn-primary" ${S.res.credits >= it.bribe ? "" : "disabled"} title="Pay them off — costs credits, trims Wanted" onclick="navyBribe()">💵 Bribe (${fmt(it.bribe)} 💰)</button>`
          : `<button class="btn" disabled title="These officers can't be bought">💵 Incorruptible</button>`}
        <button class="btn btn-bad" title="Shoot your way clear — lose and you're boarded & arrested" onclick="navyFight()">⚔️ Fight</button>
        <button class="btn btn-sm" title="Stand down: cargo seized, fined and jailed, but warrants mostly cleared" onclick="navySurrender()">🏳️ Surrender</button>
      </div>
    </div>`;
  } else if (S.prey) {
    action = preyCombatCard(S.prey, al);
  } else if (S.preyChoices && S.preyChoices.length) {
    const rows = S.preyChoices.map((c, i) => {
      const who = c.isPirate ? `<span class="pill bad">🏴 Pirate</span>` : `<span class="pill">${FACTIONS[c.faction].ico} ${FACTIONS[c.faction].name}</span>`;
      const eliteTag = c.elite ? ` <span class="pill bad">💀 elite</span>` : "";
      const escTag = (c.escorts || 0) > 0 ? ` <span class="pill">🛰️ ${c.escorts} escort${c.escorts > 1 ? "s" : ""}</span>` : "";
      return `<div class="card" style="padding:10px">
        <h4 style="margin:0">${classLabel(c)} <span class="hint">— ${c.name}</span></h4>
        <div style="margin:6px 0">${who}${eliteTag}${escTag}</div>
        <button class="btn btn-primary btn-sm" ${al >= 0 ? "" : "disabled"} onclick="engageTarget(${i})">⚔️ Engage</button>
      </div>`;
    }).join("");
    action = `<div class="card"><h4>🔭 Contacts on the scope <span class="pill">${S.preyChoices.length}</span></h4>
      <div class="hint">Read the <b>hull class</b> and allegiance, then commit. Bigger classes hit harder, soak more, and run when losing — knock out their 🚀 engines to pin them. Coalition ships carry cargo (raiding earns Wanted); 🏴 pirates carry bounties (a lawful kill).</div>
      <div class="cards" style="margin-top:8px">${rows}</div>
      <button class="btn btn-sm" style="margin-top:8px" onclick="standDown()">Stand down</button>
    </div>`;
  } else {
    const armed = S.upgrades.cannons >= 1;
    const lvl = pirateLevel(p.id);
    const richness = p.enforce >= 0.5 ? "fat, well-escorted lawful traffic — and bigger hulls" : p.enforce >= 0.25 ? "mixed traffic" : "lean rim runners, smugglers & pirates";
    const alertLvl = Math.round(planetAlertLevel(p.id));
    const alertPill = alertLvl >= 15
      ? `<span class="pill bad" title="Reinforced by past raids on its shipping, patrols, or the world itself — everything encountered here hits harder and its wartime economy has driven up local prices. Fades slowly if you leave it be, or hunt down its pirates here to stand it down faster.">🚨 alert ${alertLvl}%</span>`
      : `<span class="pill good">🕊️ at ease</span>`;
    const sweepCard = `<div class="card">
      <h4>🔭 Sweep the lanes near ${p.name} ${lvl > 0 ? `<span class="pill ${lvl >= 2 ? "bad" : ""}">pirate activity ${lvl}</span>` : '<span class="pill good">lanes quiet</span>'} ${alertPill}</h4>
      <div class="desc">One sweep turns up several contacts — coalition traffic and pirates alike (${richness}). You'll see each one's faction and <b>hull class</b>; pick your mark. Lawful space runs richer and heavier; the lawless rim is leaner.${alertLvl >= 15 ? " Its shipping and patrols are running scared from past losses — expect tougher escorts, and the specific goods you've been taking are pricier here now." : " Keep hunting the same lanes and its escorts stiffen, and whatever cargo you keep taking gets scarcer and dearer here."} Hunting down the 🏴 <b>pirates</b> you find here works the other way — it visibly eases this world's alert, on top of the usual bounty and goodwill. Costs ${PROWL_FUEL} ⛽ and one action.</div>
      ${armed ? "" : `<div class="hint" style="color:var(--warn)">Install 🔫 Weapon Systems (Ship tab) to raid with any real teeth.</div>`}
      <button class="btn btn-primary" ${al > 0 && S.res.fuel >= PROWL_FUEL ? "" : "disabled"} onclick="prowl()">Sweep (1 action)</button>
    </div>`;
    const canRaidPlanet = !!p.faction && !(S.bases && S.bases[p.id]) && !(S.colonies && S.colonies[p.id]);
    // pre-assault recon: a drone swarm you size yourself — too few and it's wasted, too
    // many and the swarm itself gives you away — then the coalition's response map with
    // a Divert buy-out per responding world once you've actually charted it
    let reconBlock = "";
    if (canRaidPlanet) {
      if (planetReconActive(p.id)) {
        const full = planetReconDetail(p.id) === "full";
        const sources = assaultCoalitionSources(p);
        const diverted = PLANETS.filter(w => worldDiverted(w.id) && w.faction && p.faction &&
          factionRelTier(factionRelScore(w.faction, p.faction)) === "alliance" && w.id !== p.id);
        const canDivert = al > 0 && S.res.credits >= DIVERSION_COST && diversionBandCandidates().length > 0;
        const srcRows = sources.slice(0, 4).map(w =>
          `<div class="ship-stat" style="align-items:center"><span class="k">${w.name} <span class="hint">${(p.distances && p.distances[w.id]) || "?"} ly</span></span>
            <span class="v"><button class="btn btn-sm" ${canDivert ? "" : "disabled"} title="Pay a willing pirate crew ${fmt(DIVERSION_COST)} cr to tear up ${w.name}'s lanes for ${DIVERSION_CYCLES} cycles — its response wing stays home instead of answering ${p.name}'s distress calls. Heats ${w.name}'s own alert a little." onclick="hireRaidDiversion('${w.id}')">💰 Divert (${fmt(DIVERSION_COST)})</button></span></div>`).join("");
        const divRows = diverted.map(w => `<div class="ship-stat"><span class="k">${w.name}</span><span class="v"><span class="pill good">🏴 lanes harassed — ${S.assaultDiversions[w.id] - S.turn} cyc</span></span></div>`).join("");
        const readout = full
          ? `picket <b>${planetPatrolCount(p)}</b> vessels ~str <b>${planetPatrolStrengthEst(p)}</b> each · 🏰 garrison ~str <b>${planetGarrisonStrengthEst(p)}</b>`
          : `a <b>${raidStrengthBand(planetPatrolStrengthEst(p))}</b> picket · a <b>${raidStrengthBand(planetGarrisonStrengthEst(p))}</b> garrison <span class="hint">(more drones next time reads the exact numbers)</span>`;
        reconBlock = `<div class="hint" style="margin-top:8px">🛸 <b>Recon</b> <span class="pill">${S.planetRecon[p.id].until - S.turn} cyc left</span> — ${readout}${S.crises && S.crises[p.id] ? ' · <span style="color:var(--good)">⚡ crisis — defenses thinned</span>' : ""}${factionAtWar(p.faction) ? ' · <span style="color:var(--good)">⚔️ their fleet is committed to a war — one fewer wing will answer</span>' : ""}</div>
          ${sources.length ? `<div class="hint">🆘 Worlds that will answer its distress calls — silence them with coin before the shooting starts:</div>${srcRows}` : `<div class="hint" style="color:var(--good)">🆘 No coalition world left in reach — its distress calls will go <b>unanswered</b>.</div>`}
          ${divRows}`;
      } else {
        const haveDrones = S.res.drones || 0;
        const hasBay = (S.upgrades.dronebay || 0) > 0;
        reconBlock = `<div class="hint" style="margin-top:8px">Attacking blind is the brute-force tax. Launch a 🛸 recon swarm — too few drones and their sensor noise swallows the signal whole (drones lost, nothing learned, but nobody notices); too many and the swarm's own size gives you away (full intel, but the garrison scrambles onto alert and the surprise is gone). Land inside the band and you learn something real, undetected — more drones read a sharper picture. You have <b>${fmt(haveDrones)}</b> 🛸 aboard.</div>
          ${hasBay ? `<div class="row" style="margin-top:4px;align-items:center">
            <input class="qty" id="probe-drones" type="number" min="1" value="10" style="width:70px" />
            <button class="btn btn-sm" ${al > 0 && haveDrones > 0 ? "" : "disabled"} title="Commit this many drones to the recon pass — spent regardless of outcome." onclick="probePlanetDefenses(+document.getElementById('probe-drones').value || 1)">🛸 Launch recon drones (1 action)</button>
          </div>` : `<div class="hint" style="color:var(--warn)">Install a 🛸 Drone Bay (Ship tab) to launch recon drones.</div>`}`;
      }
    }
    const planetCard = canRaidPlanet ? `<div class="card" style="border-color:var(--bad)">
      <h4>🏴‍☠️ Raid ${p.name} <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name}</span> ${alertPill}</h4>
      <div class="desc">A two-phase campaign, not a smash-and-grab: first sweep its <b>orbital patrols</b> (${planetPatrolCount(p)} vessels — pooled-fire wave combat, pick your targets like an Escort ambush), and only once the sky is clear can you break the 🏰 <b>ground garrison</b> and sack the surface. Mid-fight its defenders <b>telegraph their moves</b> — alpha strikes, distress calls, drives spooling to run — and reinforcements only ever arrive through a distress call that you failed to silence. A real act of war on ${FACTIONS[p.faction].name}: heavy Wanted, a deep rep hit, and defenses that scale with how lawful this world is (${Math.round(p.enforce * 100)}%). The payoff scales with how developed it is too (Industry ${p.industry}, Tech ${p.tech}).${alertLvl >= 15 ? ` <b>Every raid leaves it more fortified</b> — its space and ground defenses harden further, local prices run hotter on war matériel, and the buildup unsettles its standing with the rest of the sector; laying off lets it stand down, but only slowly — or hunt its own pirates (above) to bring the alert down faster.` : " This world's alert (shared with its shipping lanes above) hardens its defenses and prices further with every raid — better to let a well-raided world cool off, or actively police its pirates, than to keep hammering it."} Costs ${PLANET_RAID_FUEL} ⛽ and one action.</div>
      ${reconBlock}
      <button class="btn btn-bad" style="margin-top:8px" ${al > 0 && S.res.fuel >= PLANET_RAID_FUEL ? "" : "disabled"} onclick="raidPlanet()">Raid this world (1 action)</button>
    </div>` : "";
    action = sweepCard + planetCard;
  }
  // ---- Pirate haven ----
  let havenCard = "";
  if (S.haven) {
    const hp = PLANETS.find(x => x.id === S.haven.planet);
    const here = atHaven();
    const stash = Object.entries(S.haven.stash).filter(([, q]) => q > 0).map(([c, q]) => `${q}${COM[c].ico}`).join(" ") || "empty";
    havenCard = `<div class="card" style="border-color:var(--accent-2)">
      <h4>🏴‍☠️ Haven: ${hp.name} <span class="pill" style="border-color:var(--accent-2);color:var(--accent-2)">tier ${S.haven.tier}</span></h4>
      <div class="ship-stat"><span class="k">Stash</span><span class="v">${havenStashUsed()}/${havenStashCap()}</span></div>
      <div style="font-size:12px;line-height:1.7">${stash}</div>
      <div class="ship-stat"><span class="k">Tribute/cycle</span><span class="v">${fmt(havenTributeRate())} 💰</span></div>
      ${here ? `<div class="row" style="margin-top:8px">
        <button class="btn btn-primary" ${al > 0 && P.wanted > 0 ? "" : "disabled"} title="Disappear and let the heat die down" onclick="layLow()">🤫 Lie Low (−${22 + S.haven.tier * 4} Wanted)</button>
        <button class="btn btn-sm" onclick="havenStashAll()">🗄️ Stash hold</button>
        <button class="btn btn-sm" onclick="havenTakeAll()">📦 Take all</button>
        ${S.haven.tier < HAVEN_MAX_TIER ? `<button class="btn btn-sm" ${S.res.credits >= HAVEN_COST * S.haven.tier ? "" : "disabled"} onclick="upgradeHaven()">🏗️ Expand (${fmt(HAVEN_COST * S.haven.tier)} 💰)</button>` : ""}
      </div>` : `<div class="hint" style="margin-top:6px">Return to ${hp.name} to lie low, stash plunder, and dry-dock cheap.</div>
      ${canHaven(p) ? `<button class="btn btn-sm" style="margin-top:6px" ${S.res.credits >= havenRelocateCost() ? "" : "disabled"} title="Move your haven's tier and stash to ${p.name}" onclick="relocateHaven()">🚚 Relocate haven here (${fmt(havenRelocateCost())} 💰)</button>` : ""}`}
    </div>`;
  } else if (canHaven(p)) {
    havenCard = `<div class="card">
      <h4>🏴‍☠️ Establish a Haven</h4>
      <div class="desc">${p.name} is lawless enough to hide a den. A haven lets you <b>lie low</b> to shed Wanted, <b>stash plunder</b> safe from boarding, dry-dock at half cost, and collect <b>tribute</b> scaling with your Dread.</div>
      <div class="meta"><span class="hint">Cost</span><span class="cost">${fmt(HAVEN_COST)} 💰 + ${HAVEN_METALS} ⛓️</span></div>
      <button class="btn btn-primary" ${S.res.credits >= HAVEN_COST && (S.res.metals || 0) >= HAVEN_METALS ? "" : "disabled"} onclick="establishHaven()">Establish Haven</button>
    </div>`;
  }
  // ---- Privateer commission ----
  let commCard = "";
  if (S.commission) {
    const c = S.commission, left = Math.max(0, c.expires - S.turn);
    commCard = `<div class="card" style="border-color:var(--good)">
      <h4>📜 Letter of Marque <span class="pill good">${FACTIONS[c.patron].ico} ${FACTIONS[c.patron].name}</span></h4>
      <div class="hint">Sanctioned to raid <b>${FACTIONS[c.target].ico} ${FACTIONS[c.target].name}</b> shipping — their kills draw no Wanted and pay a ${fmt(c.bounty)} cr bounty. Bring your brotherhood: crews <b>🛰️ following</b> you join these hunts on their own, and any standing-by crew can be summoned mid-fight. Don't turn on your patron.</div>
      <div class="ship-stat" style="margin-top:6px"><span class="k">Progress</span><span class="v">${c.done}/${c.quota} raids</span></div>
      <div class="ship-stat"><span class="k">Cycles left</span><span class="v">${left}</span></div>
      <div class="ship-stat"><span class="k">Completion bonus</span><span class="v">${fmt(c.reward)} 💰</span></div>
    </div>`;
  } else {
    const patron = p.faction, target = FACTION_RIVAL[patron];
    if (target && (S.rep[patron] || 0) >= COMM_REP_REQ) {
      commCard = `<div class="card">
        <h4>📜 Privateer Commission</h4>
        <div class="desc">${FACTIONS[patron].name} will issue a letter of marque against the <b>${FACTIONS[target].name}</b>: hunt their shipping legally — no Wanted, a ${fmt(COMM_BOUNTY)} cr bounty per raid, and a ${fmt(COMM_REWARD)} cr bonus for ${COMM_QUOTA} raids in ${COMM_DURATION} cycles. Their ports will stop interdicting you; the target's will hate you.</div>
        <button class="btn btn-primary" onclick="acceptCommission()">Accept Letter of Marque</button>
      </div>`;
    }
  }
  // ---- Pirate Lord capstone ----
  let lordCard = "";
  if (S.legacyTitle) {
    lordCard = `<div class="card maxed"><h4>👑 Outlaw Legacy</h4>
      <div class="pill good">${S.legacyTitle}</div>
      <div class="hint" style="margin-top:6px">Your name is written into the sector's legend.</div></div>`;
  } else if (P.raids > 0 || S.haven || S.commission) {
    const crit = pirateLordCriteria(), ready = crit.every(c => c.ok);
    lordCard = `<div class="card" style="border-color:${ready ? "var(--good)" : "var(--accent-2)"}">
      <h4>👑 Path to Pirate Lord</h4>
      <div class="hint">Dominate the rim to claim an outlaw legacy — a path to victory all your own.</div>
      <div style="font-size:13px;line-height:2;margin-top:4px">${crit.map(c => `${c.ok ? "✅" : "⬜"} ${c.label}`).join("<br>")}</div>
      ${ready ? `<button class="btn btn-primary" style="margin-top:8px" onclick="pirateLegacy()">👑 Claim your throne</button>` : ""}
    </div>`;
  }
  let marshalCard = "";
  if (!S.legacyTitle && (P.bountyKills || 0) > 0) {
    const crit = marshalCriteria(), ready = crit.every(c => c.ok);
    marshalCard = `<div class="card" style="border-color:${ready ? "var(--good)" : "var(--accent-2)"}">
      <h4>⚖️ Path to Sector Marshal</h4>
      <div class="hint">Clear the lanes of every raider to claim a lawful legacy — victory by the badge, not the black flag.</div>
      <div style="font-size:13px;line-height:2;margin-top:4px">${crit.map(c => `${c.ok ? "✅" : "⬜"} ${c.label}`).join("<br>")}</div>
      ${ready ? `<button class="btn btn-primary" style="margin-top:8px" onclick="marshalLegacy()">⚖️ Claim your badge</button>` : ""}
    </div>`;
  }
  // ---- Pirate intel charts (the Deep-space tier stays off the shelf until you've found an edge world) ----
  const mapBtns = Object.entries(PIRATE_MAP).filter(([, m]) => !m.frontier || edgeIntelUnlocked()).map(([k, m]) =>
    `<button class="btn btn-sm" ${S.res.credits >= m.cost ? "" : "disabled"} title="Reveal pirate activity ${m.frontier ? "across the whole sector AND every edge world you've discovered" : m.ly === Infinity ? "across the whole sector" : "within " + m.ly + " ly"} for ${PIRATE_INTEL_DURATION} cycles" onclick="buyPirateMap('${k}')">${m.ico} ${m.name} (${fmt(m.cost)} 💰)</button>`).join(" ");
  let intelCard;
  if (pirateIntelActive()) {
    const left = S.pirateIntel.until - S.turn;
    const rows = S.pirateIntel.worlds
      .map(id => ({ id, pl: PLANETS.find(x => x.id === id), lvl: pirateLevel(id), d: currentPlanet().distances[id] || 0 }))
      .filter(r => r.pl)
      .sort((a, b) => b.lvl - a.lvl || a.d - b.d)
      .map(r => `<div class="ship-stat"><span class="k">${r.pl.frontier ? "🧭 " : ""}${r.pl.name} <span class="hint">${r.id === S.location ? "here" : r.d + " ly"}</span></span><span class="v" style="color:${r.lvl >= 2 ? "var(--bad)" : r.lvl >= 1 ? "var(--warn)" : "var(--good)"}">${r.lvl > 0 ? "🏴 " + r.lvl : "clear"}</span></div>`).join("");
    const hot = S.pirateIntel.worlds.filter(id => pirateLevel(id) > 1).length;
    intelCard = `<div class="card"><h4>🗺️ Pirate Intel <span class="pill ${left <= 2 ? "bad" : ""}">${left} cyc left</span></h4>
      <div class="hint">${hot ? `<b>${hot}</b> charted world(s) above activity 1 — hunt them down to pacify the sector.` : "All charted worlds are pacified (≤1)."}</div>
      <div style="margin:6px 0">${rows}</div>
      <div class="row">${mapBtns}</div></div>`;
  } else {
    intelCard = `<div class="card"><h4>🗺️ Buy Pirate Intel</h4>
      <div class="desc">Charts reveal pirate activity by world for ${PIRATE_INTEL_DURATION} cycles — find hotspots to hunt (the path to pacifying the sector) or lanes to avoid. Activity shows on the 🪐 Galaxy map too.</div>
      <div class="row">${mapBtns}</div></div>`;
  }
  el.innerHTML = `<h2>⚔️ Raider</h2>
    <div class="subtitle">Two trades, one gun: <b>prey on shipping</b> (build Dread, mind your Wanted — the navy interdicts the notorious; havens and letters of marque are an outlaw&#39;s tools) or <b>hunt pirates</b> for lawful bounties that scale with their rank — every kill calms the lanes, shielding your colonies and convoys. Travel through infested systems and the pirates may find <i>you</i>.</div>
    <div class="cards raid-top">${status}<div class="raid-action">${action}</div></div>
    <div class="cards" style="margin-top:14px">${intelCard}${commCard}${havenCard}${lordCard}${marshalCard}</div>`;
}
// ---- Pirate Contacts tab: manage the bands you've built history with ----
let mandateForm = { band: null, planet: null, task: "cull", dur: 6 };
function setMandateField(k, v) { mandateForm[k] = (k === "dur") ? (parseInt(v, 10) || 6) : v; renderContacts(); }
function renderContacts() {
  const el = document.getElementById("panel-contacts"); if (!el) return;
  const views = [["all", "🤝 All contacts"], ["around", "📍 Around here"], ["mandates", "📜 Mandates"], ["chat", "💬 Talk"]];
  const view = subView("contacts", views);
  const body = view === "around" ? renderContactsAround() : view === "mandates" ? renderContactsMandates() : view === "chat" ? renderContactsChat() : renderContactsAll();
  el.innerHTML = `<h2>🏴‍☠️ Pirate Contacts</h2>${subTabBar("contacts", views)}${body}`;
  const transcript = document.getElementById("chatTranscript");   // keep the newest chat line in view
  if (transcript) transcript.scrollTop = transcript.scrollHeight;
}
function contactCard(b) {
  const giftCargo = ["weapons", "fuel", "luxury", "ai", "drones"].filter(c => (S.res[c] || 0) > 0);
  const t = bandTier(b), pr = bandPers(b), rival = bandFoe(b), mark = bandTagMark(b);
  const cargoBtns = giftCargo.map(c => `<button class="btn btn-sm" title="Gift 1 ${COM[c].name} (+standing)" onclick="giftBandCargo('${b.id}','${c}',1)">${COM[c].ico}+</button>`).join("");
  const pct = Math.round((((b.rep || 0) + 100) / 200) * 100);
  const cut = Math.round(bandLootShare(b) * 100), fee = escortRecruitFee(b), risk = Math.round(bandBetrayChance(b) * 100);
  const dist = bandDistance(b);
  const tagBtns = BAND_TAG_KEYS.map(k => `<button class="btn btn-sm ${b.tag === k ? "btn-primary" : ""}" title="Tag as ${BAND_TAGS[k].name}" onclick="setBandTag('${b.id}','${k}')">${BAND_TAGS[k].ico}</button>`).join("");
  const supStatus = bandOnMandate(b) ? `<span style="color:var(--accent)">📜 on mandate</span>`
    : bandFollowing(b) ? `<span style="color:var(--good)">🛰️ riding with you (${b.followUntil - S.turn} cyc)</span>`
    : bandOnCall(b) ? `<span style="color:var(--good)">standing by (${b.onCallUntil - S.turn} cyc)</span>`
    : bandInbound(b) ? `<span style="color:var(--warn)">inbound (${b.inboundTurn - S.turn} cyc)</span>`
    : bandBusy(b) ? `<span class="hint">busy (${b.busyUntil - S.turn} cyc)</span>`
    : `${Math.round(bandSupportOdds(b) * 100)}% to answer`;
  const callDisabled = bandOnCall(b) || bandInbound(b) || bandBusy(b) || bandOnMandate(b) || !bandWillAlly(b);
  const followBtn = bandOnCall(b) && !bandFollowing(b)
    ? `<button class="btn btn-sm btn-good" title="They'll jump where you jump for ${BAND_FOLLOW_DURATION} cycles" onclick="bandFollow('${b.id}')">🛰️ Follow me</button>` : "";
  const standDownBtn = (bandOnCall(b) || bandInbound(b))
    ? `<button class="btn btn-sm" title="Send them back to their own affairs now" onclick="bandStandDown('${b.id}')">✖ ${bandInbound(b) ? "Recall" : "Stand down"}</button>` : "";
  return `<div class="card">
      <h4>${mark ? mark + " " : ""}${b.ico} ${b.name}</h4>
      <div class="hint">${pr.ico} ${pr.name} · L${b.level} · ${t.label} (${b.rep})${rival ? ` · <span style="color:var(--bad)">⚔️ feud: ${rival.name} (depth ${bandFeudDepth(b)})</span>` : ""}</div>
      ${b.haven ? `<div class="hint" style="color:var(--bad)">👑 Commands a haven at ${mdPlanetName(b.haven.planet)} — tier ${b.haven.tier}, a rising power in the rim</div>` : ""}
      <div class="bar"><span style="width:${pct}%;background:${(b.rep||0) >= 41 ? "var(--good)" : (b.rep||0) < -10 ? "var(--bad)" : "var(--warn)"}"></span></div>
      <div class="ship-stat"><span class="k">Based at</span><span class="v">${bandLocName(b)} <span class="hint">${dist === 0 ? "(here)" : dist + " ly"}</span></span></div>
      <div class="ship-stat"><span class="k">History</span><span class="v">🤝 ${b.allied || 0} allied · ⚔️ ${b.fought || 0} fought · 🎁 ${fmt(b.gifted || 0)} cr</span></div>
      <div class="ship-stat"><span class="k">As an ally</span><span class="v">${bandWillAlly(b) ? `wants ${cut}% of loot` : "won't fight for you"}</span></div>
      <div class="ship-stat"><span class="k">As a hire</span><span class="v">${bandNegotiatedFee(b) != null ? `🤝 ${fmt(fee)} cr (haggled)` : `${fmt(fee)} cr`} · ${risk}% desert risk</span></div>
      <div class="ship-stat"><span class="k">Support</span><span class="v">${supStatus}</span></div>
      ${rival ? (() => { const truce = bandTruceActive(b), tc = bandTruceCost(b), pc = bandReconcileCost(b);
        return `<div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px;align-items:center">
          ${truce ? `<span class="hint" style="color:var(--warn)">🕊️ truce w/ ${rival.name}: ${b.truceUntil - S.turn} cyc</span>` : ""}
          <button class="btn btn-sm" ${S.res.credits >= tc ? "" : "disabled"} title="A temporary truce for ${BAND_TRUCE_DURATION} cycles — they'll serve together for now, then the feud resumes" onclick="brokerTruce('${b.id}')">🕊️ ${truce ? "Extend truce" : "Truce"} (${fmt(tc)} cr · ${BAND_TRUCE_DURATION} cyc)</button>
          <button class="btn btn-sm" ${S.res.credits >= pc ? "" : "disabled"} title="Settle the feud with the ${rival.name} for good (depth ${bandFeudDepth(b)}) — cheaper with higher standing &amp; Dread" onclick="reconcileBands('${b.id}')">🤝 Broker peace (${fmt(pc)} cr)</button>
        </div>`; })() : ""}
      <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px"><span class="hint">Tag:</span> ${tagBtns}</div>
      <div class="row" style="margin-top:6px;flex-wrap:wrap;gap:4px">
        <button class="btn btn-sm" title="Chat in character with this crew's captain (runs on your local Ollama)" onclick="openBandChat('${b.id}')">💬 Talk</button>
        <button class="btn btn-sm" ${callDisabled ? "disabled" : ""} title="Call them to your side — nearby crews come at once, distant ones may travel in" onclick="callBandSupport('${b.id}')">📣 Call for support</button>
        ${followBtn}${standDownBtn}
        <button class="btn btn-sm" ${S.res.credits >= 500 ? "" : "disabled"} title="Pay a 500 cr tribute" onclick="giftBandCredits('${b.id}',500)">💰 500</button>
        <button class="btn btn-sm" ${S.res.credits >= 2000 ? "" : "disabled"} title="Pay a 2,000 cr tribute" onclick="giftBandCredits('${b.id}',2000)">💰 2k</button>
        ${cargoBtns}
      </div></div>`;
}
function renderContactsAll() {
  const bands = bandList().sort((a, b) => (b.rep || 0) - (a.rep || 0));
  const cards = bands.map(contactCard).join("");
  return `<div class="subtitle">Crews you've crossed in the void — your loose brotherhood. <b>Tag</b> them to track who's who. <b>Standing</b> rises when you ally, spare a beaten crew, pay tributes or gift valued cargo — and with your <b>Dread</b>; it craters when you kill them. <b>📣 Call for support</b> to summon a crew; once standing by, ask them to <b>🛰️ Follow</b> or <b>✖ Stand down</b>. Friendlier bands take a smaller loot cut, hire cheaper &amp; answer calls readily. Use <b>📍 Around here</b> for crews &amp; pirate activity in this system, and <b>📜 Mandates</b> to put a crew to work patrolling a world.</div>
    <div class="cards">${cards || '<div class="card"><div class="hint">No pirate bands on your books yet — hunt or ally with them from the ⚔️ Raider tab.</div></div>'}</div>`;
}
function pirateLevelLabel(n) { return n <= 0 ? "🟢 clear" : n >= 4 ? "🔴 infested" : n >= 2 ? "🟠 active" : "🟡 light"; }
function renderContactsAround() {
  const here = currentPlanet(), plv = pirateLevel(here.id);
  const local = bandList().filter(b => b.loc === here.id).sort((a, b) => (b.rep || 0) - (a.rep || 0));
  const onMandateHere = (S.mandates || []).filter(m => m.planet === here.id);
  const meter = `<div class="card"><h4>📍 ${here.name} <span class="pill ${plv >= 2 ? "bad" : plv === 0 ? "good" : ""}">${pirateLevelLabel(plv)} (${plv}/5)</span></h4>
    <div class="hint">Pirate activity here drives ambush, interdiction and convoy threat. Hunt raiders in the ⚔️ Raider tab, or commission a 🎯 <b>Cull pirates</b> mandate to drive them out${onMandateHere.length ? ` — <span style="color:var(--accent)">${onMandateHere.length} mandate(s) working this system now</span>` : ""}.</div>
    <div class="row" style="margin-top:8px"><button class="btn btn-sm btn-primary" onclick="setMandateField('planet','${here.id}');setSubView('contacts','mandates')">📜 Commission a mandate here</button></div></div>`;
  const cards = local.map(contactCard).join("");
  return `<div class="subtitle">Crews based in <b>${here.name}</b> right now, and how lawless these lanes are. Bands relocate as you cross them and as they finish mandates.</div>
    ${meter}
    <div class="cards">${cards || '<div class="card"><div class="hint">No known crews are based in this system. Sweep the lanes (⚔️ Raider) to turn some up.</div></div>'}</div>`;
}
function renderContactsMandates() {
  // ---- active mandates ----
  const active = (S.mandates || []).map(md => {
    const b = bandById(md.bandId), t = MANDATE_TASKS[md.task], done = md.total - md.cyclesLeft;
    const pct = Math.round(done / md.total * 100);
    return `<div class="card">
      <h4>${t.ico} ${b ? b.ico + " " + b.name : "crew"} <span class="hint">${t.name} · ${mdPlanetName(md.planet)}</span></h4>
      <div class="ship-stat"><span class="k">Progress</span><span class="v">${done}/${md.total} cycles</span></div>
      <div class="bar"><span style="width:${pct}%;background:var(--accent)"></span></div>
      <div class="ship-stat"><span class="k">Your cut so far</span><span class="v" style="color:var(--gold)">${fmt(md.accrued)} cr</span></div>
      <div class="ship-stat"><span class="k">Paid in advance</span><span class="v">${fmt(md.fee)} cr</span></div>
      <div class="row" style="margin-top:6px"><button class="btn btn-sm btn-bad" title="Recall the crew now — bank what they've earned, forfeit the fee" onclick="cancelMandate('${md.id}')">✖ Recall</button></div>
    </div>`;
  }).join("");
  // ---- commission form ----
  const elig = mandateEligibleBands();
  const f = mandateForm;
  if (!f.band || !elig.some(b => b.id === f.band)) f.band = elig.length ? elig[0].id : null;
  if (!f.planet || !PLANETS.find(p => p.id === f.planet)) f.planet = S.location;
  const known = PLANETS.filter(p => isActive(p) && galaxyKnown(p));
  let form;
  if (!elig.length) {
    form = `<div class="card"><h4>📜 Commission a mandate</h4><div class="hint">No crew is free to take a contract right now — raise standing with a band (and make sure it isn't already busy, summoned, or on another mandate).</div></div>`;
  } else {
    const b = bandById(f.band);
    const bandOpts = elig.map(x => `<option value="${x.id}" ${x.id === f.band ? "selected" : ""}>${x.ico} ${x.name} · L${x.level} · ${bandTier(x).label}</option>`).join("");
    const planetOpts = known.map(p => `<option value="${p.id}" ${p.id === f.planet ? "selected" : ""}>${p.name}${p.id === S.location ? " (here)" : ""} · ${pirateIntelKnows(p.id) ? pirateLevelLabel(pirateLevel(p.id)) : "activity ❔"}</option>`).join("");
    const taskBtns = Object.keys(MANDATE_TASKS).map(k => { const t = MANDATE_TASKS[k]; return `<button class="btn btn-sm ${f.task === k ? "btn-primary" : ""}" title="${t.blurb}" onclick="setMandateField('task','${k}')">${t.ico} ${t.name}</button>`; }).join(" ");
    const durBtns = MANDATE_DURATIONS.map(d => `<button class="btn btn-sm ${f.dur === d ? "btn-primary" : ""}" onclick="setMandateField('dur','${d}')">${d} cyc</button>`).join(" ");
    const t = MANDATE_TASKS[f.task];
    const fee = mandateFee(b, f.planet, f.task, f.dur), est = mandateEstCut(b, f.planet, f.task, f.dur);
    const afford = (S.res.credits || 0) >= fee;
    form = `<div class="card"><h4>📜 Commission a mandate</h4>
      <div class="hint">${t.blurb}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:8px;align-items:center">
        <span class="hint">Crew</span><select onchange="setMandateField('band',this.value)">${bandOpts}</select>
        <span class="hint">System</span><select onchange="setMandateField('planet',this.value)">${planetOpts}</select></div>
      <div class="hint" style="margin-top:4px">Pirate activity (❔) shows only for systems you hold current intel on — your current system, or worlds covered by a chart bought in the ⚔️ Raider tab.</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Task</span> ${taskBtns}</div>
      <div class="row" style="margin-top:8px;flex-wrap:wrap;gap:4px;align-items:center"><span class="hint">Duration</span> ${durBtns}</div>
      <div class="ship-stat" style="margin-top:8px"><span class="k">Fee (upfront)</span><span class="v" style="color:${afford ? "inherit" : "var(--bad)"}">${fmt(fee)} cr</span></div>
      <div class="ship-stat"><span class="k">Your cut</span><span class="v">${Math.round(t.cut * 100)}% of the take · <span class="hint">est. ~${fmt(est)} cr over ${f.dur} cyc</span></span></div>
      ${t.heat
        ? (() => { const fac = (PLANETS.find(p => p.id === f.planet) || {}).faction, sanc = fac && commissionCovers(fac), fn = fac ? FACTIONS[fac].name : "the locals";
            return sanc
              ? `<div class="hint" style="color:var(--good)">⚖️ Sanctioned — your letter of marque against ${fn} makes this legal: <b>no Wanted</b>, though they'll resent it all the same.</div>`
              : `<div class="hint" style="color:var(--bad)">⚠️ Piracy in your name — raises your Wanted and angers ${fn}.${(S.commission ? ` (Your letter of marque is against ${FACTIONS[S.commission.target].name}, not them.)` : " A letter of marque against them would make it legal.")}</div>`;
          })()
        : `<div class="hint" style="color:var(--good)">Lawful work — suppresses pirate activity at the target.</div>`}
      <div class="row" style="margin-top:8px"><button class="btn btn-primary" ${afford ? "" : "disabled"} onclick="commissionMandate('${f.band}','${f.planet}','${f.task}',${f.dur})">📜 Commission (${fmt(fee)} cr)</button></div>
    </div>`;
  }
  return `<div class="subtitle">Put a crew to work: send them to a system for a set run to <b>cull pirates</b>, <b>guard the lanes</b> or <b>prey on shipping</b>. You pay an upfront fee and take a cut of what they bring in. Lawful tasks thin out pirate activity there; raiding pays more but is piracy in your name.</div>
    ${active ? `<div class="cards">${active}</div>` : '<div class="card"><div class="hint">No active mandates. Commission one below.</div></div>'}
    ${form}`;
}
/* ---- Talk: free-form in-character chat with a band's captain, voiced by a
   locally-running Ollama model (pirateChat.js owns the persona/network side).
   UI-only runtime state, same pattern as mandateForm — never saved. ---- */
let chatUI = { bandId: null, drafts: {}, sending: {}, pending: {}, error: {}, testing: false, testStatus: null, offers: {} };
function openBandChat(id) { chatUI.bandId = id; setSubView("contacts", "chat"); }
function setChatBand(id) { chatUI.bandId = id; renderContacts(); }
function updateChatDraft(id, v) { chatUI.drafts[id] = v; }   // captured without a re-render, so typing never loses focus
function updateOfferAmount(id, v) { chatUI.offers[id] = v; }
function clearBandChat(id) { chatUI.error[id] = null; chatUI.pending[id] = null; clearPirateChat(id); }
function runOllamaTest() {
  if (chatUI.testing) return;
  chatUI.testing = true; chatUI.testStatus = null; renderContacts();
  testOllamaConnection().then(res => { chatUI.testing = false; chatUI.testStatus = res; renderContacts(); });
}
function sendChatMessage(id) {
  const b = bandById(id); if (!b || chatUI.sending[id]) return;
  const inputEl = document.getElementById("chatInputBox");
  const text = ((inputEl && inputEl.value) || chatUI.drafts[id] || "").trim();
  if (!text) return;
  chatUI.drafts[id] = ""; chatUI.error[id] = null;
  pushChatMessage(id, "you", text);
  chatUI.sending[id] = true; chatUI.pending[id] = "";
  renderContacts();
  ollamaChat(id, text, {
    onToken: soFar => {
      const el = document.getElementById("chatPending"); if (el) el.textContent = soFar;
      const t = document.getElementById("chatTranscript"); if (t) t.scrollTop = t.scrollHeight;
    },
    onThinking: soFar => {
      const el = document.getElementById("chatThinking"); if (el) el.textContent = soFar;
      const t = document.getElementById("chatTranscript"); if (t) t.scrollTop = t.scrollHeight;
    },
    onDone: full => {
      chatUI.sending[id] = false; chatUI.pending[id] = null;
      pushChatMessage(id, "pirate", (full || "").trim() || "…");
      renderContacts();
    },
    onError: msg => {
      chatUI.sending[id] = false; chatUI.pending[id] = null; chatUI.error[id] = msg;
      renderContacts();
    },
  });
}
// haggle the escort hire fee: a struck ACCEPT/COUNTER becomes a real, bounded discount
// (setBandNegotiatedFee, pirateBands.js) that the Escort tab's own hire button honors later —
// this view never hires anyone itself. Not shown as a live token stream (the reply ends in a
// machine-readable line we strip out), just a "haggling" placeholder until it resolves.
function sendOffer(id) {
  const b = bandById(id); if (!b || chatUI.sending[id]) return;
  const bounds = bandNegotiationBounds(b);
  const raw = parseInt(chatUI.offers[id], 10);
  const offer = Math.max(bounds.lo, Math.min(bounds.hi, Number.isFinite(raw) ? raw : escortRecruitFee(b)));
  chatUI.error[id] = null;
  pushChatMessage(id, "you", `I'll offer ${fmt(offer)} cr to hire your crew as my escort.`);
  chatUI.sending[id] = true; chatUI.pending[id] = "🤝 haggling…";
  renderContacts();
  ollamaNegotiate(id, offer, {
    onThinking: soFar => {
      const el = document.getElementById("chatThinking"); if (el) el.textContent = soFar;
      const t = document.getElementById("chatTranscript"); if (t) t.scrollTop = t.scrollHeight;
    },
    // the game already decided ACCEPT/COUNTER/REJECT (+ price) before the LLM call ever
    // started, so this always resolves via onDone — even with Ollama unreachable (offline:
    // true, a generic fallback line) — never blocked on the model actually answering
    onDone: result => {
      chatUI.sending[id] = false; chatUI.pending[id] = null;
      pushChatMessage(id, "pirate", result.clean);
      if (result.status === "accept" || result.status === "counter") {
        const struck = setBandNegotiatedFee(id, result.amount);   // already triggers renderAll()
        chatUI.offers[id] = struck;
      } else {
        renderContacts();   // reject: no deal struck, so no renderAll() from setBandNegotiatedFee — refresh ourselves
      }
      if (result.offline) toast("Ollama's offline — the outcome still applies, just without an AI-voiced reply.", "");
    },
  });
}
function chatBubble(who, text, id) {
  const mine = who === "you";
  return `<div class="chat-bubble ${mine ? "you" : "pirate"}"><span class="chat-text"${id ? ` id="${id}"` : ""}>${escapeChatHtml(text)}</span></div>`;
}
function chatSettingsCard() {
  const cfg = ensureOllamaSettings();
  const status = chatUI.testing ? `<span class="hint">Checking…</span>`
    : !chatUI.testStatus ? `<span class="hint">Not tested yet.</span>`
    : chatUI.testStatus.ok
      ? `<span style="color:var(--good)">✅ Connected${chatUI.testStatus.hasModel ? "" : ` — model "${escapeChatHtml(cfg.model)}" isn't pulled yet: run <code>ollama pull ${escapeChatHtml(cfg.model)}</code>`}</span>`
      : `<span style="color:var(--bad)">❌ ${escapeChatHtml(chatUI.testStatus.error)}</span>`;
  return `<div class="card">
    <h4>⚙️ Ollama connection</h4>
    <div class="desc">Chat runs entirely on your machine — straight from this page to a local Ollama server, never through Stellar Frontier's own servers.</div>
    <div class="row" style="flex-wrap:wrap;gap:6px;align-items:center">
      <span class="hint">Endpoint</span><input class="chat-field" style="width:200px" type="text" value="${escapeChatHtml(cfg.endpoint)}" onchange="setOllamaSetting('endpoint', this.value)" />
      <span class="hint">Model</span><input class="chat-field" style="width:130px" type="text" value="${escapeChatHtml(cfg.model)}" onchange="setOllamaSetting('model', this.value)" />
      <button class="btn btn-sm" ${chatUI.testing ? "disabled" : ""} onclick="runOllamaTest()">🔌 Test</button>
    </div>
    <div class="hint">${status}</div>
    <div class="hint">Can't connect? Make sure <code>ollama serve</code> is running, and that it allows this page's origin — e.g. start it with <code>OLLAMA_ORIGINS=*</code> set.</div>
    <label class="row" style="align-items:center;gap:6px;cursor:pointer">
      <input type="checkbox" ${cfg.think ? "checked" : ""} onchange="toggleOllamaThink()" />
      <span class="hint">🧠 Show model thinking (reasoning models like Qwen3/QwQ/DeepSeek-R1 only — slower, but you can watch them reason before they answer)</span>
    </label>
  </div>`;
}
function renderContactsChat() {
  const bands = bandList().sort((a, b) => (b.rep || 0) - (a.rep || 0));
  if (!bands.length) {
    return `${chatSettingsCard()}<div class="card"><div class="hint">No pirate bands on your books yet — hunt or ally with them from the ⚔️ Raider tab, then come back to talk.</div></div>`;
  }
  if (!chatUI.bandId || !bandById(chatUI.bandId)) chatUI.bandId = bands[0].id;
  const b = bandById(chatUI.bandId);
  const picker = bands.map(x => `<option value="${x.id}" ${x.id === b.id ? "selected" : ""}>${x.ico} ${x.name} · ${bandTier(x).label}</option>`).join("");
  const pr = bandPers(b), tier = bandTier(b), rival = bandFoe(b);
  const fee = escortRecruitFee(b), cut = Math.round(bandLootShare(b) * 100), deal = bandNegotiatedFee(b);
  const history = pirateChatHistory(b.id);
  const sending = !!chatUI.sending[b.id], pending = chatUI.pending[b.id], err = chatUI.error[b.id];
  const thinkingBlock = (pending != null && ensureOllamaSettings().think)
    ? `<div class="chat-thinking"><div class="hint">🧠 thinking…</div><div id="chatThinking" class="chat-thinking-text"></div></div>` : "";
  const bubbles = history.map(m => chatBubble(m.who, m.text)).join("")
    + thinkingBlock
    + (pending != null ? chatBubble("pirate", pending, "chatPending") : "")
    + (err ? `<div class="chat-bubble error"><span class="chat-text">⚠️ ${escapeChatHtml(err)}</span></div>` : "");
  const draft = chatUI.drafts[b.id] || "";
  const canNegotiate = ["neutral", "friendly", "sworn"].includes(tier.key);
  const bounds = bandNegotiationBounds(b);
  const offerVal = chatUI.offers[b.id] || fee;
  const dealLine = deal != null
    ? `<div class="hint" style="color:var(--good)">🤝 Agreed rate: ${fmt(deal)} cr — holds ${b.negotiatedUntil - S.turn} more cycle${b.negotiatedUntil - S.turn === 1 ? "" : "s"}, or until you sign them on from the 🛡️ Escort tab.</div>`
    : "";
  const offerRow = !canNegotiate
    ? `<div class="hint">Too ${tier.key === "hostile" ? "hostile" : "wary of you"} to talk hiring terms — improve standing first.</div>`
    : `<div class="row" style="margin-top:6px;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="hint">Offer (${fmt(bounds.lo)}-${fmt(bounds.hi)} cr)</span>
        <input id="dealOfferBox" class="chat-field" style="width:100px" type="number" min="${bounds.lo}" max="${bounds.hi}" value="${offerVal}" ${sending ? "disabled" : ""} oninput="updateOfferAmount('${b.id}', this.value)" />
        <button class="btn btn-sm" ${sending ? "disabled" : ""} onclick="sendOffer('${b.id}')">💰 Make offer</button>
      </div>`;
  return `${chatSettingsCard()}
    <div class="card">
      <h4>${b.ico} ${b.name} <span class="hint">${pirateRankName(b)} · ${pr.ico} ${pr.name} · ${tier.label} (${b.rep})</span></h4>
      ${rival ? `<div class="hint" style="color:var(--bad)">⚔️ feuding with the ${rival.name}</div>` : ""}
      <div class="hint">Ballpark: hire ~${fmt(fee)} cr · loot cut ~${cut}%. Chat is in character and doesn't move credits by itself — use the buttons under 🤝 All contacts for that.</div>
      ${dealLine}
      <div class="row" style="align-items:center;gap:6px;flex-wrap:wrap">
        <span class="hint">Talking to</span>
        <select onchange="setChatBand(this.value)">${picker}</select>
        <button class="btn btn-sm" onclick="clearBandChat('${b.id}')">🗑️ Clear</button>
      </div>
      <div id="chatTranscript" class="chat-transcript">${bubbles || '<div class="hint">Say something to break the ice.</div>'}</div>
      <div class="row chat-input-row">
        <input id="chatInputBox" class="chat-field" type="text" placeholder="${sending ? "Waiting for a reply…" : "Say something…"}" value="${escapeChatHtml(draft)}"
          ${sending ? "disabled" : ""} oninput="updateChatDraft('${b.id}', this.value)"
          onkeydown="if(event.key==='Enter'){event.preventDefault();sendChatMessage('${b.id}');}" />
        <button class="btn btn-primary" ${sending ? "disabled" : ""} onclick="sendChatMessage('${b.id}')">${sending ? "…" : "Send"}</button>
      </div>
      ${offerRow}
    </div>`;
}
/* ---------- Generic in-panel sub-tabs ----------
   A lightweight tab strip inside a panel. View state is UI-only (not saved);
   an unknown/stale view falls back to the first. Used by Ship, Research and
   Industry to break long pages into focused sections. */
const subViews = {};
function subView(panel, views) {
  const cur = subViews[panel];
  return views.some(v => v[0] === cur) ? cur : views[0][0];
}
function subTabBar(panel, views) {
  const cur = subView(panel, views);
  return `<div class="row subtabs" style="margin:6px 0 12px;flex-wrap:wrap">${views.map(([id, lbl]) =>
    `<button class="btn btn-sm ${cur === id ? "btn-primary" : ""}" onclick="setSubView('${panel}','${id}')">${lbl}</button>`).join("")}</div>`;
}
function setSubView(panel, v) {
  subViews[panel] = v;
  ({ ship: renderShipPanel, research: renderResearch, industry: renderIndustry, colonies: renderColonies, bases: renderBases, contacts: renderContacts, fleet: renderFleet }[panel] || renderAll)();
}

/* ----- Ship ----- */
// Ship outfitting grouped into focused bays
const SHIP_CATEGORIES = [
  ["core",   "🚀 Core",          ["cargo", "fueltank", "engine"]],
  ["gather", "⛏️ Gathering",     ["miner", "hydro", "gasscoop", "salvager", "factory", "reactor", "lab"]],
  ["combat", "⚔️ Combat",        ["shield", "armor", "pointdef", "dronebay", "aimain", "cannons"]],
  ["trade",  "🕴️ Trade & Holds", ["hazmat", "smuggler", "trade", "envoy"]],
];
const SHIP_TAB_VIEWS = SHIP_CATEGORIES.map(c => [c[0], c[1]]);

function shipUpgradeCard(u) {
  const tier = S.upgrades[u.id], maxed = tier >= u.tiers, cost = upgradeCost(u);
  const dots = Array.from({ length: u.tiers }, (_, i) => `<span class="dot ${i < tier ? "on" : ""}"></span>`).join("");
  const cls = maxed ? "card maxed" : tier > 0 ? "card owned" : "card";
  return `<div class="${cls}">
    <h4>${u.ico} ${u.name} <span class="tier-dots">${dots}</span></h4>
    <div class="desc">${u.desc}</div>
    <div class="hint">Current: ${tier > 0 ? u.effect(tier) : "not installed"}</div>
    ${maxed ? `<div class="pill good">◉ Fully upgraded</div>`
      : `<div class="meta"><span class="hint">Next: ${u.effect(tier + 1)}</span><span class="cost">${fmt(cost)} 💰</span></div>
         <button class="btn btn-primary" ${S.res.credits >= cost ? "" : "disabled"} onclick="buyUpgrade('${u.id}')">Install Tier ${tier + 1}</button>`}
  </div>`;
}
function repairBayHTML() {
  const P = S.pirate;
  const hullCol = P.hull >= 60 ? "var(--good)" : P.hull >= 30 ? "var(--warn)" : "var(--bad)";
  const anyDamage = P.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100);
  const hullBtn = P.hull < HULL_MAX
    ? `<button class="btn btn-good btn-sm" onclick="repairShip()">🔧 Repair hull (${fmt(Math.round((HULL_MAX - P.hull) * 30 * repairDiscount()))} 💰${repairDiscount() < 1 ? ", " + Math.round((1 - repairDiscount()) * 100) + "% off" : ""})</button>`
    : "";
  const repairLocal = localStockpileAt(S.location);
  const subRows = SUBSYS.map(k => {
    const c = shipCond(k), col = c >= 60 ? "var(--good)" : c >= 30 ? "var(--warn)" : "var(--bad)", m = SUBSYS_META[k], q = subsysRepairCost(k);
    return `<div class="ship-stat"><span class="k">${m.ico} ${m.name}</span><span class="v" style="color:${col}">${c}%</span></div>
      <div class="bar"><span style="width:${c}%;background:${col}"></span></div>
      ${q ? `<button class="btn btn-sm" style="margin:2px 0 4px" ${(S.res.credits >= q.credits && canAffordMats({ [q.mat]: q.matQ }, repairLocal)) ? "" : "disabled"} title="Repair ${m.name}: ${fmt(q.credits)} cr + ${q.matQ} ${COM[q.mat].name}" onclick="repairSubsys('${k}')">🔧 ${m.name} (${fmt(q.credits)}💰+${q.matQ}${COM[q.mat].ico})</button>` : ""}`;
  }).join("");
  const stockpileNote = repairLocal ? ` <span class="hint">(materials draw from the local stockpile first, then your hold)</span>` : "";
  return `<div class="card" style="margin-bottom:12px"><h4>🔧 Repair Bay <span class="hint">— docked at ${currentPlanet().name}</span>${stockpileNote}</h4>
    <div class="ship-stat"><span class="k">🛡️ Hull</span><span class="v" style="color:${hullCol}">${P.hull}/${HULL_MAX}</span></div>
    <div class="bar"><span style="width:${P.hull}%;background:${hullCol}"></span></div>
    ${hullBtn}
    <div class="ship-stat" style="margin-top:8px"><span class="k">🛠️ Subsystems</span><span class="v">${SUBSYS.every(k => shipCond(k) >= 100) ? '<span class="pill good">all nominal</span>' : ""}</span></div>
    ${subRows}
    ${anyDamage ? `<button class="btn btn-good" style="margin-top:6px" onclick="repairAll()">🛠️ Full refit (hull + systems)</button>` : '<div class="pill good" style="margin-top:6px">◉ All systems pristine</div>'}
  </div>`;
}
function shipTrimHTML() {
  const pool = trimBuildPool();
  if (S.trimRefit) {
    const t = SHIP_TRIMS[S.trimRefit.target], cur = shipTrim();
    return `<div class="card" style="margin-bottom:12px"><h4>🛠️ Ship Trim <span class="hint">refit in progress</span></h4>
      <div class="hint">Reconfiguring to ${t.ico} ${t.name} (${t.hint}) — ${S.trimRefit.cyclesLeft} cycle${S.trimRefit.cyclesLeft === 1 ? "" : "s"} left. Running on ${cur.ico} ${cur.name} until it completes.</div></div>`;
  }
  const cost = trimRefitCost(), cyc = trimRefitCycles();
  const rows = Object.keys(SHIP_TRIMS).map(id => {
    const t = SHIP_TRIMS[id], active = id === S.trim, afford = (S.res.credits || 0) >= cost;
    return `<div class="ship-stat" style="align-items:center"><span class="k">${t.ico} ${t.name}${active ? ' <span class="pill good">active</span>' : ""} <span class="hint">${t.hint}</span></span>
      <span class="v">${active ? "" : `<button class="btn btn-sm ${afford ? "" : "disabled"}" title="Refit: ${fmt(cost)} cr · ${cyc} cyc" onclick="setShipTrim('${id}')">Refit (${fmt(cost)} cr · ${cyc} cyc)</button>`}</span></div>`;
  }).join("");
  return `<div class="card" style="margin-bottom:12px"><h4>🛠️ Ship Trim <span class="hint">${pool > 0 ? `reallocates ${pool} installed upgrade tier(s) between cargo/firepower/autonomy` : "install some Core/Combat upgrades first — nothing to trade yet"}</span></h4>
    <div class="hint">A trim is a real commitment: refits cost credits and take cycles to complete, and switching back costs the same as switching away.</div>
    ${rows}</div>`;
}
function renderShipPanel() {
  const el = document.getElementById("panel-ship");
  const cur = subView("ship", SHIP_TAB_VIEWS);
  const cat = SHIP_CATEGORIES.find(c => c[0] === cur) || SHIP_CATEGORIES[0];
  const inCat = new Set(SHIP_CATEGORIES.flatMap(c => c[2]));
  const ids = cur === SHIP_CATEGORIES[0][0]
    ? cat[2].concat(UPGRADES.filter(u => !inCat.has(u.id)).map(u => u.id))   // stash any uncategorised module in Core
    : cat[2];
  const cards = ids.map(id => UPGRADES.find(u => u.id === id)).filter(Boolean).map(shipUpgradeCard).join("");
  el.innerHTML = `<h2>Ship Outfitting — S.S. Wanderer</h2>
    <div class="subtitle">Twenty upgrade systems across four bays, three tiers each. Some modules (Gas Scoop, Salvage Rig) unlock new extraction; others (Shielded & Smuggler's Holds) keep contraband out of customs' hands.</div>
    ${repairBayHTML()}
    ${shipTrimHTML()}
    ${subTabBar("ship", SHIP_TAB_VIEWS)}
    <div class="cards">${cards}</div>`;
}


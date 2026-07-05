/* ============================================================
   STELLAR FRONTIER — raid resolution & ship repair
   The second half of the old "PIRATE BANDS" section: multi-round raid
   combat (each attack is a free round — no cycle-actions spent, the hunt
   that found the foe already paid that cost), allied bands and coalition
   reinforcements joining a fight, plunder and the pirate/merchant win
   paths, sparing a beaten crew, ship + subsystem repair (dockside and
   field patches mid-fight), and the Wanted/Dread cooldown with its bounty-
   hunter counterplay.

   Loaded after pirateBands.js, before game.js. applyCommissionRaid,
   revokeCommission, COMM_BOUNTY, battleGroupFirepower/Ships/TakeFire,
   fleetList, atHaven, atBase, repairDiscount, repairVenueNote, matsString,
   FACTION_KEYS and factionsAreRivals still live in game.js/sector4x.js at
   this point in the split — safe, since every function here is only CALLED
   later, once every script has finished loading, same pattern as every
   prior slice.
   ============================================================ */

"use strict";

// crews riding WITH you (following) pitch into a fresh engagement on their own — any prey, incl. letter-of-marque shipping
function raidJoinFollowers() {
  if (!S.prey) return;
  S.allies = S.allies || [];
  bandList().filter(bandFollowing).forEach(b => {
    if (S.allies.length >= 2 || S.allies.some(a => a.bandId === b.id) || bandRivalServing(b)) return;
    const a = bandAsAlly(b); S.allies.push(a); foeHp(a);
    b.allied = (b.allied || 0) + 1;
    log(`🛰️ The ${b.ico} ${b.name}, riding with you, swing in to your side (${Math.round(a.share * 100)}% cut).`, "event");
  });
}
// an allied pirate's raw damage contribution to a salvo — returns a number rather than applying
// it directly, same shape battleGroupFirepower already has, so it can pool into a shared total
// that combatStrike then splits across however many hostiles are being targeted this round.
function allyStrike(ally) {
  const fp = bandPers(bandById(ally.bandId)).fp;          // bold crews hit harder
  return Math.max(1, Math.round((ally.strength * 0.45 + Math.random() * 6) * fp));
}
const RESCUE_PACK_CAP = 2;
// a coalition victim may summon EVERY same-faction vessel in the area to its rescue at once —
// not a trickle. Each round still rolls a fresh 20% chance for the call to land, but once it
// does, the whole available response joins together (capped, for balance), matching the Escort
// tab's wave spawning (spawnEscortWave) rather than a one-per-round reveal.
function maybeRescue(prey) {
  if (!prey || prey.isPirate) return;
  prey.pack = prey.pack || [];
  const room = RESCUE_PACK_CAP - prey.pack.length;
  if (room <= 0) return;
  const others = prey._others || [];
  const eligible = others.filter(o => !o.isPirate);
  if (!eligible.length) return;
  if (Math.random() < 0.20) {
    const reinforcements = eligible.slice(0, room);
    reinforcements.forEach(r => { prey._others = prey._others.filter(o => o !== r); prey.pack.push(r); foeHp(r); });
    const names = reinforcements.map(r => `${classLabel(r)}${FACTIONS[r.faction] ? " (" + FACTIONS[r.faction].name + ")" : ""}`).join(", ");
    log(`🆘 The ${prey.name} sent a distress call — ${names} answer${reinforcements.length === 1 ? "s" : ""} together! You now face ${prey.pack.length + 1} vessels, all defending as one.`, "bad");
    toast(`Reinforcements: ${reinforcements.map(r => r.name).join(", ")}!`, "bad");
  }
}
function raidCallAllies() {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your pirate band is already full.", "bad");
  const others = S.prey._others || [];
  // bind area pirates to bands; only crews that aren't sworn enemies will rally
  const pirates = others.filter(o => o.isPirate);
  const willing = pirates.filter(a => { const b = bindBand(a, true); return bandWillAlly(b); });
  if (!pirates.length) return toast("No pirates in the area to call to your side.", "bad");
  if (!willing.length) return toast("The pirates here bear you a grudge — none will fight at your side.", "bad");
  const take = willing.slice(0, 2 - S.allies.length);
  const notes = [];
  take.forEach(a => {
    const b = bandById(a.bandId);
    a.share = bandLootShare(b); a.allyName = b ? b.name : a.name;
    S.allies.push(a); foeHp(a);
    S.prey._others = (S.prey._others || []).filter(o => o !== a);
    if (b) {
      b.allied = (b.allied || 0) + 1; bandRepAdd(b, 6);              // every call deepens the friendship
      const rival = bandFoe(b); if (rival) bandRepAdd(rival, -8);    // siding with a crew angers its blood rival
    }
    notes.push(`${b ? b.ico + " " + b.name : a.name} (${Math.round(a.share * 100)}% cut)`);
  });
  const yours = Math.round(lootShare() * 100);
  log(`📣 ${notes.join(", ")} rally to your guns — they fire independently. Your share of the loot: <b>${yours}%</b>.`, "event");
  toast(`${take.length} band(s) joined — your cut ${yours}%`, "event");
  afterAction();
}
// bring a standing-by (on-call/following) or locally-based willing band into the current fight
function raidSummonOnCall(id) {
  if (!S.prey) return toast("No engagement.", "bad");
  S.allies = S.allies || [];
  if (S.allies.length >= 2) return toast("Your pirate band is already full.", "bad");
  const b = bandById(id); if (!b || !(bandOnCall(b) || (bandWillAlly(b) && bandDistance(b) === 0))) return toast("They aren't in reach to join.", "bad");
  if (b.id === (S.prey.bandId || null)) return toast("That's the crew you're fighting.", "bad");
  if (S.allies.some(a => a.bandId === id)) return toast(`The ${b.name} are already at your side.`, "bad");
  if (bandRivalServing(b)) { const r = bandFoe(b); return toast(`The ${b.name} won't fight beside their rivals the ${r ? r.name : "other crew"}.`, "bad"); }
  const a = bandAsAlly(b); S.allies.push(a); foeHp(a);
  b.allied = (b.allied || 0) + 1; bandRepAdd(b, 6);
  const rival = bandFoe(b); if (rival) bandRepAdd(rival, -8);
  log(`📣 The ${b.ico} ${b.name} swing in from nearby to your side (${Math.round(a.share * 100)}% cut). Your share: <b>${Math.round(lootShare() * 100)}%</b>.`, "event");
  toast(`${b.name} joined the fight`, "event"); afterAction();
}
function plunder(prey) {
  const share = lootShare();
  const taken = [];
  Object.keys(prey.cargo).forEach(c => {
    const room = cargoFree();
    const q = Math.min(Math.floor(prey.cargo[c] * share), room);
    if (q > 0) { S.res[c] = (S.res[c] || 0) + q; taken.push(`${q} ${COM[c].ico}`); }
  });
  const cr = Math.round(prey.credits * share * fxMult("lootMult"));   // Feared Name boosts the take
  S.res.credits += cr;
  let value = cr;
  Object.keys(prey.cargo).forEach(c => value += Math.floor(prey.cargo[c] * share) * COM[c].base);
  S.pirate.plundered += Math.round(value);
  return taken;
}
/* ---------- Multi-round raids (free combat sub-loop) ----------
   Each attack is one free round: you wear the foe's hull down, it fires back
   at your hull and subsystems. The engagement ends when the foe is destroyed,
   you disengage, or your hull buckles. Rounds cost no cycle-actions (the hunt
   that found the foe already did) — the cost is damage and the repairs after. */
function raidWinPirate(prey) {
  const taken = plunder(prey);
  S.pirate.dread += 3; clampPirate();
  pirateKillRewards(prey);
  const share = lootShare();
  const killed = bandById(prey.bandId);
  if (killed) { killed.fought = (killed.fought || 0) + 1; bandRepAdd(killed, -30); }   // blood spilled — collaboration craters
  (S.allies || []).forEach(a => { const b = bandById(a.bandId); if (b) bandRepAdd(b, 4); });  // fought at your side
  log(`🎯 You destroyed the ${prey.ico} ${prey.name}${killed ? ` of the ${killed.name}` : ""}! Bounty ${fmt(Math.round(prey.bounty * share))} cr + salvage ${taken.join(" ") || "none"}${share < 1 ? ` <span class="hint">(your cut ${Math.round(share * 100)}%)</span>` : ""}. (a lawful kill — no Wanted)`, "good");
  toast(`Bounty: ${fmt(Math.round(prey.bounty * share))} cr!`, "good");
}
function raidWinMerchant(prey, noQuarter) {
  const betray = S.commission && prey.faction === S.commission.patron;
  const taken = plunder(prey);
  const dread = noQuarter ? 9 : 5;
  const sanctioned = applyCommissionRaid(prey);
  const wanted = sanctioned ? (noQuarter ? 8 : 0) : prey.wantedGain + (noQuarter ? 8 : 0);
  S.pirate.dread += dread; S.pirate.wanted += wanted;
  addRep(prey.faction, noQuarter ? -14 : -8);
  if (!sanctioned) addRep("core", -(prey.faction === "core" ? 8 : 5));
  addRep("frontier", 3);
  // bloodying a coalition's rival is a real risk (Wanted, dread) their own agents notice and
  // reward, whether or not you're formally commissioned against that target — applyCommissionRaid
  // (above) still separately pays a matching commission's own patron, so this stacks with that.
  FACTION_KEYS.filter(f => f !== prey.faction && factionsAreRivals(f, prey.faction)).forEach(f => addRep(f, 2));
  clampPirate();
  log(`🏴‍☠️ You took the ${prey.ico} ${prey.name}${noQuarter ? " and gave no quarter" : ""}! Plundered ${taken.join(" ") || "no cargo"}${lootShare() < 1 ? ` <span class="hint">(split ${1 / lootShare()} ways)</span>` : ""}.${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""} (Dread +${dread}, Wanted +${wanted})`, "good");
  toast(`Plundered ${prey.name}!`, "good");
  if (betray) revokeCommission(true);
}
function promoteOrEnd(prey) {
  if (prey.pack && prey.pack.length) {
    const next = prey.pack.shift();
    next.pack = prey.pack; next._others = prey._others; next._engaged = true; foeHp(next);
    S.prey = next;
    log(`Now engaging the ${classLabel(next)} <span class="c">${next.name}</span> — ${next.pack.length + 1} hostile(s) remain.`, "bad");
  } else { clearEngagement(); }
}
// ---- target selection for a pooled engagement: pick any subset of allHostiles(S.prey) to
// focus fire on this round (indices into that array). Picking none spreads pooled damage
// across every living hostile by default — same convention Escort's own wave combat uses
// (escortToggleTarget/escortFocus, escort.js). ----
function raidToggleTarget(idx) {
  if (!S.prey) return;
  const hostiles = allHostiles(S.prey);
  if (!hostiles[idx] || hostiles[idx].hp <= 0) return;
  S.raidTargets = S.raidTargets || [];
  const at = S.raidTargets.indexOf(idx);
  if (at >= 0) S.raidTargets.splice(at, 1); else S.raidTargets.push(idx);
  saveGame(); renderAll();
}
function raidFocusTarget(idx) {
  if (!S.prey) return;
  const hostiles = allHostiles(S.prey);
  if (!hostiles[idx] || hostiles[idx].hp <= 0) return;
  S.raidTargets = [idx];
  saveGame(); renderAll();
}
// a salvo can kill more than one hostile at once now (pooled fire split across several targets).
// Non-anchor kills are just spliced out of the pack; if the anchor itself died, reuse the
// existing promoteOrEnd (promotes a surviving pack member, or clears the engagement if none
// remain) — the only case that still needs it.
function raidResolveKills(anchor, killed) {
  const anchorDied = killed.includes(anchor);
  killed.filter(h => h !== anchor).forEach(h => { anchor.pack = (anchor.pack || []).filter(x => x !== h); });
  if (anchorDied) promoteOrEnd(anchor);
  S.raidTargets = [];   // the group composition changed — start the next round with a clean default
}
function combatStrike(noQuarter, wkey) {
  const prey = S.prey; if (!prey) return;
  wkey = wkey && WEAPONS[wkey] && weaponAvailable(wkey) && weaponAffordable(wkey) ? wkey : "kinetic";
  if (!weaponAffordable(wkey)) return toast(`No ammo for ${WEAPONS[wkey].name}.`, "bad");
  if (!prey._engaged) { prey._engaged = true; S.pirate.raids++; }
  const hostiles = allHostiles(prey);
  hostiles.forEach(h => foeHp(h));
  payAmmo(wkey); noteWeaponUse(wkey); combatState().lastWeapon = wkey;
  let targetIdxs = (S.raidTargets || []).filter(i => hostiles[i] && hostiles[i].hp > 0);
  if (!targetIdxs.length) targetIdxs = hostiles.map((h, i) => (h.hp > 0 ? i : -1)).filter(i => i >= 0);
  const ps = playerStrikes(prey, wkey);
  let allyDmg = 0;
  (S.allies || []).forEach(a => { allyDmg += allyStrike(a); });
  const bgDmg = battleGroupFirepower();
  const per = (ps.dmg + allyDmg + bgDmg) / targetIdxs.length;
  const killed = [];
  const hits = targetIdxs.map(i => {
    const h = hostiles[i];
    const tgt = applyTargetedDamage(h, per);
    if (h.hp <= 0) killed.push(h);
    const pct = Math.max(0, Math.round(Math.max(0, h.hp) / h.maxhp * 100));
    return `${h.ico} ${h.name} for ${tgt.hullDmg} hull (now ${pct}%)${tgt.note}`;
  });
  const dmgNote = `${allyDmg > 0 ? ` · 🤝 allies +${Math.round(allyDmg)}` : ""}${bgDmg > 0 ? ` · ✦ battle fleet +${Math.round(bgDmg)}` : ""}`;
  if (killed.length) {
    sfx("explode");
    killed.forEach(h => { if (h.isPirate) raidWinPirate(h); else raidWinMerchant(h, noQuarter); });
    raidResolveKills(prey, killed);
    log(`⚔️ You hit ${hits.join("; ")}${dmgNote} — destroyed ${killed.map(h => h.name).join(", ")}!`, "good");
    return afterAction();
  }
  sfx("fire");
  const incoming = [];
  for (let idx = 0; idx < hostiles.length; idx++) {
    const fs = foeStrikes(hostiles[idx], idx === 0 ? (noQuarter ? 0.27 : 0.22) : 0.20);
    incoming.push(`${idx === 0 ? "" : hostiles[idx].ico + " "}−${fs.dmg}${subsysHitLog(fs.subHit)}`);
    if (!S.prey) break;   // shipCrippled ended the engagement
  }
  if (battleGroupShips().length) {
    let bgTaken = 0;
    hostiles.forEach(h => { bgTaken += battleGroupTakeFire(h); });   // the whole hostile group threatens the battle fleet, not just the anchor
    if (bgTaken) incoming.push(`✦ battle fleet −${bgTaken}`);
    if (fleetList().some(s => s._dead)) S.fleet = fleetList().filter(s => !s._dead);
  }
  log(`⚔️ You hit ${hits.join("; ")}${dmgNote}; return fire — Hull ${incoming.join(", ")}.`, "");
  const frontPct = Math.max(0, Math.round(Math.max(0, prey.hp) / prey.maxhp * 100));
  toast(`Foe hull ${frontPct}%${prey.pack && prey.pack.length ? ` · +${prey.pack.length} more` : ""}`, "");
  if (!S.prey) return afterAction();
  maybeRescue(prey);
  if (foeFleeCheck(prey)) {
    if (prey.isPirate) { const b = bandById(prey.bandId); if (b) bandRepAdd(b, 4); }   // they live to remember you let them go
    log(`🏃 The ${prey.ico} ${prey.name} lit its drive and jumped clear — you never crippled its 🚀 engines. The ${prey.isPirate ? "bounty" : "haul"} got away.`, "bad");
    toast(`${prey.name} escaped!`, "bad");
    promoteOrEnd(prey);
    return afterAction();
  }
  afterAction();
}
function raidAttack(wkey) { if (!S.prey) return; combatStrike(false, wkey); }
function raidNoQuarter(wkey) { if (!S.prey || S.prey.isPirate) return; combatStrike(true, wkey); }
function raidExtort() {
  const prey = S.prey; if (!prey) return;
  const intimidation = S.pirate.dread + raidPower() * 0.3 + Math.random() * 20;
  if (intimidation >= prey.strength * 1.4) {
    // they surrender tribute without a fight — partial haul, low heat
    const tributeCargo = {};
    Object.keys(prey.cargo).forEach(c => { const q = Math.floor(prey.cargo[c] * 0.6); if (q > 0) tributeCargo[c] = q; });
    const credits = Math.round(prey.credits * 0.6);
    const taken = plunder({ cargo: tributeCargo, credits });
    const sanctioned = applyCommissionRaid(prey);
    S.pirate.dread = Math.max(0, S.pirate.dread - 12); if (!sanctioned) S.pirate.wanted += Math.round(prey.wantedGain * 0.4);   // menace spent leaning on them
    addRep(prey.faction, -5); clampPirate();
    log(`💀 Your reputation alone broke the ${prey.ico} ${prey.name} — it paid tribute: ${taken.join(" ") || "credits"} + ${fmt(credits)} cr.${sanctioned ? ` ⚖️ Sanctioned bounty +${fmt(COMM_BOUNTY)} cr.` : ""} No shots fired. <span class="hint">(Dread −12 — fear fades when it isn't backed by blood)</span>`, "good");
    toast(`Tribute extorted from ${prey.name}! (Dread −12)`, "good");
  } else {
    S.pirate.dread = Math.max(0, S.pirate.dread - 5); S.pirate.wanted += Math.round(prey.wantedGain * 0.3); clampPirate();   // a called bluff dents your menace
    log(`💀 The ${prey.ico} ${prey.name} called your bluff and ran. You aren't feared enough… yet. <span class="hint">(Dread −5)</span>`, "bad");
    toast("They called your bluff. (Dread −5)", "bad");
  }
  if (S.commission && prey.faction === S.commission.patron) revokeCommission(true);
  clearEngagement();
  afterAction();
}
// spare a beaten pirate crew instead of finishing them — they remember the mercy
function raidCanSpare() { const p = S.prey; return !!(p && p.isPirate && p._engaged && foeHp(p) <= p.maxhp * 0.35); }
function raidSpareRecruit() {
  if (!raidCanSpare()) return toast("Cripple them first — a proud crew won't parley until they're beaten.", "bad");
  const prey = S.prey; const b = bandById(prey.bandId) || bindBand(prey);
  if (b) bandRepAdd(b, 20);
  log(`🤝 You stayed your guns and let the ${prey.ico} ${prey.name}${b ? " of the " + b.name : ""} limp away — a debt they'll remember. Collaboration +20.`, "good");
  toast(`${b ? b.name : "Crew"}: +20 standing (spared)`, "good"); sfx("event");
  promoteOrEnd(prey);                                     // next consort steps up, or the engagement ends
  afterAction();
}
function raidVolley(n) {
  n = Math.max(1, Math.min(8, n || 5));
  const wkey = (combatState().lastWeapon) || "kinetic";
  for (let i = 0; i < n; i++) {
    const foe = S.encounter || S.prey;
    if (!foe) break;                                   // foe destroyed or fled
    if (!weaponAffordable(wkey)) break;                // out of ammo for the chosen weapon
    if (S.encounter) encounterFight(wkey); else combatStrike(false, wkey);
  }
}
function raidDisengage() {
  if (!S.prey) return;
  if (S.prey.isPirate) { const b = bandById(S.prey.bandId); if (b) bandRepAdd(b, 3); }   // you spared the crew
  if (S.prey._engaged) {
    allHostiles(S.prey).forEach(f => { if (S.prey) foeStrikes(f, 0.2); });   // every hostile takes a parting shot
    log(`You break off from the ${S.prey ? S.prey.name : "engagement"}${S.prey && (S.prey.pack || []).length ? " and its consorts" : ""} under fire.`, "bad");
    toast("Broke off under fire.", "bad");
  } else {
    log("You let the target slip past, unmolested.", "");
  }
  clearEngagement();
  afterAction();
}
/* a repair at your own haven or base also tops off the fuel tank, free */
function topUpFuelAtVenue() {
  if (!(atHaven() || atBase())) return;
  const cap = fuelCap();
  if (S.res.fuel >= cap) return;
  const added = cap - S.res.fuel;
  S.res.fuel = cap;
  const where = atHaven() && atBase() ? "haven & base" : atHaven() ? "haven" : "base";
  log(`⛽ Topped off fuel (+${added}) at your ${where}.`, "good");
}
function repairShip() {
  if (combatLocked()) return;
  if (S.pirate.hull >= HULL_MAX) return toast("Hull is already pristine.", "bad");
  const cost = Math.round((HULL_MAX - S.pirate.hull) * 30 * repairDiscount());   // your own dry-dock & base workshop patch up cheap
  if (S.res.credits < cost) return toast(`Repairs cost ${fmt(cost)} credits.`, "bad");
  S.res.credits -= cost; S.pirate.hull = HULL_MAX;
  log(`🔧 Hull fully repaired at ${currentPlanet().name}${repairVenueNote()} for ${fmt(cost)} credits.`, "good");
  sfx("repair"); toast("Hull repaired.", "good");
  topUpFuelAtVenue();
  afterAction();
}
function subsysRepairCost(sub) {
  const c = shipCond(sub); if (c >= 100) return null;
  const miss = 100 - c, rate = 15 * repairDiscount();
  return { credits: Math.round(miss * rate), mat: SUBSYS_META[sub].mat, matQ: Math.ceil(miss / 35) };
}
function repairSubsys(sub) {
  if (combatLocked()) return;
  const q = subsysRepairCost(sub);
  if (!q) return toast(`${SUBSYS_META[sub].name} is intact.`, "bad");
  const local = localStockpileAt(S.location), mats = { [q.mat]: q.matQ };
  if (S.res.credits < q.credits) return toast(`${SUBSYS_META[sub].name} repair costs ${fmt(q.credits)} cr.`, "bad");
  if (!canAffordMats(mats, local)) return toast(`Need ${q.matQ} ${COM[q.mat].name} to repair ${SUBSYS_META[sub].name}.`, "bad");
  S.res.credits -= q.credits; payMats(mats, local); S.pirate.subsys[sub] = 100;
  log(`🔧 ${SUBSYS_META[sub].ico} ${SUBSYS_META[sub].name} repaired for ${fmt(q.credits)} cr + ${q.matQ} ${COM[q.mat].ico}.`, "good");
  toast(`${SUBSYS_META[sub].name} repaired.`, "good");
  topUpFuelAtVenue();
  afterAction();
}
function repairAll() {
  if (combatLocked()) return;
  let spent = 0; const did = []; const local = localStockpileAt(S.location);
  if (S.pirate.hull < HULL_MAX) {
    const cost = Math.round((HULL_MAX - S.pirate.hull) * 30 * repairDiscount());
    if (S.res.credits >= cost) { S.res.credits -= cost; S.pirate.hull = HULL_MAX; spent += cost; did.push("hull"); }
  }
  SUBSYS.forEach(sub => {
    const q = subsysRepairCost(sub); if (!q) return;
    const mats = { [q.mat]: q.matQ };
    if (S.res.credits >= q.credits && canAffordMats(mats, local)) {
      S.res.credits -= q.credits; payMats(mats, local); S.pirate.subsys[sub] = 100;
      spent += q.credits; did.push(SUBSYS_META[sub].name);
    }
  });
  if (!did.length) return toast("Nothing to refit, or you can't afford it.", "bad");
  log(`🔧 Refit at ${currentPlanet().name}: ${did.join(", ")} — ${fmt(spent)} cr + materials.`, "good");
  sfx("repair"); toast("Ship refitted.", "good");
  topUpFuelAtVenue();
  afterAction();
}
/* ---------- Field repair (combat only) ----------
   Full repairs are a dockside job (Ship tab). Mid-fight you can only jury-rig
   an emergency patch with materials on hand — and you hold fire to do it, so
   the foe gets a free strike. A real tactical gamble. */
const FIELD_REPAIR = { hull: 15, sub: 18, mats: { metals: 4, electronics: 3 } };
function canFieldRepair() { return Object.entries(FIELD_REPAIR.mats).every(([c, q]) => (S.res[c] || 0) >= q); }
function fieldRepairWorthwhile() { return S.pirate.hull < HULL_MAX || SUBSYS.some(k => shipCond(k) < 100); }
function fieldRepair() {
  const foe = S.encounter || S.prey;
  if (!foe) return toast("No engagement — repair fully at the 🚀 Ship tab.", "bad");
  if (!fieldRepairWorthwhile()) return toast("Hull and systems are already sound.", "bad");
  if (!canFieldRepair()) return toast(`Field patch needs ${matsString(FIELD_REPAIR.mats)}.`, "bad");
  Object.entries(FIELD_REPAIR.mats).forEach(([c, q]) => { S.res[c] -= q; });
  const before = S.pirate.hull;
  S.pirate.hull = Math.min(HULL_MAX, S.pirate.hull + FIELD_REPAIR.hull);
  const worst = SUBSYS.reduce((m, k) => (shipCond(k) < shipCond(m) ? k : m), SUBSYS[0]);
  let sysNote = "";
  if (shipCond(worst) < 100) { S.pirate.subsys[worst] = Math.min(100, S.pirate.subsys[worst] + FIELD_REPAIR.sub); sysNote = ` and shored up ${SUBSYS_META[worst].ico} ${SUBSYS_META[worst].name}`; }
  log(`🔧 Field patch: +${S.pirate.hull - before} hull${sysNote} — but you held fire, and the ${foe.name} presses the attack.`, "");
  const fs = foeStrikes(foe, S.encounter ? 0.3 : 0.28);   // you forfeited your turn — the foe strikes
  toast(`Patched +${S.pirate.hull - before + fs.dmg > 0 ? S.pirate.hull - before : 0} hull; ${foe.name} hit you for ${fs.dmg}.`, "");
  afterAction();
}
function processWanted() {
  if (!S.pirate) return;
  const P = S.pirate;
  // wanted cools when you lie low; faster out on the lawless rim
  const cool = (currentPlanet().enforce < 0.2) ? 4 : 2;
  P.wanted = Math.max(0, P.wanted - cool);
  P.dread = Math.max(0, P.dread - 1);     // a fearsome name fades if you stop raiding
  // bounty hunters come for the notorious
  if (P.wanted >= 40 && Math.random() < (P.wanted - 30) / 220) {
    const hunterStr = 18 + Math.round(P.wanted * 0.4);
    const power = raidPower() + Math.random() * 12;
    if (power > hunterStr + Math.random() * 12) {
      P.dread += 4; P.wanted = Math.max(0, P.wanted - 10); clampPirate();
      log(`🎯 A bounty hunter came for your head — you blew them out of the void. (Dread +4, Wanted −10)`, "good");
    } else {
      const dmg = takeHullDamage(hunterStr * 0.7);
      const loss = Math.min(S.res.credits, 400 + rint(0, 600));
      S.res.credits -= loss; clampPirate();
      log(`🎯 A bounty hunter ambushed you — Hull −${dmg}, ${fmt(loss)} cr in damages.`, "bad");
      toast("Bounty hunter attack!", "bad");
    }
  }
  clampPirate();
}

/* ============================================================
   STELLAR FRONTIER — mandates
   Commission a pirate band to work a system for several cycles — cull
   pirates, guard the lanes, or prey on shipping. You pay an upfront
   fee and take a cut of what they bring in over the run. The Contacts
   tab UI (renderContacts and everything else that renders the bands
   you've built history with) stays in game.js with the other render*
   functions; it had been sitting under this same banner in the
   original file, appended there over time rather than under one of
   its own.

   Loaded after frontier.js, before game.js. digestNote, saveGame and
   renderAll still live in game.js at this point in the split — safe,
   since every function here is only CALLED later, once every script
   has finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

const MANDATE_TASKS = {
  cull:    { ico: "🎯", name: "Cull pirates",     cut: 0.55, base: 180, perLvl: 110, feeMul: 1.0, scalesPirate: true,  suppress: 0.30, heat: 0,   blurb: "Drive hostile crews out — lowers the system's pirate activity; you take a cut of the bounties." },
  protect: { ico: "🛡️", name: "Guard the lanes",  cut: 0.50, base: 150, perLvl: 90,  feeMul: 0.85, scalesPirate: false, suppress: 0.22, heat: 0,   blurb: "Patrol the system — steadily suppresses pirates; a share of the escort fees." },
  raid:    { ico: "🏴", name: "Prey on shipping", cut: 0.50, base: 190, perLvl: 110, feeMul: 1.1, scalesPirate: true,  suppress: 0,    heat: 2.5, blurb: "Plunder shipping in the system — a fat cut of the loot, but it's piracy in your name: Wanted climbs and the locals seethe." },
};
const MANDATE_DURATIONS = [3, 6, 9];
const MANDATE_ACT_CAP = 1.3;   // diminishing returns: a single mandate can't milk an infested system forever
function mdPlanetName(id) { const p = PLANETS.find(x => x.id === id); return p ? p.name : "?"; }
function bandOnMandate(b) { return !!(b && b.mandate); }
function mandateFee(b, planetId, task, dur) {
  const here = currentPlanet(), dist = (here.distances && here.distances[planetId]) || 0, lvl = b.level || 1;
  let fee = (70 + lvl * 42) * dur * (1 + dist * 0.025) * ((MANDATE_TASKS[task] || MANDATE_TASKS.cull).feeMul || 1);
  fee *= (1 - Math.min(0.30, ((b.rep || 0) / 100) * 0.30));   // friendlier crews charge less
  return Math.max(150, Math.round(fee));
}
function mandateAct(planetId, t) { return t.scalesPirate ? Math.min(MANDATE_ACT_CAP, 0.45 + pirateLevel(planetId) * 0.22) : 0.9; }
function mandateCycleYield(b, planetId, task) {
  const lvl = b.level || 1, t = MANDATE_TASKS[task] || MANDATE_TASKS.cull;
  return Math.round((t.base + lvl * t.perLvl) * mandateAct(planetId, t) * (0.6 + Math.random() * 0.8));
}
function mandateEstCut(b, planetId, task, dur) {   // average expected player cut over the run (preview)
  const lvl = b.level || 1, t = MANDATE_TASKS[task] || MANDATE_TASKS.cull;
  return Math.round((t.base + lvl * t.perLvl) * mandateAct(planetId, t) * t.cut * dur);
}
function mandateEligibleBands() { return bandList().filter(b => bandWillAlly(b) && !bandOnMandate(b) && !bandBusy(b) && !bandOnCall(b) && !bandInbound(b) && b.status === "active"); }
function commissionMandate(bandId, planetId, task, dur) {
  const b = bandById(bandId); if (!b) return toast("Pick a crew.", "bad");
  if (!MANDATE_TASKS[task]) return; dur = MANDATE_DURATIONS.includes(dur) ? dur : 6;
  if (bandOnMandate(b) || bandBusy(b)) return toast(`The ${b.name} are already occupied.`, "bad");
  if (!bandWillAlly(b)) return toast(`The ${b.name} won't take your coin.`, "bad");
  if (!planetId || !PLANETS.find(p => p.id === planetId)) return toast("Pick a target system.", "bad");
  const fee = mandateFee(b, planetId, task, dur);
  if ((S.res.credits || 0) < fee) return toast(`That mandate costs ${fmt(fee)} cr.`, "bad");
  S.res.credits -= fee;
  if (!Array.isArray(S.mandates)) S.mandates = [];
  const id = "md" + S.turn + "_" + Math.floor(Math.random() * 1e4);
  S.mandates.push({ id, bandId, planet: planetId, task, cyclesLeft: dur, total: dur, fee, accrued: 0, cut: MANDATE_TASKS[task].cut });
  b.mandate = id; b.busyUntil = S.turn + dur; b.loc = planetId;
  const t = MANDATE_TASKS[task];
  log(`📜 You commissioned the ${b.ico} ${b.name} to <b>${t.name.toLowerCase()}</b> at ${mdPlanetName(planetId)} for ${dur} cycles (−${fmt(fee)} cr).`, "event");
  toast(`${b.name} on mandate (${dur} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function processMandates() {
  if (!Array.isArray(S.mandates) || !S.mandates.length) return;
  for (let i = S.mandates.length - 1; i >= 0; i--) {
    const md = S.mandates[i], b = bandById(md.bandId), t = MANDATE_TASKS[md.task];
    if (!b || !t) { S.mandates.splice(i, 1); continue; }
    md.accrued += Math.round(mandateCycleYield(b, md.planet, md.task) * md.cut);
    if (t.suppress && Math.random() < t.suppress + 0.06 * (b.level || 1)) S.pirates[md.planet] = Math.max(0, pirateLevel(md.planet) - 1);
    if (md.task === "raid") {
      const fac = (PLANETS.find(p => p.id === md.planet) || {}).faction;
      const sanctioned = fac && commissionCovers(fac);                 // a letter of marque vs this faction makes it legal
      if (!sanctioned) S.pirate.wanted = Math.min(100, (S.pirate.wanted || 0) + t.heat);
      if (fac) addRep(fac, -1);                                        // you're still hurting them either way
      clampPirate();
    }
    md.cyclesLeft--;
    if (md.cyclesLeft <= 0) {
      S.res.credits += md.accrued; bandRepAdd(b, 6); b.mandate = null; b.loc = md.planet;
      log(`📜 The ${b.ico} ${b.name} finished their ${t.name.toLowerCase()} at ${mdPlanetName(md.planet)} — your cut: <b>${fmt(md.accrued)} cr</b>.`, "good");
      if (typeof toast === "function") toast(`${b.name} mandate done: +${fmt(md.accrued)} cr`, "good");
      digestNote("arrivals", `${b.name}'s mandate complete (+${fmt(md.accrued)} cr)`);
      if (typeof sfx === "function") sfx("good");
      S.mandates.splice(i, 1);
    }
  }
}
function cancelMandate(id) {
  const i = (S.mandates || []).findIndex(m => m.id === id); if (i < 0) return;
  const md = S.mandates[i], b = bandById(md.bandId);
  S.res.credits += md.accrued;                       // keep what they've earned so far; the fee is forfeit
  if (b) { b.mandate = null; b.busyUntil = S.turn; bandRepAdd(b, -4); }
  log(`📜 You recalled the ${b ? b.name : "crew"} from their mandate early — banked ${fmt(md.accrued)} cr (fee forfeit).`, "");
  toast("Mandate ended", ""); S.mandates.splice(i, 1); saveGame(); renderAll();
}

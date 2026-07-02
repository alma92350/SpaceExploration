/* ============================================================
   STELLAR FRONTIER — colony aerial-defense minigame
   Optional arcade minigame offered when a pirate-raid roll hits a
   garrisoned colony. colonyEventRoll() (colonization.js) no longer
   resolves that roll itself — with a garrison in place it queues the
   raid onto S.colonyRaids instead, and this file offers the player a
   simplified 2D "man the guns" minigame: aim a ground turret, shoot
   raiders down before they reach the colony line. Performance feeds a
   multiplier into the same loot/happiness math the auto-roll always
   used; declining ("Auto-resolve") falls back to that exact roll. A
   colony with no garrison still just gets raided as before — there's
   nothing to man without one.

   Loaded after colonization.js, before the render slices. Only ever
   invoked from endTurn()/init() (game.js) once S.colonyRaids has
   entries, so everything it calls (showModal, log, toast, announce,
   fmt, COM, PLANETS) is already defined by the time it runs.
   ============================================================ */

"use strict";

const RAID_GAME_DURATION = 20000;      // ms the wave has to resolve
const RAID_GAME_SPAWN_EVERY = 850;     // ms between raider spawns
const RAID_GAME_WAVE_SIZE = 14;        // raiders in the wave
const RAID_GAME_FIRE_COOLDOWN = 220;   // ms between shots — timing matters, not just click speed

let _raidGame = null;   // active minigame runtime, or null when no modal is open

function maybeShowColonyRaidModal() {
  if (!S.colonyRaids || !S.colonyRaids.length) return;
  if (typeof document === "undefined" || document.getElementById("raid-defense-overlay")) return;
  const raid = S.colonyRaids[0];
  showModal("raid-defense-overlay", raidDefenseHTML(raid));
  requestAnimationFrame(() => initRaidDefenseGame(raid));
}

function raidDefenseHTML(raid) {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🚨 Raid on ${raid.name}!</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="resolveColonyRaid(null)">Auto-resolve</button>
    </div>
    <p style="opacity:.85;margin:6px 0 10px">Pirates are inbound and the garrison (${raid.def}) stands ready. Man the guns yourself for a shot at a flawless defense — or auto-resolve on the garrison's odds alone.</p>
    <canvas id="raidDefenseCanvas" width="480" height="320"
      style="width:100%;max-width:480px;display:block;margin:0 auto;background:#020617;border:1px solid var(--accent,#38bdf8);border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
    <p id="raidDefenseStatus" style="text-align:center;margin:8px 0 0;font-size:13px;opacity:.8">Move to aim, click/tap to fire. Stop the raiders before they reach the line.</p>
  `;
}

function initRaidDefenseGame(raid) {
  const canvas = document.getElementById("raidDefenseCanvas");
  if (!canvas) return;   // modal already closed before this frame ran
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const state = {
    raid, ctx, W, H,
    turretX: W / 2,
    raiders: [],          // { x, y, speed, alive, leaked }
    spawned: 0, destroyed: 0, leaked: 0, lastShot: 0,
    startedAt: performance.now(), lastSpawn: 0,
    rafId: null, ended: false,
  };
  _raidGame = state;

  const aim = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    state.turretX = Math.max(10, Math.min(W - 10, (clientX - rect.left) * (W / rect.width)));
  };
  canvas.addEventListener("mousemove", (e) => aim(e.clientX));
  canvas.addEventListener("click", (e) => { aim(e.clientX); fireRaidTurret(state); });
  canvas.addEventListener("touchmove", (e) => { if (e.touches[0]) aim(e.touches[0].clientX); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchstart", (e) => { if (e.touches[0]) { aim(e.touches[0].clientX); fireRaidTurret(state); } e.preventDefault(); }, { passive: false });

  requestAnimationFrame((t) => raidGameLoop(state, t));
}

function fireRaidTurret(state) {
  if (state.ended) return;
  const now = performance.now();
  if (now - state.lastShot < RAID_GAME_FIRE_COOLDOWN) return;   // rate-limited — aim matters, not click speed
  state.lastShot = now;
  let best = null, bestDist = 34;   // pixel tolerance — forgiving "hitscan" shot
  state.raiders.forEach(r => {
    if (!r.alive || r.leaked) return;
    const d = Math.abs(r.x - state.turretX);
    if (d < bestDist) { bestDist = d; best = r; }
  });
  if (best) { best.alive = false; state.destroyed++; }
}

function raidGameLoop(state, t) {
  if (state.ended) return;
  const canvas = document.getElementById("raidDefenseCanvas");
  if (!canvas) { endRaidDefenseGame(state, true); return; }   // modal was closed mid-game — abort, don't resolve

  if (state.spawned < RAID_GAME_WAVE_SIZE && t - state.lastSpawn > RAID_GAME_SPAWN_EVERY) {
    state.raiders.push({ x: 20 + Math.random() * (state.W - 40), y: -10, speed: 40 + Math.random() * 30, alive: true, leaked: false });
    state.spawned++; state.lastSpawn = t;
  }

  state.raiders.forEach(r => {
    if (!r.alive || r.leaked) return;
    r.y += r.speed / 60;
    if (r.y >= state.H - 24) { r.leaked = true; state.leaked++; }
  });

  drawRaidDefenseFrame(state, t);

  const allResolved = state.spawned >= RAID_GAME_WAVE_SIZE && state.raiders.every(r => !r.alive || r.leaked);
  if (t - state.startedAt >= RAID_GAME_DURATION || allResolved) { endRaidDefenseGame(state, false); return; }
  state.rafId = requestAnimationFrame((t2) => raidGameLoop(state, t2));
}

function drawRaidDefenseFrame(state, t) {
  const { ctx, W, H } = state;
  ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#38bdf8"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(0, H - 20); ctx.lineTo(W, H - 20); ctx.stroke();
  state.raiders.forEach(r => {
    if (!r.alive || r.leaked) return;
    ctx.fillStyle = "#f87171";
    ctx.beginPath(); ctx.moveTo(r.x, r.y - 8); ctx.lineTo(r.x - 7, r.y + 6); ctx.lineTo(r.x + 7, r.y + 6); ctx.closePath(); ctx.fill();
  });
  ctx.fillStyle = "#4ade80";
  ctx.fillRect(state.turretX - 10, H - 18, 20, 12);
  ctx.fillStyle = "#e2e8f0"; ctx.font = "13px sans-serif";
  ctx.fillText(`Destroyed ${state.destroyed}  Leaked ${state.leaked}  Incoming ${RAID_GAME_WAVE_SIZE - state.spawned}`, 8, 16);
  const timeLeft = Math.max(0, Math.ceil((RAID_GAME_DURATION - (t - state.startedAt)) / 1000));
  ctx.fillText(`${timeLeft}s`, W - 30, 16);
}

function endRaidDefenseGame(state, aborted) {
  state.ended = true;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  _raidGame = null;
  if (aborted) return;   // player dismissed the modal without finishing — raid stays queued
  const total = state.destroyed + state.leaked;
  const perf = total > 0 ? state.destroyed / total : 0;   // clear rate among raiders actually resolved
  resolveColonyRaid(perf);
}

/* perf: 0..1 clear rate from the minigame, or null to auto-resolve on the garrison's odds alone */
function resolveColonyRaid(perf) {
  if (typeof document !== "undefined") { const el = document.getElementById("raid-defense-overlay"); if (el) el.remove(); }
  if (!S.colonyRaids || !S.colonyRaids.length) return;
  const raid = S.colonyRaids.shift();
  const col = S.colonies[raid.pid];
  const planet = PLANETS.find(p => p.id === raid.pid);
  if (!col || !planet) { maybeShowColonyRaidModal(); return; }   // colony gone since the roll — nothing to resolve

  const name = raid.name, def = raid.def;
  if (perf === null) {
    if (Math.random() < def * 0.30) {
      col.happiness = Math.min(100, col.happiness + 4);
      log(`🛡️ ${name}'s garrison repelled a pirate raid.`, "good");
    } else {
      applyColonyRaidLoss(col, name, 1);
    }
  } else if (perf >= 0.85) {
    const bonus = Math.round(col.pop * 3);
    S.res.credits += bonus;
    col.happiness = Math.min(100, col.happiness + 6);
    log(`🛡️ You personally broke the raid on <span class="c">${name}</span> — not a single raider got through! Salvage nets +${fmt(bonus)} credits.`, "good");
    toast(`${name} defended — flawless!`, "good");
  } else if (perf >= 0.5) {
    col.happiness = Math.min(100, col.happiness + 4);
    log(`🛡️ ${name}'s garrison, with your help, repelled the pirate raid.`, "good");
    toast(`${name} defended!`, "good");
  } else if (perf >= 0.2) {
    applyColonyRaidLoss(col, name, 0.5);   // thinned the wave but some got through — half losses
  } else {
    applyColonyRaidLoss(col, name, 1);
  }
  afterAction();
  maybeShowColonyRaidModal();   // chain to the next pending raid, if another colony was also hit this cycle
}

function applyColonyRaidLoss(col, name, mult) {
  let lootLog = [];
  Object.keys(col.storage).forEach(c => {
    const take = Math.floor((col.storage[c] || 0) * 0.25 * mult);
    if (take > 0) { col.storage[c] -= take; lootLog.push(`${take} ${COM[c].ico}`); }
  });
  const credLoss = Math.min(S.res.credits, Math.round(col.pop * 8 * mult));
  S.res.credits -= credLoss;
  col.happiness = Math.max(0, col.happiness - Math.round(12 * mult));
  log(`🏴‍☠️ Pirates raided <span class="c">${name}</span>! Lost ${lootLog.join(" ") || "no goods"} and ${fmt(credLoss)} credits.`, "bad");
  toast(`${name} raided!`, "bad");
  announce(`🏴‍☠️ ${name} Raided`, `Pirates struck your colony. Build a 🛡️ Garrison to defend it.`, true);
}

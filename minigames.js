/* ============================================================
   STELLAR FRONTIER — optional arcade minigames
   Three self-contained canvas minigames, each an OPTIONAL alternative
   to an existing auto-resolved mechanic: playing well earns a better
   outcome than the numbers alone would give you; declining (or just
   never clicking the button) falls back to the exact original math,
   unchanged. None of them replace anything — they read a live target
   (S.colonyRaids / S.prey|S.encounter / the active escort wave) and
   feed a performance number into that system's existing formulas via
   a one-round multiplier the target file already exposes
   (_dogfightMult in combat.js, _escortMult in escort.js).

   1) Colony aerial defense — queued by colonyEventRoll() (colonization.js)
      when a pirate-raid roll hits a garrisoned colony; a 1D turret shooter.
   2) Raid dogfight — triggered from the 🕹️ Dogfight button in tacticalHTML()
      (renderCombat.js) on a raid (S.prey) or travel-ambush (S.encounter)
      card; free 2D movement, dodge + return fire.
   3) Escort intercept — triggered from the 🕹️ Man the Guns button in the
      escort Fire Control card (renderSettlement.js); one telegraphed blip
      per living attacker in the current wave, reusing their real intent.

   Loaded after colonization.js, before the render slices. Only ever
   invoked from player actions or endTurn()/init() (game.js), so every
   game function/global these call (showModal, log, toast, announce,
   fmt, COM, PLANETS, WEAPONS, S.prey/S.encounter, escort.js's e.wave,
   raidAttack/encounterFight/escortFire) is already defined and live by
   the time any of this runs.
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

/* ------------------------------------------------------------
   RAID DOGFIGHT — one manually-played round of an active raid
   (S.prey) or travel ambush (S.encounter). Free 2D movement: fly to
   dodge the foe's telegraphed shot, click/tap near it to land yours.
   Ends after a fixed number of exchanges; the result becomes a one-
   round { dmg, dodge } multiplier (_dogfightMult, combat.js) applied
   to the single raidAttack()/encounterFight() call that follows.
   ------------------------------------------------------------ */
const DOGFIGHT_DURATION = 15000;        // ms safety cap
const DOGFIGHT_VOLLEY_EVERY = 1400;     // ms between the foe's telegraphed attacks
const DOGFIGHT_TELEGRAPH_MS = 650;      // wind-up time on the foe's reticle before it resolves
const DOGFIGHT_VOLLEYS_TARGET = 8;      // foe attack opportunities that end the round
const DOGFIGHT_TARGET_HITS = 6;         // player hits landed for a full damage bonus
const DOGFIGHT_FIRE_COOLDOWN = 260;     // ms between shots
const DOGFIGHT_HIT_RADIUS = 30;         // px tolerance for a player shot to land
const DOGFIGHT_DODGE_RADIUS = 34;       // px — how close the player must be to the reticle to get hit

let _dogfight = null;

function startRaidDogfight(attackFn, wkey) {
  const t = S.prey || S.encounter;
  if (!t) return;
  if (!wkey || !WEAPONS[wkey] || !weaponAffordable(wkey)) wkey = "kinetic";
  if (document.getElementById("dogfight-overlay")) return;
  showModal("dogfight-overlay", dogfightHTML(t, wkey));
  requestAnimationFrame(() => initDogfight(attackFn, wkey));
}

function dogfightHTML(t, wkey) {
  const W = WEAPONS[wkey];
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🕹️ Dogfight — ${t.name}</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="cancelDogfight()">✕ Cancel</button>
    </div>
    <p style="opacity:.85;margin:6px 0 10px">Move to fly, click/tap to fire ${W.ico} ${W.name}. Land hits on the ${t.ico} for bonus damage; dodge its pulsing red reticle to blunt its return fire. Resolves as one attack when the exchange ends.</p>
    <canvas id="dogfightCanvas" width="480" height="320"
      style="width:100%;max-width:480px;display:block;margin:0 auto;background:#020617;border:1px solid var(--accent,#38bdf8);border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
    <p id="dogfightStatus" style="text-align:center;margin:8px 0 0;font-size:13px;opacity:.8">Cancel any time to skip it — no bonus, no penalty, nothing fired yet.</p>
  `;
}

function initDogfight(attackFn, wkey) {
  const canvas = document.getElementById("dogfightCanvas");
  if (!canvas) return;   // modal already closed before this frame ran
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const state = {
    attackFn, wkey, ctx, W, H,
    playerX: W / 2, playerY: H - 40,
    enemyX: W / 2, enemyY: 60, enemyVX: 60, enemyVY: 40,
    hitsLanded: 0, hitsTaken: 0, volleys: 0, lastShot: 0,
    telegraph: null,   // { x, y, resolveAt } while the foe is winding up a shot
    nextVolleyAt: performance.now() + DOGFIGHT_VOLLEY_EVERY,
    startedAt: performance.now(),
    rafId: null, ended: false,
  };
  _dogfight = state;

  const aim = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    state.playerX = Math.max(10, Math.min(W - 10, (clientX - rect.left) * (W / rect.width)));
    state.playerY = Math.max(10, Math.min(H - 10, (clientY - rect.top) * (H / rect.height)));
  };
  canvas.addEventListener("mousemove", (e) => aim(e.clientX, e.clientY));
  canvas.addEventListener("click", (e) => { aim(e.clientX, e.clientY); fireDogfight(state); });
  canvas.addEventListener("touchmove", (e) => { if (e.touches[0]) aim(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });
  canvas.addEventListener("touchstart", (e) => { if (e.touches[0]) { aim(e.touches[0].clientX, e.touches[0].clientY); fireDogfight(state); } e.preventDefault(); }, { passive: false });

  requestAnimationFrame((t) => dogfightLoop(state, t));
}

function fireDogfight(state) {
  if (state.ended) return;
  const now = performance.now();
  if (now - state.lastShot < DOGFIGHT_FIRE_COOLDOWN) return;
  state.lastShot = now;
  const d = Math.hypot(state.playerX - state.enemyX, state.playerY - state.enemyY);
  if (d < DOGFIGHT_HIT_RADIUS) state.hitsLanded++;
}

function dogfightLoop(state, t) {
  if (state.ended) return;
  const canvas = document.getElementById("dogfightCanvas");
  if (!canvas) { endDogfight(state, true); return; }   // modal was closed mid-play — abort, no strike fired

  const dt = 1 / 60;
  state.enemyX += state.enemyVX * dt; state.enemyY += state.enemyVY * dt;
  if (state.enemyX < 20 || state.enemyX > state.W - 20) state.enemyVX *= -1;
  if (state.enemyY < 20 || state.enemyY > state.H * 0.6) state.enemyVY *= -1;

  if (!state.telegraph && t >= state.nextVolleyAt && state.volleys < DOGFIGHT_VOLLEYS_TARGET) {
    state.telegraph = { x: state.playerX, y: state.playerY, resolveAt: t + DOGFIGHT_TELEGRAPH_MS };
  }
  if (state.telegraph && t >= state.telegraph.resolveAt) {
    const d = Math.hypot(state.playerX - state.telegraph.x, state.playerY - state.telegraph.y);
    if (d < DOGFIGHT_DODGE_RADIUS) state.hitsTaken++;
    state.volleys++;
    state.telegraph = null;
    state.nextVolleyAt = t + DOGFIGHT_VOLLEY_EVERY;
  }

  drawDogfightFrame(state, t);

  const done = state.volleys >= DOGFIGHT_VOLLEYS_TARGET && !state.telegraph;
  if (t - state.startedAt >= DOGFIGHT_DURATION || done) { endDogfight(state, false); return; }
  state.rafId = requestAnimationFrame((t2) => dogfightLoop(state, t2));
}

function drawDogfightFrame(state, t) {
  const { ctx, W, H } = state;
  ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
  if (state.telegraph) {
    const frac = Math.min(1, Math.max(0, (t - (state.telegraph.resolveAt - DOGFIGHT_TELEGRAPH_MS)) / DOGFIGHT_TELEGRAPH_MS));
    const r = 26 - frac * 14;   // shrinks in as the shot is about to land
    ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(state.telegraph.x, state.telegraph.y, Math.max(4, r), 0, Math.PI * 2); ctx.stroke();
  }
  ctx.fillStyle = "#f87171";
  ctx.beginPath(); ctx.moveTo(state.enemyX, state.enemyY + 9); ctx.lineTo(state.enemyX - 8, state.enemyY - 7); ctx.lineTo(state.enemyX + 8, state.enemyY - 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#4ade80";
  ctx.beginPath(); ctx.moveTo(state.playerX, state.playerY - 9); ctx.lineTo(state.playerX - 8, state.playerY + 7); ctx.lineTo(state.playerX + 8, state.playerY + 7); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#e2e8f0"; ctx.font = "13px sans-serif";
  ctx.fillText(`Hits ${state.hitsLanded}  Taken ${state.hitsTaken}  Volley ${state.volleys}/${DOGFIGHT_VOLLEYS_TARGET}`, 8, 16);
  const timeLeft = Math.max(0, Math.ceil((DOGFIGHT_DURATION - (t - state.startedAt)) / 1000));
  ctx.fillText(`${timeLeft}s`, W - 30, 16);
}

function endDogfight(state, aborted) {
  state.ended = true;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  _dogfight = null;
  const overlay = document.getElementById("dogfight-overlay");
  if (overlay) overlay.remove();
  if (aborted) return;   // Cancel or the modal was closed mid-play — no strike, no bonus, no penalty
  const dmgPerf = Math.min(1, state.hitsLanded / DOGFIGHT_TARGET_HITS);
  const dodgePerf = state.volleys > 0 ? Math.max(0, 1 - state.hitsTaken / state.volleys) : 1;
  _dogfightMult = { dmg: 0.7 + 0.8 * dmgPerf, dodge: 1 - 0.5 * dodgePerf };
  if (state.attackFn === "encounterFight") encounterFight(state.wkey); else raidAttack(state.wkey);
  _dogfightMult = null;
}

function cancelDogfight() {
  if (_dogfight) { endDogfight(_dogfight, true); return; }
  const overlay = document.getElementById("dogfight-overlay");
  if (overlay) overlay.remove();
}

/* ------------------------------------------------------------
   ESCORT INTERCEPT — one manually-played salvo round of the active
   escort wave (S.escort.wave). One telegraphed blip per LIVING
   attacker, reusing the wave's real per-foe role/intent; tap each
   before its ring closes. Result becomes a one-round { off, def }
   multiplier (_escortMult, escort.js) applied to the single
   escortFire() call that follows (which itself resolves the enemy
   turn), so it's the same shape as the raid dogfight above.
   ------------------------------------------------------------ */
const ESCORT_GAME_TELEGRAPH_MS = 1800;   // time a blip's ring takes to close
const ESCORT_GAME_STAGGER_MS = 400;      // gap between successive blips appearing
const ESCORT_GAME_DURATION = 16000;      // ms safety cap
const ESCORT_GAME_HIT_RADIUS = 30;       // px tolerance for a tap to land

let _escortGame = null;

function startEscortIntercept() {
  const e = ensureEscort();
  if (!e.wave || e.pendingRedeploy) return;
  const foes = escortAliveFoes();
  if (!foes.length) return;
  if (document.getElementById("escort-intercept-overlay")) return;
  showModal("escort-intercept-overlay", escortInterceptHTML(foes));
  requestAnimationFrame(() => initEscortIntercept(foes.length));
}

function escortInterceptHTML(foes) {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🕹️ Man the Guns — ${foes.length} contact${foes.length > 1 ? "s" : ""}</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="cancelEscortIntercept()">✕ Cancel</button>
    </div>
    <p style="opacity:.85;margin:6px 0 10px">One blip per attacker — tap it before its ring closes. A clean round boosts this salvo's firepower and blunts the return fire; resolves the same as clicking 🔥 Open Fire.</p>
    <canvas id="escortInterceptCanvas" width="480" height="320"
      style="width:100%;max-width:480px;display:block;margin:0 auto;background:#020617;border:1px solid var(--accent,#38bdf8);border-radius:8px;cursor:crosshair;touch-action:none"></canvas>
    <p id="escortInterceptStatus" style="text-align:center;margin:8px 0 0;font-size:13px;opacity:.8">Cancel any time to skip it — no bonus, no penalty, nothing fired yet.</p>
  `;
}

function initEscortIntercept(n) {
  const canvas = document.getElementById("escortInterceptCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const W = canvas.width, H = canvas.height;
  const now = performance.now();
  const blips = [];
  for (let i = 0; i < n; i++) {
    const appearAt = now + i * ESCORT_GAME_STAGGER_MS;
    blips.push({
      x: 40 + Math.random() * (W - 80), y: 40 + Math.random() * (H - 80),
      appearAt, resolveAt: appearAt + ESCORT_GAME_TELEGRAPH_MS,
      resolved: false, hit: false,
    });
  }
  const state = { ctx, W, H, blips, hits: 0, resolved: 0, startedAt: now, rafId: null, ended: false };
  _escortGame = state;

  const tap = (clientX, clientY) => {
    const rect = canvas.getBoundingClientRect();
    const x = (clientX - rect.left) * (W / rect.width), y = (clientY - rect.top) * (H / rect.height);
    let best = null, bestDist = ESCORT_GAME_HIT_RADIUS;
    state.blips.forEach(b => {
      if (b.resolved) return;
      const d = Math.hypot(x - b.x, y - b.y);
      if (d < bestDist) { bestDist = d; best = b; }
    });
    if (best) { best.resolved = true; best.hit = true; state.hits++; state.resolved++; }
  };
  canvas.addEventListener("click", (e) => tap(e.clientX, e.clientY));
  canvas.addEventListener("touchstart", (e) => { if (e.touches[0]) tap(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }, { passive: false });

  requestAnimationFrame((t) => escortInterceptLoop(state, t));
}

function escortInterceptLoop(state, t) {
  if (state.ended) return;
  const canvas = document.getElementById("escortInterceptCanvas");
  if (!canvas) { endEscortIntercept(state, true); return; }   // modal was closed mid-play — abort, no salvo fired

  state.blips.forEach(b => {
    if (b.resolved || t < b.appearAt) return;
    if (t >= b.resolveAt) { b.resolved = true; state.resolved++; }   // missed — its ring closed
  });

  drawEscortInterceptFrame(state, t);

  const allResolved = state.blips.every(b => b.resolved);
  if (t - state.startedAt >= ESCORT_GAME_DURATION || allResolved) { endEscortIntercept(state, false); return; }
  state.rafId = requestAnimationFrame((t2) => escortInterceptLoop(state, t2));
}

function drawEscortInterceptFrame(state, t) {
  const { ctx, W, H } = state;
  ctx.fillStyle = "#020617"; ctx.fillRect(0, 0, W, H);
  state.blips.forEach(b => {
    if (b.resolved || t < b.appearAt) return;
    const frac = Math.min(1, Math.max(0, (t - b.appearAt) / ESCORT_GAME_TELEGRAPH_MS));
    const r = 22 - frac * 14;
    ctx.strokeStyle = "#f87171"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(b.x, b.y, Math.max(4, r), 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "#facc15";
    ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "#e2e8f0"; ctx.font = "13px sans-serif";
  ctx.fillText(`Intercepted ${state.hits}/${state.blips.length}`, 8, 16);
  const timeLeft = Math.max(0, Math.ceil((ESCORT_GAME_DURATION - (t - state.startedAt)) / 1000));
  ctx.fillText(`${timeLeft}s`, W - 30, 16);
}

function endEscortIntercept(state, aborted) {
  state.ended = true;
  if (state.rafId) cancelAnimationFrame(state.rafId);
  _escortGame = null;
  const overlay = document.getElementById("escort-intercept-overlay");
  if (overlay) overlay.remove();
  if (aborted) return;   // Cancel or the modal was closed mid-play — no salvo, no bonus, no penalty
  const perf = state.blips.length > 0 ? state.hits / state.blips.length : 0;
  _escortMult = { off: 0.7 + 0.8 * perf, def: 1 - 0.5 * perf };
  escortFire();
  _escortMult = null;
}

function cancelEscortIntercept() {
  if (_escortGame) { endEscortIntercept(_escortGame, true); return; }
  const overlay = document.getElementById("escort-intercept-overlay");
  if (overlay) overlay.remove();
}

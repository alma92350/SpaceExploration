/* ============================================================
   STELLAR FRONTIER — player feedback
   Everything that tells the player something just happened: the ship log
   and captain's journal (log/jot), procedural sound effects synthesized
   from oscillators/noise via the Web Audio API (no asset files, fully
   headless-safe — no-ops where AudioContext is unavailable, e.g. tests),
   toast notifications, and the fireworks canvas + announcement banner used
   for legacy objectives.

   Loaded after pricing.js, before game.js. renderLog() and saveGame() still
   live in game.js at this point in the split — safe, since they're only
   CALLED later, once every script has finished loading, same pattern as
   every prior slice.
   ============================================================ */

"use strict";

/* ---------- Log & toast ---------- */
function log(msg, type = "") {
  S.log.unshift({ msg, type, turn: S.turn });
  if (S.log.length > 80) S.log.pop();
  if (type === "event") jot(msg);            // notable happenings flow into the captain's log
  renderLog();
}
/* ---- Captain's Log ("journal de bord") ----
   A persistent, plain-text chronicle of the playthrough, downloadable as a
   Markdown dossier rich enough for an LLM to write a biography or novel from. */
function jot(msg, cat) {
  if (!S.journal) S.journal = [];
  const text = String(msg).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!text) return;
  const last = S.journal[S.journal.length - 1];
  if (last && last.turn === S.turn && last.text === text) return;   // de-dupe
  S.journal.push({ turn: S.turn, cat: cat || "", text });
  if (S.journal.length > 2000) S.journal.shift();
}

/* ---------- Sound — procedural SFX via the Web Audio API. No asset files:
   every sound is synthesized from oscillators/noise, gated behind a mute
   toggle. Fully headless-safe (no-ops where AudioContext is unavailable,
   e.g. tests). ---------- */
let _audio = null, _lastSfx = 0;
function soundOn() { return !(typeof S !== "undefined" && S && S.sound === false); }   // default on
function audioCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!_audio) { try { _audio = new AC(); } catch (e) { return null; } }
  return _audio;
}
function _tone(ac, t0, o) {
  const osc = ac.createOscillator(), g = ac.createGain();
  osc.type = o.type || "sine";
  osc.frequency.setValueAtTime(o.f0, t0);
  if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + o.dur);
  const vol = o.gain == null ? 0.2 : o.gain;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t0); osc.stop(t0 + o.dur + 0.02);
}
function _noise(ac, t0, dur, gain) {
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2);
  const src = ac.createBufferSource(); src.buffer = buf;
  const g = ac.createGain(); g.gain.value = gain == null ? 0.25 : gain;
  src.connect(g).connect(ac.destination); src.start(t0);
}
function sfx(name) {
  if (!soundOn()) return;
  const ac = audioCtx(); if (!ac) return;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - _lastSfx < 45) return;             // debounce bursts so events don't pile into noise
  _lastSfx = now;
  try {
    if (ac.state === "suspended") ac.resume();
    const t = ac.currentTime;
    switch (name) {
      case "good":    _tone(ac, t, { type: "triangle", f0: 660, f1: 990, dur: 0.12, gain: 0.18 }); break;
      case "event":   _tone(ac, t, { type: "sine", f0: 880, dur: 0.12, gain: 0.16 }); break;
      case "bad":     _tone(ac, t, { type: "sawtooth", f0: 200, f1: 90, dur: 0.22, gain: 0.18 }); break;
      case "buy":     _tone(ac, t, { type: "square", f0: 520, dur: 0.05, gain: 0.12 }); _tone(ac, t + 0.06, { type: "square", f0: 780, dur: 0.07, gain: 0.12 }); break;
      case "sell":    _tone(ac, t, { type: "square", f0: 780, dur: 0.05, gain: 0.12 }); _tone(ac, t + 0.06, { type: "square", f0: 1040, dur: 0.07, gain: 0.12 }); break;
      case "fire":    _tone(ac, t, { type: "sawtooth", f0: 900, f1: 180, dur: 0.14, gain: 0.15 }); break;
      case "explode": _noise(ac, t, 0.35, 0.30); _tone(ac, t, { type: "sawtooth", f0: 160, f1: 50, dur: 0.35, gain: 0.16 }); break;
      case "travel":  _tone(ac, t, { type: "sine", f0: 220, f1: 660, dur: 0.4, gain: 0.14 }); break;
      case "repair":  _tone(ac, t, { type: "square", f0: 300, dur: 0.04, gain: 0.1 }); _tone(ac, t + 0.07, { type: "square", f0: 300, dur: 0.04, gain: 0.1 }); _tone(ac, t + 0.14, { type: "square", f0: 380, dur: 0.06, gain: 0.1 }); break;
      case "win":     [523, 659, 784, 1047].forEach((f, i) => _tone(ac, t + i * 0.1, { type: "triangle", f0: f, dur: 0.18, gain: 0.18 })); break;
      case "alarm":   _tone(ac, t, { type: "square", f0: 740, f1: 520, dur: 0.16, gain: 0.16 }); _tone(ac, t + 0.18, { type: "square", f0: 740, f1: 520, dur: 0.16, gain: 0.16 }); break;
      case "salvo":   _tone(ac, t, { type: "sawtooth", f0: 1000, f1: 160, dur: 0.18, gain: 0.16 }); _noise(ac, t, 0.18, 0.12); break;
      case "promote": [523, 784, 1047, 1319].forEach((f, i) => _tone(ac, t + i * 0.08, { type: "triangle", f0: f, dur: 0.14, gain: 0.17 })); break;
      case "click":   _tone(ac, t, { type: "square", f0: 440, dur: 0.03, gain: 0.08 }); break;
      default:        _tone(ac, t, { type: "sine", f0: 660, dur: 0.08, gain: 0.12 });
    }
  } catch (e) {}
}
function soundLabel() { return (typeof S !== "undefined" && S && S.sound === false) ? "🔇 Sound" : "🔊 Sound"; }
function toggleSound() {
  S.sound = S.sound === false ? true : false;
  if (S.sound) { _lastSfx = 0; sfx("event"); }
  const btn = typeof document !== "undefined" && document.getElementById("soundToggleBtn");
  if (btn) btn.textContent = soundLabel();
  if (typeof toast === "function") toast(S.sound ? "🔊 Sound on" : "🔇 Sound off", "");
  if (typeof saveGame === "function") saveGame();
}
function einkLabel() { return (typeof S !== "undefined" && S && S.eink) ? "🌙 Color mode" : "📖 E-ink mode"; }
function applyEink() {
  if (typeof document === "undefined" || !document.body) return;
  document.body.classList.toggle("eink", !!(typeof S !== "undefined" && S && S.eink));
}
function toggleEink() {
  S.eink = !S.eink;
  applyEink();
  const btn = typeof document !== "undefined" && document.getElementById("einkToggleBtn");
  if (btn) btn.textContent = einkLabel();
  if (typeof toast === "function") toast(S.eink ? "📖 E-ink mode — high contrast for e-readers" : "🌙 Color mode", "");
  if (typeof saveGame === "function") saveGame();
}
function toast(msg, type = "") {
  if (type === "good") sfx("good"); else if (type === "bad") sfx("bad"); else if (type === "event") sfx("event");
  if (typeof document === "undefined") return;
  const c = document.getElementById("toast-container");
  if (!c) return;
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .4s"; }, 2200);
  setTimeout(() => el.remove(), 2700);
}

/* ---------- Celebrations — fireworks canvas + announcement banner ---------- */
let _fxCanvas, _fxCtx, _fxParticles = [], _fxRAF = null, _fxUntil = 0, _fxLastLaunch = 0, _fxBigMode = false;
function _fxResize() { _fxCanvas.width = window.innerWidth; _fxCanvas.height = window.innerHeight; }
function _fxBurst(x, y, count, hue, big) {
  for (let i = 0; i < count; i++) {
    const ang = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const spd = (big ? 4 : 2.6) + Math.random() * (big ? 5.5 : 3);
    _fxParticles.push({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd,
      life: 1, decay: 0.008 + Math.random() * 0.013, hue: hue + (Math.random() * 40 - 20),
      size: big ? 2.4 + Math.random() * 2 : 1.6 + Math.random() * 1.4 });
  }
}
function fireworks(duration = 2500, big = false) {
  if (typeof document === "undefined") return;
  if (!_fxCanvas) {
    _fxCanvas = document.getElementById("fx");
    if (!_fxCanvas || !_fxCanvas.getContext) return;
    _fxCtx = _fxCanvas.getContext("2d");
    window.addEventListener("resize", _fxResize);
  }
  _fxResize();
  _fxUntil = Math.max(_fxUntil, performance.now() + duration);
  _fxBigMode = big || _fxBigMode;
  if (_fxRAF) return;
  const tick = (t) => {
    const ctx = _fxCtx, W = _fxCanvas.width, H = _fxCanvas.height;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "rgba(5,7,15,0.18)"; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = "lighter";
    const big = _fxBigMode;
    if (t < _fxUntil && t - _fxLastLaunch > (big ? 200 : 340)) {
      _fxLastLaunch = t;
      const shells = big ? 2 + Math.floor(Math.random() * 2) : 1;
      for (let k = 0; k < shells; k++)
        _fxBurst(W * (0.18 + Math.random() * 0.64), H * (0.18 + Math.random() * 0.42),
          big ? 60 + Math.floor(Math.random() * 40) : 42, Math.random() * 360, big);
    }
    for (let i = _fxParticles.length - 1; i >= 0; i--) {
      const p = _fxParticles[i];
      p.vy += 0.05; p.vx *= 0.99; p.vy *= 0.99; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) { _fxParticles.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.fillStyle = `hsla(${p.hue},100%,${55 + p.life * 25}%,${p.life})`;
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
    }
    if (t < _fxUntil || _fxParticles.length) _fxRAF = requestAnimationFrame(tick);
    else { _fxCtx.clearRect(0, 0, W, H); _fxRAF = null; _fxBigMode = false; }
  };
  _fxRAF = requestAnimationFrame(tick);
}
function announce(title, sub, finale = false) {
  sfx("win");
  if (typeof document === "undefined") return;
  const el = document.getElementById("announce");
  if (!el) return;
  el.innerHTML = `<div class="ann-kicker">${finale ? "Legacy Complete" : "Objective Reached"}</div>`
    + `<div class="ann-title">${title}</div><div class="ann-sub">${sub}</div>`;
  el.classList.remove("hidden", "finale");
  if (finale) el.classList.add("finale");
  el.style.animation = "none"; void el.offsetWidth; el.style.animation = "";
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), finale ? 7000 : 3400);
}

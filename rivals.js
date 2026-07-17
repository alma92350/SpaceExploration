/* ============================================================
   STELLAR FRONTIER — rival captains
   Opt-in (Custom Start) AI captains who pursue their own agenda on the
   same clock as the player: they trade (visibly moving the shared
   market), lobby their patron faction against the player, race for a
   couple of unclaimed colonizable worlds each, and — once hostile
   enough and the player is Wanted — hunt the player down on the jump
   lanes. 2-4 of them enter the sector staggered, at cycle 50/100/150
   and 200. No literal fleets or full colony simulation: strength and
   wealth are abstract scalars fed straight into the same foe/price
   generators everything else already uses, so the footprint on the
   rest of the game stays small.

   Deliberately does NOT insert rival-claimed worlds into S.colonies —
   that map's per-cycle simulation (processColonies, colonization.js)
   already assumes every entry is the PLAYER's (tax income, spaceport
   exports and raid losses all post straight to S.res.credits) with no
   owner concept anywhere. A rival "claim" instead lives in its own
   S.rivalClaims map: enough to block the player from settling that
   world and to show up on the map/Contacts, without dragging a rival
   through economic machinery that was never written to be owner-aware.

   Loaded after outlaw.js, before politics.js. isVisible, PLANETS, COM,
   COM_IDS, FACTIONS, FACTION_KEYS, factionsAreRivals, addRep,
   applyMarketMove, tradeSlippage, genFoeProfile, applyShipClass,
   rollShipClass, foeStrengthMult, SHIP_CLASSES, bandTier, pick, rint,
   log, toast, announce, unlock, setTab, currentPlanet and fmt all
   still live in earlier files at this point in the split — safe,
   since every function here is only CALLED later (from endTurn(),
   travel(), or a render pass), once every script has finished loading,
   same forward-reference pattern the rest of this codebase already uses.
   ============================================================ */

"use strict";

const RIVAL_NAMES = ["Aurelia Vane", "Bastian Kroll", "Nadia Solren", "Marcus Thane", "Yeva Ostrow",
  "Cassian Delvers", "Priya Achara", "Otto Renn", "Selene Marchetti", "Idris Kovan"];
const RIVAL_ARCHETYPES = {
  trader:    { name: "Trade Baron",         ico: "💰", tradeW: 3, lobbyW: 1, colonizeW: 1, powerW: 1, colonyCap: 1 },
  warlord:   { name: "Warlord",             ico: "☠️", tradeW: 1, lobbyW: 1, colonizeW: 1, powerW: 3, colonyCap: 1 },
  political: { name: "Political Operator",  ico: "🕴️", tradeW: 1, lobbyW: 3, colonizeW: 1, powerW: 1, colonyCap: 1 },
  colonizer: { name: "Colonizer",           ico: "🌍", tradeW: 1, lobbyW: 1, colonizeW: 3, powerW: 1, colonyCap: 2 },
};
const RIVAL_SPAWN_TURNS = [50, 100, 150, 200];
const RIVAL_ACT_CHANCE = 0.35;          // a rival acts roughly one cycle in three — keeps the pace sane
const RIVAL_PURSUIT_WANTED_MIN = 35;    // below this, no rival bothers hunting you
const RIVAL_PURSUIT_HOSTILITY_MIN = 25; // a rival needs a real grudge before it comes looking

function ensureRivals() { if (!Array.isArray(S.rivals)) S.rivals = []; return S.rivals; }
function rivalList() { return ensureRivals().filter(r => r.status === "active"); }
function rivalById(id) { return ensureRivals().find(r => r.id === id) || null; }
function rivalLocName(r) { const p = PLANETS.find(x => x.id === r.loc); return p ? p.name : "parts unknown"; }

function spawnRival(archetype) {
  ensureRivals();
  const arc = RIVAL_ARCHETYPES[archetype] || RIVAL_ARCHETYPES.trader;
  const used = new Set(S.rivals.map(r => r.name));
  const name = RIVAL_NAMES.filter(n => !used.has(n))[0] || `Captain ${S.rivals.length + 1}`;
  const homeworlds = PLANETS.filter(p => isVisible(p) && !p.colonizable && p.faction);
  const home = homeworlds.length ? pick(homeworlds).id : S.location;
  const patron = (PLANETS.find(p => p.id === home) || {}).faction || pick(Object.keys(FACTIONS));
  const r = {
    id: `riv${S.turn || 0}_${S.rivals.length}_${Math.floor(Math.random() * 1000)}`,
    name, ico: arc.ico, archetype, patron, home,
    credits: rint(4000, 9000), strength: rint(14, 22),
    colonies: [], colonyCap: arc.colonyCap,
    hostility: 0, rep: 0, loc: home, lastSeen: S.turn || 0, spawnTurn: S.turn || 0,
    status: "active",
  };
  S.rivals.push(r);
  log(`🎭 A rival captain enters the sector: <span class="c">${r.ico} ${r.name}</span> (${arc.name}), flying under the ${FACTIONS[patron].ico} ${FACTIONS[patron].name}'s colors.`, "event");
  toast(`New rival captain: ${r.name}`, "event");
  return r;
}

function maybeSpawnRivals() {
  if (!S.rivalsEnabled) return;
  ensureRivals();
  if (!RIVAL_SPAWN_TURNS.includes(S.turn)) return;
  if (S.rivals.length >= (S.rivalCountTarget || 0)) return;
  spawnRival(pick(Object.keys(RIVAL_ARCHETYPES)));
}

/* ---------- Market impact ----------
   Arbitrage against the commodity's static baseline (COM[c].base) rather
   than the player's own buyPrice/sellPrice — a rival must NOT inherit the
   player's personal reputation discount or Trade Computer spread. Moves
   the shared S.prices[pid][c] via the same actor-agnostic applyMarketMove
   every other trade in the game already uses. */
function rivalTradeTurn(r) {
  const worlds = PLANETS.filter(p => isVisible(p) && S.prices[p.id]);
  if (!worlds.length) return;
  const p = pick(worlds);
  const pool = COM_IDS.filter(c => !COM[c].isFuel && S.prices[p.id][c] != null);
  if (!pool.length) return;
  const c = pick(pool);
  const price = S.prices[p.id][c], base = COM[c].base;
  const isBuy = price <= base * 0.95, isSell = price >= base * 1.05;
  if (!isBuy && !isSell) return;   // priced near baseline — no edge worth taking this cycle
  const qty = Math.max(4, Math.round(6 + (r.credits || 4000) / 900));
  const slip = Math.min(0.4, tradeSlippage(p, c, qty));
  applyMarketMove(p.id, c, slip, isSell);
  r.credits = Math.max(500, (r.credits || 4000) + Math.round(price * qty * 0.05));
  r.loc = p.id; r.lastSeen = S.turn || 0;
  if (Math.random() < 0.2) {
    log(`💰 Rival Captain <span class="c">${r.name}</span> has been ${isBuy ? "buying up" : "dumping"} ${COM[c].ico} ${COM[c].name} at ${p.name} — the local price is moving.`, "");
    toast(`${r.name} trades at ${p.name}`, "");
  }
}

/* ---------- Political interference ----------
   Works against a faction that opposes the rival's own patron — souring
   the PLAYER's standing there, on the patron's behalf. Reuses addRep and
   the existing FACTION_RIVAL/factionsAreRivals table (sector4x.js) rather
   than inventing a new relations mechanic. */
function rivalPoliticalTurn(r) {
  const opposed = FACTION_KEYS.filter(f => f !== r.patron && factionsAreRivals(r.patron, f));
  if (!opposed.length) return;
  const target = pick(opposed);
  const delta = -(2 + Math.floor(Math.random() * 3));   // -2..-4, in line with routine rep hits elsewhere
  addRep(target, delta);
  r.lastSeen = S.turn || 0;
  if (Math.random() < 0.5) {
    log(`🕴️ Rival Captain <span class="c">${r.name}</span> has been lobbying the ${FACTIONS[target].ico} ${FACTIONS[target].name} against you, on behalf of the ${FACTIONS[r.patron].name}. (${FACTIONS[target].name} rep ${delta})`, "bad");
    toast(`${r.name} works against you with the ${FACTIONS[target].name}`, "bad");
  }
}

/* ---------- Colonization, capped ----------
   Claims live in S.rivalClaims (pid -> {rivalId, since}), NOT S.colonies —
   see the file header for why. colonize() (colonization.js) checks this
   map too, so player and rival genuinely race for the same limited
   worlds. Only ever targets worlds the player could see for themselves
   (isVisible) — a rival never claims a world before the player's own
   charts could show it. */
function rivalColonizeTurn(r) {
  if ((r.colonies || []).length >= (r.colonyCap || 1)) return;
  if (!S.rivalClaims) S.rivalClaims = {};
  const targets = PLANETS.filter(p => p.colonizable && isVisible(p) && !S.colonies[p.id] && !S.rivalClaims[p.id]);
  if (!targets.length) return;
  if (Math.random() >= 0.12) return;   // not too aggressive — most eligible cycles still pass quietly
  const p = pick(targets);
  S.rivalClaims[p.id] = { rivalId: r.id, since: S.turn || 0 };
  r.colonies = r.colonies || []; r.colonies.push(p.id);
  r.loc = p.id; r.lastSeen = S.turn || 0;
  log(`🌍 Rival Captain <span class="c">${r.name}</span> has founded a colony at <span class="c">${p.name}</span> — you'll need to look elsewhere to settle it.`, "bad");
  toast(`${r.name} colonizes ${p.name}!`, "bad");
  if (typeof announce === "function") announce("🌍 World Claimed", `${r.name} has founded a rival colony at ${p.name}.`, false);
}

function rivalGrowPower(r) {
  r.strength = Math.min(120, Math.round((r.strength || 14) * (1.03 + Math.random() * 0.04)));
}

/* ---------- Per-cycle driver ---------- */
function rivalTurn(r) {
  const arc = RIVAL_ARCHETYPES[r.archetype] || RIVAL_ARCHETYPES.trader;
  const options = [
    { key: "trade", w: arc.tradeW }, { key: "lobby", w: arc.lobbyW },
    { key: "colonize", w: arc.colonizeW }, { key: "power", w: arc.powerW },
  ];
  const total = options.reduce((s, o) => s + o.w, 0);
  let roll = Math.random() * total, choice = options[options.length - 1].key;
  for (const o of options) { roll -= o.w; if (roll <= 0) { choice = o.key; break; } }
  if (choice === "trade") rivalTradeTurn(r);
  else if (choice === "lobby") rivalPoliticalTurn(r);
  else if (choice === "colonize") rivalColonizeTurn(r);
  else rivalGrowPower(r);
}
function processRivals() {
  if (!S.rivalsEnabled) return;
  rivalList().forEach(r => {
    if (Math.random() < RIVAL_ACT_CHANCE) rivalTurn(r);
    r.hostility = Math.max(0, (r.hostility || 0) - 1);   // grudges fade slowly on their own, like pirate-band standing
  });
}

/* ---------- Chase the player down once they're Wanted ----------
   Cloned from maybeAmbush's shape (combat.js) but resolved as a personal
   vendetta, not a toll: the generated foe carries noPay so encounterPay()
   refuses it outright, and it must set `level` (pirateKillRewards reads
   prey.level directly — an ordinary pirate encounter always has one, a
   rival encounter must supply its own or the reward math goes to NaN). */
function maybeRivalPursuit(dest) {
  if (!S.rivalsEnabled || S.encounter || S.interdiction || S.jail > 0) return;
  if ((S.pirate.wanted || 0) < RIVAL_PURSUIT_WANTED_MIN) return;
  const hunters = rivalList().filter(r => (r.hostility || 0) >= RIVAL_PURSUIT_HOSTILITY_MIN);
  if (!hunters.length) return;
  const r = pick(hunters);
  const chance = 0.04 + (S.pirate.wanted / 100) * 0.10 + (r.hostility / 100) * 0.08;
  if (Math.random() >= chance) return;
  const strength = Math.round((r.strength || 14) * (0.9 + Math.random() * 0.3) * foeStrengthMult());
  const level = Math.max(1, Math.min(5, Math.round(strength / 12)));
  const prof = genFoeProfile("pirate", strength, dest.enforce);
  const foe = {
    type: "rival", isPirate: false, rivalId: r.id, rivalName: r.name,
    name: `${r.name}'s ship`, ico: r.ico, faction: r.patron,
    cargo: {}, credits: rint(200, 600),
    strength, level, def: prof.def, wtype: prof.wtype,
    bounty: 0, wantedGain: 0, noPay: true,
  };
  applyShipClass(foe, rollShipClass());
  foe.name = `${r.name}'s ${(SHIP_CLASSES[foe.cls] || SHIP_CLASSES.corvette).name}`;
  S.encounter = foe;
  log(`⚔️ Rival Captain <span class="c">${r.name}</span> has come looking for you — your reputation finally caught their attention!`, "bad");
  toast(`${r.name} intercepts you!`, "bad");
  if (typeof announce === "function") announce("⚔️ Rival Interception", `${r.name} has hunted you down. Fight or flee — they won't be bought off.`, false);
  unlock("raid"); if (typeof setTab === "function") setTab("raid");
}
// called from combat.js once a tagged S.encounter resolves (kill, foe flees, or the player flees clean)
function rivalDefeatConsequence(rivalId, outcome) {
  const r = rivalById(rivalId); if (!r) return;
  if (outcome === "defeated") {
    r.hostility = Math.min(100, (r.hostility || 0) + 20);
    r.rep = Math.max(-100, (r.rep || 0) - 10);
    r.strength = Math.max(8, Math.round(r.strength * 0.85));
  } else if (outcome === "evaded") {
    r.hostility = Math.min(100, (r.hostility || 0) + 5);
  }
}

/* ---------- Sighting attribution — raid & convoy visibility ----------
   Pure flavor tags on an already-generated foe/wave: a small chance a raid
   target or convoy ambush turns out to belong to a rival, renamed so the
   existing engagement log/toast lines surface it for free. No extra loot,
   no extra danger — the generation itself is untouched. */
function maybeAttributeRivalConvoy(foe) {
  if (!S.rivalsEnabled || !foe || foe.rivalId) return foe;
  const pool = rivalList(); if (!pool.length) return foe;
  if (Math.random() >= 0.10) return foe;
  const r = pick(pool);
  foe.rivalId = r.id; foe.name = `${r.name}'s ${foe.name}`;
  return foe;
}
function maybeAttributeRivalAmbush(wave) {
  if (!S.rivalsEnabled || !wave || !wave.foes || !wave.foes.length) return;
  const pool = rivalList(); if (!pool.length) return;
  if (Math.random() >= 0.15) return;
  const r = pick(pool);
  const f = wave.foes.find(x => x.role === "elite") || wave.foes[0];
  f.rivalId = r.id; f.name = `${r.name}'s ${f.name}`;
}

/* ---------- Contacts tab — read-only "Rivals" sub-view ---------- */
function rivalCard(r) {
  const t = bandTier(r);   // BAND_TIERS (pirateBands.js) only reads .rep — a generic standing ladder, reused as-is
  const arc = RIVAL_ARCHETYPES[r.archetype] || {};
  const pct = Math.round((((r.rep || 0) + 100) / 200) * 100);
  const cols = (r.colonies || []).map(pid => (PLANETS.find(p => p.id === pid) || {}).name).filter(Boolean);
  return `<div class="card">
      <h4>${arc.ico || r.ico} ${r.name}</h4>
      <div class="hint">${arc.name || "Rival Captain"} · ${FACTIONS[r.patron].ico} ${FACTIONS[r.patron].name} · ${t.label} (${r.rep || 0})</div>
      <div class="bar"><span style="width:${pct}%;background:${(r.rep||0) >= 41 ? "var(--good)" : (r.rep||0) < -10 ? "var(--bad)" : "var(--warn)"}"></span></div>
      <div class="ship-stat"><span class="k">Last seen</span><span class="v">${rivalLocName(r)} <span class="hint">cycle ${r.lastSeen}</span></span></div>
      <div class="ship-stat"><span class="k">Holdings</span><span class="v">${fmt(r.credits || 0)} cr · ${cols.length ? cols.join(", ") : "no colonies"}</span></div>
      <div class="ship-stat"><span class="k">Hostility</span><span class="v" style="color:${(r.hostility||0) >= RIVAL_PURSUIT_HOSTILITY_MIN ? "var(--bad)" : "inherit"}">${r.hostility || 0}/100${(r.hostility||0) >= RIVAL_PURSUIT_HOSTILITY_MIN ? " — may hunt you while you're Wanted" : ""}</span></div>
    </div>`;
}
function renderContactsRivals() {
  const rivals = rivalList().sort((a, b) => (b.hostility || 0) - (a.hostility || 0));
  const cards = rivals.map(rivalCard).join("");
  return `<div class="subtitle">Other captains carving out their own place in the sector — they trade (moving markets you'll notice), lobby their patron faction against you, race you for unclaimed worlds, and can come looking for you once you're Wanted enough to be worth the trouble.</div>
    <div class="cards">${cards || '<div class="card"><div class="hint">No rival captains active yet.</div></div>'}</div>`;
}

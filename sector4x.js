/* ============================================================
   STELLAR FRONTIER — the Sector 4X layer
   A background simulation of the wider sector, independent of direct
   player action: rival pirate bands rising into named powers with their
   own havens (mirrors the player's own Haven mechanic), the five great
   powers' persistent relationships with EACH OTHER (not just their
   reputation with you) drifting toward war or peace and occasionally
   punctuated by named incidents, and territory contest — a world whose
   owner is at open war with someone can actually change hands. See
   docs/SECTOR.md for the full design history (slices 1-4).

   Loaded after raiding.js, before game.js. canHaven, isVisible,
   mdPlanetName, digestNote and announce still live in game.js at this
   point in the split — safe, since every function here is only CALLED
   later, once every script has finished loading, same pattern as every
   prior slice.
   ============================================================ */

"use strict";

/* ---------- Rising pirate powers — mirrors the player's own Haven: every so
   often, an exceptional band claims a lawless world as its own lair and
   becomes a named, escalating threat. It's still just a band underneath —
   you can ally, feud, hire or mandate with it exactly as any other — but its
   haven grows (raising local pirate activity, its own rank) while the world
   stays lawless, and withers if you keep it pacified long enough. Pure
   background sim + existing-tool counterplay: no new player action
   required. ---------- */
const PIRATE_HAVEN_MAX_TIER = 3, PIRATE_HAVEN_MAX_ACTIVE = 2, PIRATE_HAVEN_CALM_TO_COLLAPSE = 3;
function bandsWithHaven() { return bandList().filter(b => b.haven); }
function pirateHavenWorlds() { return new Set(bandsWithHaven().map(b => b.haven.planet)); }
function eligiblePirateHavenWorlds() {
  const claimed = pirateHavenWorlds();
  return PLANETS.filter(p => isVisible(p) && canHaven(p) && !claimed.has(p.id) && !(S.haven && S.haven.planet === p.id));   // never found/announce a haven on an undiscovered frontier world
}
function processPirateHavens() {
  if (S.turn % 5 !== 0) return;   // matches processPirates' own cadence — they rise and fall on the same rhythm
  // ---- existing havens: grow while their world stays lawless, decay and collapse once it's pacified ----
  const justCollapsed = new Set();   // a band that just lost its haven this pass can't found a new one in the same breath
  bandsWithHaven().forEach(b => {
    const h = b.haven, plv = pirateLevel(h.planet), name = mdPlanetName(h.planet);
    if (plv <= 0) {
      h.calm = (h.calm || 0) + 1;
      if (h.calm >= PIRATE_HAVEN_CALM_TO_COLLAPSE) {
        log(`🏳️ The ${b.ico} ${b.name} abandon their haven at ${name} — the lanes there have gone quiet for good.`, "good");
        digestNote("threats", `${b.name}'s haven at ${name} collapsed`);
        b.haven = null; justCollapsed.add(b.id);
      }
      return;
    }
    h.calm = 0;
    if (h.tier < PIRATE_HAVEN_MAX_TIER && Math.random() < 0.15 + plv * 0.05) {
      h.tier++;
      if (b.level < 5 && Math.random() < 0.5) b.level++;
      S.pirates[h.planet] = Math.min(5, pirateLevel(h.planet) + 1);
      log(`👑 The ${b.ico} ${b.name}'s haven at ${name} grows to tier ${h.tier} — a rising power in the rim.`, "bad");
      digestNote("threats", `${b.name}'s haven at ${name} grows (tier ${h.tier})`);
    }
  });
  // ---- a new haven rising: prefers an established band, weighted toward already-lawless worlds ----
  if (bandsWithHaven().length < PIRATE_HAVEN_MAX_ACTIVE && Math.random() < 0.25) {
    const worlds = eligiblePirateHavenWorlds();
    if (worlds.length) {
      const w = worlds.map(p => 1 + pirateLevel(p.id) * 2);
      const tot = w.reduce((s, x) => s + x, 0);
      let r = Math.random() * tot, idx = 0;
      for (; idx < worlds.length; idx++) { r -= w[idx]; if (r <= 0) break; }
      const p = worlds[Math.min(idx, worlds.length - 1)];
      const candidates = bandList().filter(x => !x.haven && x.level >= 3 && !justCollapsed.has(x.id));
      const band = candidates.length ? pick(candidates) : newBand(rint(3, 4));
      band.haven = { planet: p.id, tier: 1, calm: 0 };
      band.loc = p.id;
      S.pirates[p.id] = Math.min(5, Math.max(pirateLevel(p.id), 3));
      log(`👑 A new pirate power rises: the ${band.ico} ${band.name} carve a hidden haven out of <span class="c">${p.name}</span>!`, "bad");
      digestNote("threats", `${band.name} founded a haven at ${p.name}`);
      if (typeof toast === "function") toast(`${band.name} claims ${p.name}`, "bad");
    }
  }
}
/* ---------- Territory contest — the risky slice: a world's owning faction
   can actually change. Only worlds whose owner is at WAR (slice 1) with
   someone are contestable; the meter erodes faster the deeper the war and
   the more pirate-plagued the world (rising pirate powers ties in directly —
   an unchecked haven can tip the balance). A faction can never be conquered
   down to zero worlds — its last is always safe, an unconquerable capital.

   `PLANETS` is static source, re-declared fresh on every load, so a flip
   is recorded twice: mutated live on the PLANETS object (so every one of
   the ~90 existing `.faction` reads sees it immediately, no call site
   needs to change) AND into `S.territoryFlips` for init() to replay onto
   the freshly-loaded array after a reload. ---------- */
const TERRITORY_MAX_METER = 100, TERRITORY_MIN_WORLDS = 1;
function activeFactionPlanetCount(f) { return activePlanets().filter(p => p.faction === f).length; }
function ensureTerritoryControl() { if (!S.territoryControl) S.territoryControl = {}; return S.territoryControl; }
function ensureTerritoryFlips() { if (!S.territoryFlips) S.territoryFlips = {}; return S.territoryFlips; }
// PLANETS is static source, re-declared fresh on every load — this reapplies every recorded
// seizure onto the live array. Called from init() after a load; also directly testable.
function replayTerritoryFlips() {
  Object.entries(ensureTerritoryFlips()).forEach(([pid, fac]) => { const p = PLANETS.find(x => x.id === pid); if (p && FACTIONS[fac]) p.faction = fac; });
}
// which faction is currently contesting this world, if any — only possible while its owner is at War with someone
function territoryContestFor(p) {
  if (!p || !p.faction || p.colonizable) return null;
  const worst = factionMostTenseRelation(p.faction);
  if (!worst || worst.rel.tier !== "war") return null;
  return { owner: p.faction, challenger: worst.other };
}
function applyTerritoryFlip(pid, newFaction) {
  const p = PLANETS.find(x => x.id === pid); if (!p) return;
  p.faction = newFaction;
  ensureTerritoryFlips()[pid] = newFaction;
}
function territoryControlPct(pid) { const c = ensureTerritoryControl()[pid]; return c ? Math.round(c.meter) : 0; }
function processTerritoryContest() {
  if (S.turn % 5 !== 0) return;
  const ctrl = ensureTerritoryControl();
  PLANETS.filter(p => isVisible(p) && !p.colonizable).forEach(p => {   // an undiscovered frontier world can't be seized in the log before you've even found it
    const contest = territoryContestFor(p), key = p.id, existing = ctrl[key];
    if (!contest) {
      if (existing) { existing.meter = Math.max(0, existing.meter - 15); if (existing.meter <= 0) { delete ctrl[key]; log(`🕊️ The contest for <span class="c">${p.name}</span> has cooled off — its hold is secure again.`, ""); } }
      return;
    }
    // a fresh contest, or the war shifted to a different (worse) rival — restart, carrying over half the buildup
    const c = (existing && existing.owner === contest.owner && existing.challenger === contest.challenger)
      ? existing : (ctrl[key] = { owner: contest.owner, challenger: contest.challenger, meter: existing ? existing.meter * 0.5 : 0 });
    const warScore = factionRelScore(contest.owner, contest.challenger);   // more negative = deeper war = faster erosion
    const plv = pirateLevel(p.id);
    const rate = 3 + Math.max(0, -30 - warScore) * 0.1 + plv * 1.5 + rint(0, 3);
    c.meter = Math.min(TERRITORY_MAX_METER, c.meter + rate);
    if (c.meter >= TERRITORY_MAX_METER) {
      if (activeFactionPlanetCount(contest.owner) > TERRITORY_MIN_WORLDS) {
        const ownerName = FACTIONS[contest.owner].name, chName = FACTIONS[contest.challenger].name;
        applyTerritoryFlip(p.id, contest.challenger);
        log(`🚩 <b>${p.name}</b> falls! The ${chName} seize it from the ${ownerName}.`, "bad");
        digestNote("sector", `${p.name}: ${FACTIONS[contest.owner].ico}→${FACTIONS[contest.challenger].ico} seized`);
        if (typeof announce === "function") announce("🚩 World Seized", `${p.name} has fallen to the ${chName}.`, false);
        if (typeof toast === "function") toast(`${p.name} seized by ${chName}!`, "bad");
        delete ctrl[key];
      } else {
        c.meter = TERRITORY_MAX_METER - 1;   // a faction's last world is always held at the brink — it can't fall
      }
    }
  });
}

const FACTION_RIVAL = { core: "frontier", frontier: "core", syndicate: "core", miners: "agri", agri: "miners" };
/* ------------------------------------------------------------
   SECTOR RELATIONS — a persistent, evolving state between every pair of
   factions (not just the static FACTION_RIVAL lookup). Drifts each cycle
   toward tension (rivals) or peace (everyone else), nudged by your own
   letters of marque and the occasional random incident. Slice 1 of the
   sector 4X layer: pure new state — nothing existing reads it yet, so it
   can't destabilize anything already built.
   ------------------------------------------------------------ */
const FACTION_KEYS = Object.keys(FACTIONS);
const FACTION_REL_META = {
  alliance: { ico: "🤝", label: "Alliance" },
  peace:    { ico: "🕊️", label: "Peace" },
  cold:     { ico: "❄️", label: "Cold War" },
  war:      { ico: "⚔️", label: "War" },
};
const FACTION_INCIDENTS_GOOD = ["a trade accord eases tensions", "a diplomatic exchange builds goodwill", "a joint relief effort earns trust", "a border dispute is settled quietly"];
const FACTION_INCIDENTS_BAD = ["a border skirmish flares up", "a smuggling bust sparks accusations", "a tariff dispute turns bitter", "a stolen convoy inflames old grudges"];
function factionPairKey(a, b) { return [a, b].sort().join("_"); }
function factionsAreRivals(a, b) { return FACTION_RIVAL[a] === b || FACTION_RIVAL[b] === a; }   // the table has one one-way entry (syndicate->core)
function ensureFactionRel() {
  if (!S.factionRel) S.factionRel = {};
  FACTION_KEYS.forEach((a, i) => FACTION_KEYS.slice(i + 1).forEach(b => {
    const key = factionPairKey(a, b);
    if (S.factionRel[key] == null) S.factionRel[key] = factionsAreRivals(a, b) ? -20 : 25;   // rivals start tense, others start at peace
  }));
  return S.factionRel;
}
function factionRelScore(a, b) { if (a === b) return 100; ensureFactionRel(); return S.factionRel[factionPairKey(a, b)] ?? 25; }
function factionRelTier(score) {
  if (score >= 60) return "alliance";
  if (score >= 15) return "peace";
  if (score >= -30) return "cold";
  return "war";
}
function factionRelation(a, b) { const score = factionRelScore(a, b); const tier = factionRelTier(score); return { score: Math.round(score), tier, ...FACTION_REL_META[tier] }; }
// the single most newsworthy relationship a faction has right now — a war outranks an alliance for urgency
function factionMostTenseRelation(f) { let worst = null; FACTION_KEYS.forEach(o => { if (o === f) return; const rel = factionRelation(f, o); if (!worst || rel.score < worst.rel.score) worst = { other: o, rel }; }); return worst; }
function factionMostFriendlyRelation(f) { let best = null; FACTION_KEYS.forEach(o => { if (o === f) return; const rel = factionRelation(f, o); if (!best || rel.score > best.rel.score) best = { other: o, rel }; }); return best; }
// a faction with a shooting war on its hands has its fleet committed — raid campaigns
// against its worlds meet one fewer coalition response wing (assaultReinforceCap, raiding.js)
function factionAtWar(f) { return !!f && FACTION_KEYS.some(o => o !== f && factionRelTier(factionRelScore(f, o)) === "war"); }
function factionWarFrontPill(f) {
  if (!f) return "";
  const worst = factionMostTenseRelation(f);
  if (worst && worst.rel.tier === "war") return `<span class="pill bad" title="${FACTIONS[f].name} is at war with ${FACTIONS[worst.other].name} — see 🏛️ Politics">⚔️ at war w/ ${FACTIONS[worst.other].name}</span>`;
  const best = factionMostFriendlyRelation(f);
  if (best && best.rel.tier === "alliance") return `<span class="pill good" title="${FACTIONS[f].name} is allied with ${FACTIONS[best.other].name} — see 🏛️ Politics">🤝 allied w/ ${FACTIONS[best.other].name}</span>`;
  return "";   // peace/cold-war is the boring default — no pill, keeps the map clean
}
function processFactionRelations() {
  const rel = ensureFactionRel();
  const keys = Object.keys(rel);
  keys.forEach(key => {
    const [a, b] = key.split("_"), rival = factionsAreRivals(a, b);
    const target = rival ? -60 : 25;                          // rivals drift toward war; everyone else settles toward peace
    rel[key] += (target - rel[key]) * 0.015;
    if (S.commission && ((S.commission.patron === a && S.commission.target === b) || (S.commission.patron === b && S.commission.target === a)))
      rel[key] -= 1.2;                                        // your active letter of marque stokes exactly this rivalry
    rel[key] = Math.max(-100, Math.min(100, rel[key]));
  });
  if (S.turn % 4 === 0 && Math.random() < 0.5) {               // an occasional named incident nudges one pair harder
    const key = pick(keys), [a, b] = key.split("_");
    const beforeTier = factionRelTier(rel[key]);
    const good = Math.random() < 0.5;
    rel[key] = Math.max(-100, Math.min(100, rel[key] + (good ? 1 : -1) * rint(8, 16)));
    const afterTier = factionRelTier(rel[key]);
    log(`🌐 ${FACTIONS[a].name} &amp; ${FACTIONS[b].name}: ${good ? pick(FACTION_INCIDENTS_GOOD) : pick(FACTION_INCIDENTS_BAD)}.`, good ? "good" : "bad");
    if (afterTier !== beforeTier) {
      const beforeMeta = FACTION_REL_META[beforeTier], meta = FACTION_REL_META[afterTier];
      const tone = afterTier === "war" ? "bad" : afterTier === "alliance" ? "good" : "";
      log(`${meta.ico} <b>${FACTIONS[a].name}</b> and <b>${FACTIONS[b].name}</b> now stand at <b>${meta.label}</b>.`, tone);
      if (typeof digestNote === "function") digestNote("sector", `${FACTIONS[a].name}–${FACTIONS[b].name}: ${beforeMeta.ico} ${beforeMeta.label} → ${meta.ico} ${meta.label}`);
    }
  }
}

/* ------------------------------------------------------------
   THE CONCORDAT SPIRE — a late-game mega-project. Once Terraforming is
   researched, the tech tree has nowhere left to send S.res.tech — colony
   Research Campuses/Datacenters just keep generating a resource with no
   sink. The Spire turns that surplus (plus huge material contributions)
   into a monument built at one colony the player designates, funded from
   anywhere in their empire. Which factions' worlds end up supplying it is
   never asked of the player directly — it's read from S.spire.byFaction
   and drives an emergent outcome through the existing S.factionRel system:
   spread contributions ease every rivalry, contributions funneled through
   one faction provoke its rivals. Mirrors the Pirate Lord / Sector Marshal
   capstone shape (outlaw.js) as a third, political/cooperative legacy path.
   ------------------------------------------------------------ */
function spireUnlocked() { return !!S.techs.terraform; }
const SPIRE_SITE_COST = { credits: 20000, metals: 500 };
const SPIRE_TARGETS = { tech: 3000, alloys: 4000, electronics: 3000, antimatter: 800 };
const SPIRE_DOMINANCE_SHARE = 0.5;   // one faction's cut of contributed VALUE at/above this = "claimed"
const SPIRE_SPREAD_SHARE = 0.35;     // no faction above this = "shared" (unity bonus applies)
const SPIRE_READ_THRESHOLD = 500;    // total contributed value below this is too early to read intent either way

function spirePctComplete() {
  if (!S.spire) return 0;
  const parts = Object.keys(SPIRE_TARGETS).map(c => Math.min(1, (S.spire.contributed[c] || 0) / SPIRE_TARGETS[c]));
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length * 100);
}
function spireComplete() { return !!(S.spire && Object.keys(SPIRE_TARGETS).every(c => S.spire.contributed[c] >= SPIRE_TARGETS[c])); }

function launchSpireProject(pid) {
  if (!spireUnlocked()) return;
  if (S.spire) return toast("The Spire's site is already chosen.", "bad");
  const col = S.colonies[pid]; if (!col) return toast("Pick one of your colonies.", "bad");
  if ((S.res.credits || 0) < SPIRE_SITE_COST.credits || !canAfford({ metals: SPIRE_SITE_COST.metals }))
    return toast(`Groundbreaking costs ${fmt(SPIRE_SITE_COST.credits)} cr + ${SPIRE_SITE_COST.metals} ⛓️.`, "bad");
  S.res.credits -= SPIRE_SITE_COST.credits; pay({ metals: SPIRE_SITE_COST.metals });
  S.spire = { site: pid, contributed: { tech: 0, alloys: 0, electronics: 0, antimatter: 0 },
              byFaction: Object.fromEntries(FACTION_KEYS.map(f => [f, 0])), complete: false };
  log(`🏛️ Groundbreaking at <span class="c">${PLANETS.find(p => p.id === pid).name}</span> — the Concordat Spire begins.`, "event");
  toast("The Spire's foundation is laid", "good"); sfx("event"); saveGame(); renderAll();
}
// material contribution: pulled straight from the DOCKED colony's own storage (any colony,
// not necessarily the Spire's site) into the shared tally — mirrors colonyDeposit/
// colonyWithdraw's shape (colonization.js) but skips the ship-hold step entirely
function contributeToSpire(c) {
  if (!S.spire || S.spire.complete) return;
  const col = S.colonies[S.location]; if (!col) return;
  const need = SPIRE_TARGETS[c] - (S.spire.contributed[c] || 0); if (need <= 0) return;
  let qty = Math.min(+((typeof document !== "undefined" && document.getElementById("spire-" + c) || {}).value) || 0, col.storage[c] || 0, need);
  qty = Math.floor(Math.max(0, qty));
  if (qty <= 0) return toast("Nothing to contribute.", "bad");
  col.storage[c] -= qty; S.spire.contributed[c] += qty;
  if (col.faction) S.spire.byFaction[col.faction] += qty * COM[c].base;   // weighted by economic value, same shape as netWorth()
  log(`🏛️ ${currentPlanet().name} ships ${qty} ${COM[c].ico} ${COM[c].name} to the Spire.`, "event");
  checkSpireCompletion(); afterAction();
}
// tech is a global currency (S.res.tech), not colony storage — no location gate, mirrors buyUpgrade()
function contributeSpireTech(qty) {
  if (!S.spire || S.spire.complete) return;
  const need = SPIRE_TARGETS.tech - S.spire.contributed.tech; if (need <= 0) return;
  qty = Math.floor(Math.max(0, Math.min(+qty || 0, S.res.tech || 0, need)));
  if (qty <= 0) return toast("No tech points to spare.", "bad");
  S.res.tech -= qty; S.spire.contributed.tech += qty;
  log(`🏛️ ${fmt(qty)} tech points channeled into the Spire's design.`, "event");
  checkSpireCompletion(); afterAction();
}
function checkSpireCompletion() {
  if (!S.spire || S.spire.complete || !spireComplete()) return;
  S.spire.complete = true;
  const dom = spireDominantFaction();
  if (dom) addRep(dom, 15);                                                                 // a permanent claim to fame with its patron
  else Object.keys(ensureFactionRel()).forEach(k => { S.factionRel[k] = Math.max(S.factionRel[k], -30); });  // shared work: never falls back below Cold War
  if (typeof announce === "function") announce("🏛️ The Concordat Spire Stands", "Decades of labor made real. The sector will remember this age.", true);
  if (typeof fireworks === "function") fireworks(8000, true);
  log("🏛️ THE CONCORDAT SPIRE IS COMPLETE.", "good");
}
// emergent rivalry hook, read from contribution history — no dedication menu, the player's
// own funding choices ARE the decision. Ticked every cycle (processSpire) and read again on
// completion (checkSpireCompletion) and by the capstone legacy (spireLegacy, outlaw.js).
function spireDominantFaction() {
  if (!S.spire) return null;
  const total = Object.values(S.spire.byFaction).reduce((a, b) => a + b, 0); if (total < SPIRE_READ_THRESHOLD) return null;
  const [f, v] = Object.entries(S.spire.byFaction).sort((a, b) => b[1] - a[1])[0];
  return (v / total) >= SPIRE_DOMINANCE_SHARE ? f : null;
}
function processSpire() {
  if (!S.spire || S.spire.complete) return;
  ensureFactionRel();
  const dom = spireDominantFaction();
  const total = Object.values(S.spire.byFaction).reduce((a, b) => a + b, 0);
  if (dom) {   // one faction is seen claiming the Spire — its rivals grow tenser
    FACTION_KEYS.forEach(f => { if (f !== dom && factionsAreRivals(dom, f)) S.factionRel[factionPairKey(dom, f)] -= 0.4; });
  } else if (total >= SPIRE_READ_THRESHOLD && Math.max(...Object.values(S.spire.byFaction)) / total < SPIRE_SPREAD_SHARE) {
    Object.keys(S.factionRel).forEach(k => { S.factionRel[k] += 0.2; });   // a common cause nudges every pair toward peace
  }
}

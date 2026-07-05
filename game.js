/* ============================================================
   STELLAR FRONTIER — a space exploration & economy game
   Pure vanilla JS. No dependencies. State persists to localStorage.

   v2 — "Deep Economy": tiered commodity chains, location-bound
   extraction (mine / forage / capture / exploit), multi-step
   production, factions + reputation, contraband & smuggling,
   and governor trade decrees.

   Loaded last, after every other script: data.js, galaxygen.js,
   catalogs.js, crises.js, state.js, pricing.js, feedback.js,
   resources.js, combat.js, pirateBands.js, raiding.js, sector4x.js,
   outlaw.js, politics.js, economy.js, colonization.js, fleet.js,
   fortunes.js, frontier.js, mandates.js, escort.js — every domain
   system — then the five rendering slices (renderCore.js,
   renderProgression.js, renderCombat.js, renderSettlement.js,
   renderFleetFortunes.js) covering every tab, then persistence.js
   (save/load, the Captain's Log export, portable save files). What's
   left here is the application shell: turn orchestration (endTurn),
   renderAll() the master dispatcher, tab disclosure/unlocking,
   version-check & help/changelog UI, and newGame()/init() itself.
   This file assumes all of the above are already loaded.
   ============================================================ */

"use strict";

function afterAction() { checkWin(); checkMilestones(); saveGame(); renderAll(); }

/* ============================================================
   TURN / EVENTS
   ============================================================ */
const EVENTS = [
  { msg: "Solar flare scrambles markets sector-wide.", type: "event",
    fn: () => COM_IDS.forEach(c => PLANETS.forEach(p => { S.prices[p.id][c] = Math.round(S.prices[p.id][c] * (0.7 + Math.random() * 0.7)); })) },
  { msg: "Pirates ambush your convoy!", type: "bad",
    fn: () => {
      const mit = 1 - S.upgrades.shield * 0.25;
      const target = ["goods", "metals", "electronics", "luxury"].find(c => S.res[c] > 0) || "ore";
      const stolen = Math.min(S.res[target], Math.round(S.res[target] * 0.25 * mit));
      const credLoss = Math.min(S.res.credits, Math.round(80 * mit));
      S.res[target] -= stolen; S.res.credits -= credLoss;
      return ` They grabbed ${stolen} ${COM[target].name} and ${fmt(credLoss)} credits.`;
    } },
  { msg: "A derelict freighter drifts by — salvage recovered.", type: "good",
    fn: () => { const c = 200 + Math.round(Math.random() * 800); S.res.credits += c; return ` +${fmt(c)} credits.`; } },
  { msg: "Bumper harvest — biomass & food prices crash.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].biomass = Math.round(S.prices[p.id].biomass * 0.6); }) },
  { msg: "Ore shortage — metals prices spike.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].metals = Math.round(S.prices[p.id].metals * 1.5); }) },
  { msg: "Energy crisis — power cells in huge demand.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].energy = Math.round(S.prices[p.id].energy * 1.6); }) },
  { msg: "Black-market boom — relics & spice prices surge.", type: "event",
    fn: () => PLANETS.forEach(p => { S.prices[p.id].relics = Math.round(S.prices[p.id].relics * 1.5); S.prices[p.id].spice = Math.round(S.prices[p.id].spice * 1.4); }) },
  { msg: "Scientific breakthrough! Bonus tech points awarded.", type: "good",
    fn: () => { const t = 5 + Math.round(Math.random() * 10); S.res.tech += t; return ` +${t} tech.`; } },
  { msg: "Customs crackdown — enforcement tightens this cycle.", type: "event", fn: () => "" },
];
function maybeEvent() {
  if (Math.random() < 0.45) {
    const e = EVENTS[Math.floor(Math.random() * EVENTS.length)];
    const extra = e.fn() || "";
    log("📡 " + e.msg + extra, e.type);
    toast(e.msg, e.type === "bad" ? "bad" : "event");
  }
}
function applyDecreeIncome() {
  if (S.perks.governor && S.decrees.monopoly) {
    const c = S.decrees.monopoly;
    const income = Math.round(COM[c].base * 8);
    S.res.credits += income;
    log(`Monopoly on ${COM[c].ico} ${COM[c].name} paid <span class="c">${fmt(income)}</span> credits this cycle.`, "good");
  }
}
// ---- per-cycle treasury ledger: the recurring automatic flows (tax, upkeep,
// tribute, policy income/cost…) each report here so the cycle's credit moves are
// summarised in one line — no more "credits changed for unknown reasons".
let _cledger = null;
function cycleLedger(cat, amt) { amt = Math.round(amt || 0); if (_cledger && amt) _cledger[cat] = (_cledger[cat] || 0) + amt; }
function reportCycleLedger() {
  const L = _cledger; _cledger = null; if (!L) return;
  const ent = Object.entries(L).filter(([, v]) => v !== 0); if (!ent.length) return;
  const net = ent.reduce((s, [, v]) => s + v, 0);
  const parts = ent.sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).map(([k, v]) => `${v > 0 ? "+" : "−"}${fmt(Math.abs(v))} ${k}`);
  log(`💰 Cycle accounts: ${parts.join(" · ")} → net ${net >= 0 ? "+" : "−"}${fmt(Math.abs(net))} cr.`, net >= 0 ? "good" : "bad");
}
// ---- per-cycle digest: a second, separate line rolling up non-financial noise
// (production totals, arrivals/completions, rising threats) into one recap, so
// a busy empire's log doesn't bury the headline in a dozen scattered lines.
let _cdigest = null;
function digestProd(key, qty) { if (_cdigest && qty) _cdigest.production[key] = (_cdigest.production[key] || 0) + qty; }
function digestNote(cat, text) { if (_cdigest && _cdigest[cat]) _cdigest[cat].push(text); }
function reportCycleDigest() {
  const D = _cdigest; _cdigest = null; if (!D) return;
  const parts = [];
  const prodKeys = Object.keys(D.production);
  if (prodKeys.length) parts.push(`🏭 produced ${prodKeys.map(c => `${fmt(D.production[c])}${COM[c] ? COM[c].ico : ""}`).join(" ")}`);
  if (D.arrivals.length) parts.push(`✅ ${D.arrivals.join(", ")}`);
  if (D.threats.length) parts.push(`⚠️ ${D.threats.join(", ")}`);
  if (D.sector && D.sector.length) parts.push(`🌐 ${D.sector.join(", ")}`);
  if (!parts.length) return;
  log(`📋 Cycle ${S.turn} recap: ${parts.join(" · ")}.`, "");
}
function endTurn(fromTravel = false) {
  if (!fromTravel && combatLocked()) return;
  S.turn++; S.actionsUsed = 0; _cledger = {}; _cdigest = { production: {}, arrivals: [], threats: [], sector: [] };
  if (S.jail > 0) { S.jail--; log(`⛓️ You serve a cycle in detention (${S.jail} remaining).`, "bad"); }
  processFx(); processSignals(); processExpedition();
  processCrises(); processPirates(); processPirateHavens(); processFactionRelations(); processTerritoryContest(); rollPrices(); processReserves(); processPollution(); applyDecreeIncome(); applyPolicyEffects(); processPlanetLaws(); processOrgs(); processInvestigation(); processOffice(); processWanted(); processHaven(); processCommission(); processBases(); processBaseTrade(); processLogistics(); processColonies(); finalizeBaseTrade(); expireContracts(); maybeGenContract(); maybeEvent(); maybeFortune(); maybeSignal();
  if (typeof escortDeadlineCheck === "function") escortDeadlineCheck();
  if (typeof decayBands === "function") decayBands();
  if (typeof processBandSupport === "function") processBandSupport();
  if (typeof processMandates === "function") processMandates();
  if (typeof processTruces === "function") processTruces();
  if (typeof processFleet === "function") processFleet();
  processTrimRefit();
  processSpire();
  reportCycleLedger();
  reportCycleDigest();
  if (!fromTravel) log(`— Cycle ${S.turn} begins —`);
  checkWin(); checkMilestones(); saveGame(); renderAll();
}

/* ============================================================
   RENDERING
   ============================================================ */

function renderAll() {
  if (typeof document === "undefined") return;
  checkUnlocks(); checkDisclosure(); applyTabVisibility();
  renderResources(); renderShip(); renderGalaxy(); renderMarket();
  renderIndustry(); renderResearch(); renderMissions(); renderPolitics(); renderBases(); renderColonies(); renderRaid(); renderEscort(); renderContacts(); renderShipPanel(); renderFortunesPanel(); renderFleet(); renderOps(); renderLog();
  const tn = document.getElementById("turn"); if (tn) tn.textContent = S.turn;
}

/* ============================================================
   TABS / PERSISTENCE / INIT
   ============================================================ */
/* ============================================================
   PROGRESSIVE DISCLOSURE — reveal features as the captain grows, so a new
   player meets three tabs, not ten. Unlocks are action-driven (what you hold,
   research, earn) with cycle-count fallbacks so nothing hides forever. The
   next 1-2 locked tabs show as 🔒 teasers; the rest stay hidden until near.
   ============================================================ */
const ALWAYS_TABS = ["galaxy", "market", "ship"];
const TAB_LADDER = [
  { id: "missions",  blurb: "contracts, missions & your legacy goals",
    hint: "Unlocks with your first contract", test: s => s.contracts.length > 0 || s.turn >= 2 },
  { id: "research",  blurb: "spend tech points to unlock technologies",
    hint: "Unlocks once you earn tech points", test: s => (s.res.tech || 0) > 0 || s.turn >= 3 },
  { id: "fortunes",  blurb: "track temporary boons & banes and the signals you hunt",
    hint: "Unlocks once a Fortune or a signal turns up", test: s => (Array.isArray(s.fx) && s.fx.length > 0) || (Array.isArray(s.signals) && s.signals.length > 0) || (s.fxSeen && Object.keys(s.fxSeen).length > 0) || s.turn >= 6 },
  { id: "industry",  blurb: "refine raw materials into finished goods",
    hint: "Unlocks when you carry raw materials", test: s => RAW_IDS.some(c => (s.res[c] || 0) > 0) || s.turn >= 4 },
  { id: "raid",      blurb: "hunt pirates or prey on shipping",
    hint: "Unlocks as your trade empire grows (35,000 cr in sales) — or the moment you arm up or get attacked", test: s => (s.upgrades.cannons || 0) > 0 || s.prey || s.encounter || s.interdiction || (s.stats && s.stats.sales >= 35000) || s.turn >= 70 },
  { id: "escort",    blurb: "command a fleet and escort convoys for hire",
    hint: "An expert posting — prove yourself in combat first (12 kills/raids, or earn a Letter of Marque)", test: s => !!(s.unlocked && s.unlocked.raid) && !!s.pirate && (((s.pirate.bountyKills || 0) + (s.pirate.raids || 0)) >= 12 || (s.pirate.commissionsDone || 0) > 0) },
  { id: "contacts",  blurb: "manage your relationships with pirate bands",
    hint: "Unlocks once you've crossed paths with a pirate band", test: s => Object.keys(s.pirateBands || {}).length > 0 },
  { id: "bases",     blurb: "automated off-world production",
    hint: "Unlocks once you can afford a base (~5,000 cr)", test: s => (s.res.credits || 0) >= 5000 || Object.keys(s.bases || {}).length > 0 || s.turn >= 7 },
  { id: "politics",  blurb: "factions, influence, office & law",
    hint: "Unlocks once you're an established trader (50,000 cr in sales) — or you gain influence/office", test: s => (s.res.influence || 0) > 0 || s.office > 0 || (s.orgs && s.orgs.party) || (s.stats && s.stats.sales >= 50000) || s.turn >= 85 },
  { id: "colonies",  blurb: "found and grow your own worlds",
    hint: "Unlocks with the Colonial Charter (Research)", test: s => !!s.techs.colonial || currentPlanet().colonizable || Object.keys(s.colonies || {}).length > 0 },
  { id: "fleet",     blurb: "build your own ships at a colony Shipyard or a base Small Shipyard",
    hint: "Unlocks once you have a colony, or a base with a Small Shipyard module",
    test: s => Object.keys(s.colonies || {}).length > 0 || (Array.isArray(s.fleet) && s.fleet.length > 0)
      || Object.values(s.bases || {}).some(b => (b.modules || {}).shipyard_small > 0) },
];
const RAW_IDS = ["ore", "crystals", "radioactives", "ice", "biomass", "spice", "gas", "relics"];
function tabUnlocked(id) { return S.showAllTabs || ALWAYS_TABS.includes(id) || !!(S.unlocked && S.unlocked[id]); }
function tabHint(id) { const g = TAB_LADDER.find(t => t.id === id); return g ? g.hint : ""; }
function unlock(id, announceIt) {
  if (!S.unlocked) S.unlocked = {};
  if (S.unlocked[id] || ALWAYS_TABS.includes(id)) return;
  S.unlocked[id] = true;
  const g = TAB_LADDER.find(t => t.id === id);
  if (g && announceIt !== false) {
    const lbl = tabLabel(id);
    log(`🔓 New feature unlocked: <b>${lbl}</b> — ${g.blurb}.`, "event");
    if (typeof toast === "function") toast(`🔓 Unlocked: ${lbl}`, "good");
  }
}
/* ---------- Feature disclosure (level-dependent UI) ----------
   Beyond tab unlocks, whole swathes of UI stay hidden until the player reaches
   the milestone that makes them relevant — each paired with a guiding objective
   (shown under Missions → Next Steps) and a cycle fallback so nothing hides
   forever. Phase 1: the market opens up once you manufacture your first Medicine. */
const DISCLOSURE_GATES = [
  { id: "advMarkets", icon: "🧪", goal: "Manufacture your first Medicine",
    reward: "Opens the full market — components, finished goods, luxuries & strategics",
    done: s => !!(s.made && s.made.medicine), fallbackTurn: 15 },
  // ---- retroactive reveal moments for features that were already playable but never
  // announced themselves — none of these HIDE anything (checkDisclosure only fires the
  // one-time toast/log), so adding them is low-risk on an existing save ----
  { id: "smallShipyard", icon: "🏗️", goal: "Build a Small Shipyard module at a base",
    reward: "Light hulls, buildable anywhere you've founded a base",
    done: s => Object.values(s.bases || {}).some(b => (b.modules || {}).shipyard_small > 0) },
  { id: "shipTrim", icon: "⚖️", goal: "Complete a Ship Trim refit",
    reward: "Cargo/Firepower/Autonomy on your own vessel are now yours to reallocate",
    done: s => !!s.trim && s.trim !== "balanced" },
  { id: "plasmaTorpedoes", icon: "💥", goal: "Research Antimatter Containment",
    reward: "Plasma Torpedoes are now fireable in combat, and a colony Torpedo Works can manufacture them",
    done: s => !!s.techs.antimatter },
  { id: "deepspaceChart", icon: "🧭", goal: "Discover your first edge world",
    reward: "The Deep-space chart (⚔️ Raider tab) now covers pirate activity on the frontier ring",
    done: s => edgeIntelUnlocked() },
  // ---- the Concordat Spire — stays hidden until genuinely earned, no fallbackTurn ----
  { id: "spire", icon: "🏛️", goal: "Research Terraforming",
    reward: "Reveals the Concordat Spire — a sector-defining mega-project (🏛️ Politics tab)",
    done: s => spireUnlocked() },
];
function checkDisclosure(silent) {
  if (!S.disc) S.disc = {};
  DISCLOSURE_GATES.forEach(g => {
    if (S.disc[g.id]) return;
    if (g.done(S) || (g.fallbackTurn && S.turn >= g.fallbackTurn)) {
      S.disc[g.id] = true;
      if (!silent) { log(`🔓 ${g.reward}.`, "event"); if (typeof toast === "function") toast("🔓 " + g.reward, "good"); }
    }
  });
}
// which market tiers are visible — Raw & Refined always; the rest after first Medicine
function tierRevealed(tier) {
  if (tier === "Raw" || tier === "Refined") return true;
  if (S.showAllTabs) return true;
  return !!(S.disc && S.disc.advMarkets);
}
function checkUnlocks(silent) {
  if (!S.unlocked) S.unlocked = {};
  TAB_LADDER.forEach(g => { if (!S.unlocked[g.id] && g.test(S)) unlock(g.id, !silent); });
}
function tabLabel(id) {
  const el = typeof document !== "undefined" && document.querySelector(`.tab[data-tab="${id}"]`);
  return (el && (el.dataset.label || el.textContent)) || id;
}
function applyTabVisibility() {
  if (typeof document === "undefined") return;
  const btns = Array.from(document.querySelectorAll(".tab"));
  // how many locked ladder tabs to tease (next 2 in ladder order)
  const lockedLadder = TAB_LADDER.filter(g => !tabUnlocked(g.id));
  const teasers = new Set(lockedLadder.slice(0, 2).map(g => g.id));
  btns.forEach(btn => {
    const id = btn.dataset.tab;
    if (!btn.dataset.label) btn.dataset.label = btn.textContent;
    const base = btn.dataset.label;
    if (tabUnlocked(id)) {
      btn.style.display = ""; btn.textContent = base; btn.classList.remove("locked");
      if (inCombat() && id !== combatHomeTab()) { btn.style.opacity = "0.4"; btn.title = "⚔️ Resolve the current engagement first"; btn.classList.add("combat-lock"); }
      else { btn.style.opacity = ""; btn.title = ""; btn.classList.remove("combat-lock"); }
    }
    else if (teasers.has(id)) { btn.style.display = ""; btn.style.opacity = "0.45"; btn.title = "🔒 " + tabHint(id); btn.textContent = "🔒 " + base; btn.classList.add("locked"); }
    else { btn.style.display = "none"; }
  });
}
function toggleShowAllTabs() {
  S.showAllTabs = !S.showAllTabs;
  if (typeof toast === "function") toast(S.showAllTabs ? "Everything revealed — all features shown." : "Guided mode on — features unlock as you progress.", "good");
  applyTabVisibility(); saveGame();
}
function setTab(name) {
  // surface the combat lock early: while engaged you can't leave the active battle tab
  if (typeof document !== "undefined" && name !== combatHomeTab() && combatLocked()) return;
  if (typeof document !== "undefined" && !tabUnlocked(name)) {
    if (typeof toast === "function") toast("🔒 " + (tabHint(name) || "Not available yet."), "bad");
    return;
  }
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach(p => p.classList.add("hidden"));
  document.getElementById("panel-" + name).classList.remove("hidden");
}
/* ============================================================
   VERSION CHECK — poll the server for a newer build and tell the player
   whether refreshing will keep their saved game (credits, colonies, …).
   On each release, bump APP_VERSION here AND version.json to match — AND the
   ?v= query on game.js / style.css in index.html, so browsers fetch the new
   build instead of a cached copy. Bump SAVE_VERSION (and the SAVE_KEY suffix)
   ONLY when a release breaks old saves.
   ============================================================ */
const APP_VERSION = "2.97.1";
const SAVE_VERSION = "v2";                       // matches the suffix of SAVE_KEY below
/* ---- Changelog: what a returning player sees in the "What's New" panel.
   Newest first. Add one line per release — this is separate from the single
   current-version blurb in version.json (which drives the live update banner). ---- */
const CHANGELOG = [
  { version: "2.97.1", notes: "Fix: the ✦ Fleet tab's Escort roster showed a warship following you as callable (it always refused when clicked) while hiding an idle warship actually docked here. Assigning your own hulls to a convoy now correctly lists idle local warships instead." },
  { version: "2.97.0", notes: "New: raiding a coalition's shipping now quietly earns rep with whichever faction considers them a rival — striking a real blow against someone's enemy is a risk their own agents notice and reward, letter of marque or not. Stacks with an active matching commission's own patron reward." },
  { version: "2.96.0", notes: "Changed: raid-support ships now 🛰️ Follow Me instead of patrolling a fixed world — assign an idle warship once (✦ Fleet tab) and it's on call for a raid summon or Battle Group wherever you travel, no more manual reassignment every time you change worlds." },
  { version: "2.95.0", notes: "New: 👷 Labor Relief on the Colonies Overview tab. Under-crewed for what you've built? Fund a temporary Production Surge (Tech, Electronics, Machinery, AI Cores & Alloys buy 10-15 cycles of +15/30/50% output) instead of waiting on population. Also new: Community Relief, an on-demand happiness boost and unrest relief paid in Consumer Goods, on a cooldown — separate from the passive comfort your stockpiled goods/luxury/medicine already provide." },
  { version: "2.94.1", notes: "Fix: the colony 🏭 Fuel Refinery (cracks Ice into Fuel — it's been buildable all along) was mis-filed under Survival & Economy instead of Industry alongside its fellow refining/manufacturing buildings. Purely a build-menu tab fix; the building and its output are unchanged." },
  { version: "2.94.0", notes: "New: the 🪐 Galaxy tab reads as a real strategic map now — every world's card and starmap node borders in its controlling faction's own color, your fleet shows up right on the map color-coded by duty (🎯 mission, 🚚 logistics, 🛡️ patrol, ⚓ docked), and a world under your fleet's watch shares its pirate activity for free, no chart needed. New: a Show: filter row lets you declutter the map to just the fleet, pirate, faction, or environmental layer you care about." },
  { version: "2.93.0", notes: "Changed: raid support now needs a warship on patrol — assign one to a world (✦ Fleet tab) before it can join the 2-ally summon or a Battle Group deployment there; a fleet parked elsewhere no longer teleports in. New: when a raid target's distress call lands, every rescuer in the area answers together instead of trickling in — pick which hostile(s) to focus fire on, same as the Escort tab's convoy combat, with your own Battle Group's Vanguard/Line/Reserve tiering unchanged." },
  { version: "2.92.0", notes: "New: your 🏴‍☠️ Haven can now be relocated to a new lawless world (tier and stash carry over) instead of being stuck wherever you founded it. New: a faction beaten all the way down to zero worlds can still deal you a Letter of Marque from exile (🏛️ Politics tab, once you've earned its trust) — its only way to fight back and reclaim a foothold." },
  { version: "2.91.1", notes: "Changed: repairs now spend materials from the local stockpile first too — a fleet hull heals off the same colony/base storage its Shipyard draws on, and your own ship's subsystem repairs pull from a colony's or base's storage before your hold (no Shipyard needed, just a storeroom). The Repair Bay notes when this applies." },
  { version: "2.91.0", notes: "Changed: laying down a hull at a Shipyard now spends materials from the local stockpile first — a colony Shipyard draws its colony's own storage, a base Small Shipyard draws its base's — and only dips into your ship's hold for whatever's left. The Fleet tab's build menu shows where the materials will come from." },
  { version: "2.90.0", notes: "Colony production overhaul. Fixed: population growth was capped by a farm's raw per-cycle output alone, ignoring any stockpiled food — a colony could sit on a full granary and still stop growing well short of its housing. Growth now draws on stored reserves too. New: colony output now tracks 👷 Workforce (population vs. what its buildings need to run), 🤖 Automation (a bonus from the world's tech level, on manufacturing), and 😠 Unrest (a real production penalty, not just a secession countdown) — all shown on the governor card." },
  { version: "2.89.1", notes: "Fix: the ✦ Fleet tab only unlocked once you held a colony, even though a base's Small Shipyard module lets you build ships without one. Building a Small Shipyard at a base now unlocks the tab on its own." },
  { version: "2.89.0", notes: "New: 🏛️ The Concordat Spire (🏛️ Politics tab) — once Terraforming is researched, designate a colony as the site of a sector-defining mega-project and fund it with tech points and Alloys/Electronics/Antimatter from anywhere in your empire. Spread the load and every faction drifts toward peace; funnel it through one faction and their rivals grow tenser instead — a third capstone legacy alongside the Pirate Lord and Sector Marshal. Also: four features that shipped quietly (Small Shipyard, Ship Trim, Plasma Torpedoes, the Deep-space chart) now announce themselves the first time you reach them." },
  { version: "2.88.0", notes: "Changed: Deep-Space Survey and Probe the Frontier merged into one 🛰️ Survey Expedition. Launch it (an action + fuel) and your crew works toward the nearest uncharted world over several cycles — longer into the deep frontier, shorter with a Research Lab. A lawless heading can still draw an ambush en route, but a returned expedition always brings back a charted world — the coin-flip is gone." },
  { version: "2.87.0", notes: "New: 🧭 Deep-space chart — a fourth pirate-intel tier (⚔️ Raider tab) covering the whole sector PLUS every edge world you've discovered beyond the charted sector; ordinary charts have never reached the frontier ring. It goes on sale only once you've found your first edge world, and edge worlds show a 🧭 marker in the intel readout." },
  { version: "2.86.0", notes: "💥 Plasma Torpedoes are now a real weapon system: fire them in combat (the hardest-hitting munition in the rack, though point-defense can thin it — the 🌀 Antimatter Warhead stays uncounterable), and build a Torpedo Works at a colony to manufacture them from Antimatter + Alloys + Radioactives. Fixed: torpedoes produced in industry vanishing from the hold, and the market paying out for torpedoes you didn't have — old saves are repaired automatically on load." },
  { version: "2.85.0", notes: "New: ⚖️ Ship Trim (🚀 Ship tab). Reallocate what your upgrades already bought you across Cargo, Firepower, and Autonomy (fuel range, jump efficiency, flee odds) — Hauler, Gunship, and Voyager each trade +35% on one axis for −30% on the other two. It's a real commitment: a refit costs credits and takes several cycles to complete." },
  { version: "2.84.0", notes: "New: the 🏗️ Small Shipyard now pays off further. A Tier 2 module boosts scrap salvage to 60% of a hull's metals (up from 40%). And any idle ship docked at its home Small Shipyard can commit to a permanent Cargo or Combat loadout — up to 3 levels, paid in hold materials — for more cargo capacity or more hull and firepower." },
  { version: "2.83.0", notes: "New: 🏗️ Small Shipyard — a base module (🏗️ Bases tab) that lets you lay down light hulls anywhere you've founded a base, including worlds no colony could ever reach. Caps at Light Freighter/Corvette (Tier 1) and Medium Freighter/Frigate (Tier 2) forever — a full-range Shipyard is still a colony building — but it's real construction: repair, reassignment, and slipways for parallel builds all work exactly like at a colony." },
  { version: "2.82.0", notes: "New: ⚓ Reassign a fleet ship's home shipyard. Built ships piecemeal across several colonies? Dock an idle ship at any colony with an adequately-tiered Shipyard and re-register its home port there for a modest fee — handy for consolidating repairs, convoy assignment and slipway use at one yard." },
  { version: "2.81.0", notes: "New: 🚚 Personal Convoy (✦ Fleet tab → Assignments). Bring idle freighters along on your own trading runs for a real second cargo hold — capped by your Cargo Hold upgrade tier so it's an extension, not a replacement. Costs extra fuel per jump to tow, and pirates ambushing you will take a swipe at it too — but a warship of your own, or a pirate band riding with you, cuts the odds of an ambush happening at all and softens the blow if one slips through. Ships join from their own home port; recall any time." },
  { version: "2.80.0", notes: "Ship-building now costs more than metal and credits. Every freighter and warship needs ☢️ Radioactives for its propulsion core; anything past the entry-level hull (Medium Freighter+, Frigate+) also needs 🧠 AI Cores for its avionics. Warships additionally need 🔫 Weapons and 🛸 Combat Drones to arm their turrets and bays at every tier. New: 💥 Plasma Torpedoes, a Strategic commodity (craftable once Antimatter Containment is researched) exclusively required for the Battleship's capital-grade armament." },
  { version: "2.79.0", notes: "UI: the ✦ Fleet tab is now split into three sub-tabs — 📊 Fleet Status (your roster), 🎯 Assignments (system missions + logistics duty), and 🏗️ Shipyard (build queue) — instead of one long scroll. No gameplay changes." },
  { version: "2.78.1", notes: "Internal: code-smell cleanup. Removed a duplicate, unreachable huntPirates() declaration in combat.js (a live one already existed as an alias for prowl()). Fixed freshState() to set S.eink (it was silently relying on a lazy backfill, so mid-session New Game left it undefined until something else patched it), then stripped reserveOf() down to its own job — it was re-running a dozen unrelated one-time save-migration checks on every single call. No gameplay changes." },
  { version: "2.78.0", notes: "Internal: split persistence (the localStorage autosave, the Captain's Log narrative export, and portable save-file export/import) out into its own file, persistence.js — slice 27 of the game.js split. No gameplay changes." },
  { version: "2.77.0", notes: "Internal: split the fifth and final tab-specific slice of the rendering layer — the Fleet and Fortunes tabs — out into their own file, renderFleetFortunes.js — slice 26 of the game.js split. renderAll() is now the only rendering function left in game.js. No gameplay changes." },
  { version: "2.76.0", notes: "Internal: split the fourth and last tab-specific slice of the rendering layer — the Bases, Colonies, and Escort tabs — out into their own file, renderSettlement.js — slice 25 of the game.js split. No gameplay changes." },
  { version: "2.75.0", notes: "Internal: split the third slice of the rendering layer — the Raid, Contacts, and Ship tabs — out into their own file, renderCombat.js — slice 24 of the game.js split. No gameplay changes." },
  { version: "2.74.0", notes: "Internal: split the second slice of the rendering layer — the Market, Industry, Research, Politics, and Missions tabs — out into their own file, renderProgression.js — slice 23 of the game.js split. No gameplay changes." },
  { version: "2.73.0", notes: "Internal: split the first slice of the rendering layer — the always-visible UI chrome (resources bar, ship stats, operations digest, log) and the Galaxy tab — out into its own file, renderCore.js — slice 22 of the game.js split. No gameplay changes." },
  { version: "2.72.0", notes: "Internal: split Convoy Escort (the expert-gated fleet-command tab) out into its own file, escort.js — slice 21 of the game.js split. No gameplay changes." },
  { version: "2.71.0", notes: "Internal: split Mandates (commission a pirate band to work a system) out into its own file, mandates.js — slice 20 of the game.js split. No gameplay changes." },
  { version: "2.70.0", notes: "Internal: split the Logistics Network, Exploration, and Win Condition/Milestone tracking out into their own file, frontier.js — slice 19 of the game.js split. No gameplay changes." },
  { version: "2.69.0", notes: "Internal: split Fortunes (temporary boons & banes) and Signals (the hunt for faint contacts) out into their own file, fortunes.js — slice 18 of the game.js split. No gameplay changes." },
  { version: "2.68.0", notes: "Internal: split the player fleet (ordering/repairing/scrapping ships, raid allies, the Battle Group, logistics stationing, and fleet missions) out into its own file, fleet.js — slice 17 of the game.js split. No gameplay changes." },
  { version: "2.67.0", notes: "Internal: split Player Bases, the Base<->Colony Trade Network, Random Contracts, and Colonies (founding, building, alignment, and the full per-cycle simulation) out into their own file, colonization.js — slice 16 of the game.js split. No gameplay changes." },
  { version: "2.66.0", notes: "Internal: split the core economy actions (Production, Trade, the Black Market/Fences, Contraband/Customs, Travel, buying Upgrades, researching Techs, Missions, and Governor Decrees) out into their own file, economy.js — slice 15 of the game.js split. No gameplay changes." },
  { version: "2.65.0", notes: "Internal: split the research & politics action layer (research, public life, political organizations, the Senate, per-planet trade-law lobbying, corruption investigations & trials, and the public Office ladder) out into its own file, politics.js — slice 14 of the game.js split. No gameplay changes." },
  { version: "2.64.0", notes: "Internal: split the content catalogs (ship Upgrades, the Technology tree, faction Missions, the public Office ladder, political Organizations, Senate Bills, and base/colony building catalogs) out into their own file, catalogs.js — slice 13 of the game.js split. No gameplay changes." },
  { version: "2.63.0", notes: "Internal: split the outlaw path (navy interdiction, the Pirate Haven, Privateer Commissions, and the Pirate Lord / Sector Marshal capstone legacies) out into its own file, outlaw.js — slice 12 of the game.js split. No gameplay changes." },
  { version: "2.62.0", notes: "Internal: split the Sector 4X layer (rising pirate powers with their own havens, faction territory contest, and persistent inter-faction relations) out into its own file, sector4x.js — slice 11 of the game.js split. No gameplay changes." },
  { version: "2.61.0", notes: "Internal: split raid combat resolution and ship repair (plunder, multi-round raids, dockside/field repair, Wanted cooldown) out into their own file, raiding.js — slice 10 of the game.js split. No gameplay changes." },
  { version: "2.60.0", notes: "Internal: split the pirate band roster (named crews, standing, feuds/truces, tags, call-for-support) out into its own file, pirateBands.js — slice 9 of the game.js split. No gameplay changes." },
  { version: "2.59.0", notes: "Internal: split the piracy/combat engine (subsystem damage, typed weapons vs defenses, adversary matchmaking, ambushes, pirate hunting) out into its own file, combat.js — slice 8 of the game.js split. No gameplay changes." },
  { version: "2.58.0", notes: "Internal: split resource extraction, deposit reserves/depletion, and pollution/climate out into their own file, resources.js — slice 7 of the game.js split. No gameplay changes." },
  { version: "2.57.0", notes: "Internal: split player feedback (ship log, captain's journal, procedural sound effects, toasts, fireworks/announcements) out into its own file, feedback.js — slice 6 of the game.js split. No gameplay changes." },
  { version: "2.56.0", notes: "Internal: split the market pricing engine (per-planet prices, buy/sell spreads, market depth & slippage) out into its own file, pricing.js — slice 5 of the game.js split. No gameplay changes." },
  { version: "2.55.0", notes: "Internal: split the game state singleton and freshState() out into their own file, state.js — slice 4 of the game.js split. No gameplay changes." },
  { version: "2.54.0", notes: "Internal: split the planetary crisis system (disasters, relief/gouge/loot responses) out into its own file, crises.js — slice 3 of the game.js split. No gameplay changes." },
  { version: "2.53.0", notes: "Internal: split the procedural galaxy generation (frontier ring, lane graph, Sector Code, core variance) out into its own file, galaxygen.js — slice 2 of the game.js split. No gameplay changes." },
  { version: "2.52.0", notes: "Internal: split the static data tables (commodities, planets, factions, recipes) out into their own file, data.js, loaded before game.js — the first step toward a more maintainable codebase. No gameplay changes." },
  { version: "2.51.0", notes: "Mobile-friendly tables (they scroll in place instead of breaking the page), a 🆕 What's New panel, a 🏅 Milestones checklist in the Missions tab, and a 🎮 Custom Start with Sprint/Standard/Marathon length and an optional ☠️ Ironman challenge." },
  { version: "2.50.0", notes: "Quality-of-life pass: press 1-9 to jump tabs and Enter/Space to end the cycle, a confirmation before scrapping a ship or attempting a coup, a quiet \"Saved\" flash by the cycle counter, and screen-reader-friendly log & toast notifications." },
  { version: "2.49.0", notes: "Core variance: a Sector Code now jitters each charted world's deposits, industry, tech and law level a little, so the same map never plays out quite the same way twice." },
  { version: "2.48.0", notes: "The Starmap: a clickable galaxy map atop the Galaxy tab charting every known world and the hyperlanes between them." },
  { version: "2.47.0", notes: "Probe the Frontier: push straight at the frontier ring for richer signals — burns fuel whether it pays off or not, and a lawless target can draw an ambush." },
  { version: "2.46.0", notes: "The Sector Code: a shareable code that reproduces your exact frontier ring and lane graph — send it to a friend, or replay your own sector." },
  { version: "2.45.0", notes: "The lane graph: seeded hyperlanes give every game its own hazard-stretched routes and cheap shortcuts between worlds." },
  { version: "2.44.0", notes: "The frontier ring: a further ring of procedurally-generated worlds beyond the charted 20 — a different set every game, hidden until surveyed." },
  { version: "2.43.0", notes: "Territory contest: a world whose owner is at open war can change hands if its control meter maxes out." },
  { version: "2.42.0", notes: "Rising pirate powers: an exceptional pirate band can carve a haven out of a lawless world and grow in strength the longer it holds." },
  { version: "2.41.0", notes: "Wider visibility: expanded intel on faction relations and contested worlds surfaced across the Galaxy and Politics tabs." },
  { version: "2.40.0", notes: "Persistent faction relations: the five great powers now track Alliance / Peace / Cold War / War with each other, independent of your own reputation." },
];
// pure + testable: compare the running build to the server manifest
function versionStatus(local, server) {
  if (!server || !server.version) return { update: false };
  return {
    update: server.version !== local.version,
    version: server.version,
    notes: server.notes || "",
    keepsProgress: !server.saveVersion || server.saveVersion === local.saveVersion,
  };
}
function checkVersion() {
  if (typeof fetch !== "function") return;
  fetch("version.json?ts=" + Date.now(), { cache: "no-store" })
    .then(r => r.ok ? r.json() : null)
    .then(data => {
      const st = versionStatus({ version: APP_VERSION, saveVersion: SAVE_VERSION }, data);
      if (st.update) showUpdateBanner(st);
    })
    .catch(() => {});
}
function showUpdateBanner(st) {
  if (typeof document === "undefined" || !document.body) return;
  let el = document.getElementById("update-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "update-banner";
    el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;padding:10px 14px;"
      + "background:#1e293b;color:#e2e8f0;border-top:2px solid var(--accent,#38bdf8);"
      + "font-size:13px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;box-shadow:0 -4px 20px rgba(0,0,0,.4)";
    document.body.appendChild(el);
  }
  const keep = st.keepsProgress
    ? "✅ Your saved game — credits, colonies, reputation and all — will carry over."
    : "⚠️ This update changes the save format, so your current run may not carry over. Download your 📖 Log first to keep the story.";
  el.innerHTML = `<span>🔄 <b>A new version (${st.version}) is available.</b> ${st.notes ? st.notes + " " : ""}${keep}</span>`
    + `<span style="margin-left:auto;display:flex;gap:6px">`
    + `<button class="btn btn-sm btn-primary" onclick="location.reload()">Refresh now</button>`
    + `<button class="btn btn-sm" onclick="document.getElementById('update-banner').remove()">Later</button>`
    + `</span>`;
}
const REPO_URL = "https://github.com/alma92350/SpaceExploration";
function helpHTML() {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">❓ How to Play — Stellar Frontier</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleHelp()">✕ Close</button>
    </div>
    <p style="opacity:.85">Carve your legacy across a contested star sector — as a <b>Trader</b>, <b>Explorer</b>, <b>Colonial Founder</b>, <b>Politician</b> or <b>Pirate</b>. Your career is whatever you make of it; you can switch and mix freely.</p>

    <h4>The basics</h4>
    <ul style="line-height:1.6;margin:0 0 6px 18px;padding:0">
      <li>Each cycle you have a handful of <b>actions</b>; most things (travel, mine, lobby, raid) cost one. Hit <b>End Cycle</b> to advance time — prices drift, colonies grow, crises tick.</li>
      <li><b>Travel</b> between worlds costs fuel and advances a cycle. Buy low, sell high; large trades move the market.</li>
      <li>Resources are <b>finite</b>: over-mining a world depletes it and raises prices. Industry breeds <b>pollution</b> and <b>climate stress</b> — so spreading to fresh worlds pays off.</li>
      <li>Win by completing your <b>Legacy goals</b> (see the 🎯 Missions tab) or by rising to a career capstone (Consul, Pirate Lord, Sector Marshal…).</li>
    </ul>

    <h4>The tabs</h4>
    <ul style="line-height:1.55;margin:0 0 6px 18px;padding:0">
      <li>🪐 <b>Galaxy</b> — travel, explore, watch worlds, factions & crises. A <b>🗺️ Starmap</b> at the top charts every world you know about and the hyperlanes between them — click a node to travel there directly, or read the card grid below for full detail. The charted 20's names, factions and history never change — but a Sector Code now jitters each one's deposits, industry, tech and law level too, so Ferros Prime's ore or Terra Nova's law level isn't always exactly what it was last game. Beyond the charted 20 lies a further <b>frontier ring</b> of procedurally-generated worlds — a different set every game — hidden until a <b>🛰️ Survey Expedition</b> charts them: outfit one (an action + fuel) and it works toward the nearest uncharted signature over several cycles (longer into the deep frontier; a Research Lab shortens the trip). A lawless heading can draw an ambush en route, but a returned crew always brings back a charted world, and frontier finds turn up richer <b>📡 signals</b>. Travel distance isn't a straight line either: a seeded lane graph gives every game its own hazard-stretched routes and cheap hyperlane shortcuts, marked with a <b>🛰️ hyperlane</b> pill (and a bright line on the Starmap) wherever one bypasses the usual path from your ship.</li>
      <li>💱 <b>Market</b> — trade goods; black market for contraband; aid or profiteer during crises. Quantity boxes remember what you last typed for each good; a 💡 hint flags the best <b>known</b> world to flip a commodity you buy here (profit per light-year), and <b>Sort: Best margin</b> ranks each tier by that same opportunity. <b>💰 Sell entire hold</b> unloads every legal good you're carrying at today's prices in one click (contraband here is held back — sell that individually if you'll risk the customs check).</li>
      <li>🏭 <b>Industry</b> — refine raw materials into finished goods.</li>
      <li>🔬 <b>Research</b> — unlock technologies.</li>
      <li>✨ <b>Fortunes</b> — temporary <b>boons &amp; banes</b> you pick up by exploring new worlds, sweeping the lanes and plain luck — extra actions, weapon surges, trade winds, research sparks, and rarer grand effects… balanced by reactor leaks, customs crackdowns and the like. This tab tracks your active effects (with time left and 🧹 clear buttons for banes), the <b>📡 signals</b> on your scope, and an <b>almanac</b> of every effect you've discovered. Chase a signal and <b>🔍 Investigate</b> it for a roll — stronger effects are briefer, and the rare, powerful ones are the prize of a hunted signal. Short on leads? The <b>🛰️ Sensor Office</b> sells scans that flush fresh signals onto your scope. Catalogue <b>every</b> effect in a domain to earn a 🏅 <b>Mastery</b> — a permanent passive edge. Unlocks once a Fortune or signal turns up.</li>
      <li>🎯 <b>Missions</b> — time-bound contracts, long-term career missions, and your legacy goals.</li>
      <li>🏛️ <b>Politics</b> — factions, influence, elections, the Senate and trade law. A <b>🌐 Sector Relations</b> card tracks how the five great powers stand with <i>each other</i> — Alliance/Peace/Cold War/War — independent of your own reputation. It drifts on its own each cycle (rivals trend toward war, others settle toward peace) and occasional named incidents can tip a pair into a new state; your own active letters of marque stoke the rivalry you're fighting for. Notable shifts appear in the log and the 📋 cycle recap. A world's most newsworthy relationship (⚔️ at war / 🤝 allied) also shows as a pill on its 🪐 Galaxy card, and active wars &amp; alliances get their own line on the sidebar's Operations board. War isn't just flavor: a world whose owner is at open war can be <b>🚩 contested</b> — a control meter (shown on its Galaxy pill, an Operations row, and the Politics tab's <b>Contested Worlds</b> card) builds faster the deeper the war and the more pirate-plagued the world, and if it maxes out the world <b>changes hands</b> to the challenger. Cooling the war back to peace lets a contest fade on its own; no faction can ever be conquered down to its last world.</li>
      <li>🏗️ <b>Bases</b> — automated off-world production. Build a <b>⛽ Fuel Refinery</b> (any base, 5 tiers) to crack stored 🧊 ice into fuel each cycle, and route fuel through the base↔colony trade network (import/export it like any good).</li>
      <li>🌍 <b>Colonies</b> — found and grow worlds: population, power and full industry chains, including a <b>⛽ Fuel Refinery</b> (ice + energy → fuel) and a <b>🏗️ Shipyard</b> (needs Metallurgy) that lets you build your own ships. Order in ice, export the fuel — fuel is now a tradeable part of the economy: buy/sell it at ports, stock it in bases &amp; colonies, and ship it across your network.</li>
      <li>✦ <b>Fleet</b> — build and run your own ships at colony <b>🏗️ Shipyards</b>: <b>freighters</b> (light → bulk hauler) to carry your goods and <b>warships</b> (corvette → battleship) to fight for you. A shipyard's tier sets the biggest hull it can lay down and how many slipways build at once; construction costs credits &amp; materials and takes several cycles, and ships draw upkeep each cycle (shown in the 💰 Cycle accounts log). Repair or scrap them at their home shipyard. <b>Dispatch a warship on a mission</b> (🎯 cull / 🛡️ guard / 🏴 raid a system) and — unlike hired pirates — <b>you keep 100%</b> of the bounty/loot, paying no fee; the risk is combat wear (a fragile hull in an infested system can be lost) and ongoing upkeep. You can also <b>call idle warships into your own raids</b> (loyal allies that take <b>no loot cut</b>) and <b>assign them to escort your convoys</b> for free — they never desert, and any damage they take comes back to your fleet. <b>Station freighters at a colony</b> on logistics duty to haul its goods — cutting its market import fee and base↔colony freight — and <b>station a warship there to guard them</b>, since unguarded convoys in pirate-active systems get ambushed (damage &amp; lost goods, and a fragile hauler can be sunk). Loyal and fully yours. In a raid, you can also <b>✦ Deploy Battle Fleet</b> — your <b>whole idle warship fleet at once</b> (not the 2-ally cap) fights as a formation with an escort-style posture (screen/balanced/press). Positioning matters: assign ships to <b>🛡️ Vanguard</b> (tanks — soaks nearly all incoming fire while it holds), <b>⚔️ Line</b> (your best damage dealers, protected behind the Vanguard), or <b>🌌 Reserve</b> (safest, weakest). Lose the Vanguard and the Line is exposed next — the formation collapses tier by tier — and keeping a Vanguard alive screens you personally too. Real stakes: ships take real damage and can be lost in a hard fight. Recall the fleet any time.</li>
      <li>⚔️ <b>Raider</b> — prey on shipping (Wanted/Dread, havens, marques) or hunt pirates for lawful bounties; resolve ambushes & interdictions. You build lasting history with named <b>pirate bands</b> (🏴‍☠️ Pirate Contacts): ally with them, spare them, pay tributes or gift valued cargo to raise their collaboration — friendlier crews take a smaller loot cut, rally readily, and hire on cheaper (and more loyally) for 🛡️ Escort runs. Your Dread earns their respect; killing them earns their hatred.</li>
      <li>🛡️ <b>Escort</b> (expert) — take a convoy contract and command a whole fleet: <b>pool every ship's firepower</b> and split it equally across the attackers you target. Each attacker telegraphs who it's <b>aiming at</b> (raiders hunt freighters, interceptors your biggest guns, gunships your flagship, and a ☠️ leader anchors tough waves) — kill the one about to hit cargo first, and use the <b>🛡️ Screen</b> stance to have escorts body-block the freighters. Each leg is a cycle on the clock and burns fuel, and the lanes grow more dangerous as you near port. Keep the freighters alive for the full fee; only your flagship can field-repair. Set each vessel's <b>combat stance</b> — ⚔️ Aggressive (more firepower), ⚖️ Balanced, or 🛡️ Defensive (soak hits) — and buy up to <b>3 levels of fit</b> for it, paid from your hold (🔫 weapons · 🛸 drones · 🧠 AI cores); bigger vessels cost more, freighters cap at Lv2, and switching stance is free. After accepting, you get a <b>prep window</b>: hunt pirates at the route's ends in the ⚔️ Raider tab to lower the convoy's threat (the fee stays the same) — but a contract <b>deadline</b> in cycles limits how long you can prepare. Completed runs raise your <b>Escort Guild</b> rank — better pay and a larger fleet. Friendly pirate bands may also post <b>🏴‍☠️ smuggling runs</b> here — carry their contraband for fat pay and deep crew standing, but you'll pick up Wanted heat, anger the destination's authorities, and earn no guild credit (bail and you'll burn the crew). Unlocks once you've proven yourself in combat.</li>
      <li>🏴‍☠️ <b>Contacts</b> — manage your loose <b>brotherhood</b> of pirate bands: see each crew's standing, personality, feuds, location and history; <b>tag</b> them (⭐ Brotherhood, 🟢 Ally, 👁️ Watch, 🔴 Rival) and the mark follows their name everywhere; pay tributes or gift cargo to win them over. <b>📣 Call for support</b> to summon a crew — those in your system fall in at once, distant ones travel in over a cycle and then stand by to join a raid (as an ally) or an escort (as a free volunteer). Tell a standing-by crew to <b>🛰️ Follow</b> and they'll jump where you jump for a stretch, or <b>✖ Stand down</b> to send them home early. The tab has three sub-views: <b>🤝 All contacts</b>, <b>📍 Around here</b> (crews based in this system and how lawless it is), and <b>📜 Mandates</b> — commission a crew to work a system for a set run: <b>🎯 cull pirates</b> or <b>🛡️ guard the lanes</b> (lawful — thins out pirate activity there) or <b>🏴 prey on shipping</b> (piracy in your name — fattest cut, but Wanted climbs and the locals seethe, <i>unless you hold a 📜 letter of marque against that faction, which makes it sanctioned — no Wanted</i>). You pay a fee up front and bank a cut of the take when the run ends. Some crews hold <b>blood feuds</b> and won't serve alongside their rival — you can settle it: a cheap <b>🕊️ Truce</b> sets the feud aside for a few cycles so they'll serve together for now, or a full <b>🤝 Broker peace</b> ends it for good (the fee scales with the feud's depth and eases with your standing &amp; Dread). Friendlier bands take a smaller loot cut, hire cheaper, and answer calls readily. Every so often an exceptional band <b>rises</b> — carving a <b>👑 haven</b> out of a lawless world it commands, growing tier by tier (and in rank) the longer that world stays lawless, and quietly withering if you keep it pacified. It's still a normal band underneath — ally, feud, hire, mandate with it exactly as any other — but a haven-bearing crew is a named, escalating threat: shown on its Contacts card, on its world's 🪐 Galaxy pill, and on the sidebar's Operations board. Appears once you've crossed a pirate band.</li>
      <li>🚀 <b>Ship</b> — outfit your ship with upgrade modules.</li>
      <li>📋 <b>Operations</b> (sidebar) — a live board of everything running in the background: fleet missions, convoys &amp; construction, pirate mandates, your active escort/smuggling run, a letter of marque, crews standing by / inbound / following, plus your active ✨ Fortunes (with clear buttons) and 📡 signals. Each row shows a cycle countdown and clicks through to the relevant tab, so nothing you set in motion gets forgotten.</li>
    </ul>

    <h4>Header buttons</h4>
    <p style="margin:0 0 6px 0">⟲ <b>New</b> / 🌍 <b>Colonize</b> start fresh runs · 🎮 <b>Custom Start</b> picks your opening, a Sprint/Standard/Marathon campaign length, and an optional ☠️ <b>Ironman</b> challenge (disables 📂 Load for that run) · 🔑 <b>Seed</b> shows this sector's shareable code and can start a new game from any code (yours or a friend's) — the exact same frontier ring and lane graph, every time · 📖 <b>Log</b> downloads your captain's log (a dossier you can hand to an AI to write your biography or a novel).</p>

    <h4>Links</h4>
    <p style="margin:0">
      <a href="${REPO_URL}" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📦 GitHub repository</a> ·
      <a href="${REPO_URL}/issues" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">🐞 Report a bug / request a feature</a> ·
      <a href="${REPO_URL}#readme" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">📖 README</a>
    </p>
    <h4>Save &amp; Load</h4>
    <p style="margin:0 0 6px">Your game autosaves in this browser. Use <b>💾 Save</b> (top bar) to download a save file you own — a backup, or to carry your run to another browser or machine — and <b>📂 Load</b> to restore one.</p>
    <h4>Sound</h4>
    <p style="margin:0 0 6px">Procedural sound effects play on trades, combat, travel and big moments. Toggle them with <b>🔊 Sound</b> in the Captain's Console (bottom-left).</p>
    <h4>E-ink mode</h4>
    <p style="margin:0 0 6px">Reading on a Kindle Scribe or other e-reader? Tap <b>📖 E-ink mode</b> in the Captain's Console for a high-contrast black-on-white display — gradients, glows and animations are stripped for crisp grayscale legibility. Tap <b>🌙 Color mode</b> to switch back. Your choice is remembered.</p>
    <h4>Progression &amp; Guided Mode</h4>
    <p style="margin:0 0 6px">To avoid overload, features reveal as you grow: the market starts with raw &amp; refined goods (the rest opens when you first manufacture <b>Medicine</b>); the galaxy shows worlds within sensor range and widens as you travel; tabs like <b>Raider</b> and <b>Politics</b> arrive as your trade empire matures; and colony build options stage in by tier. The <b>🧭 Next Steps</b> panel in 🎯 Missions always shows what unlocks next and how. Veteran saves keep everything they've already earned.</p>
    <p style="margin:0"><button class="btn btn-sm" onclick="toggleShowAllTabs();toggleHelp();toggleHelp()">${typeof S!=="undefined"&&S.showAllTabs?"↩️ Switch to Guided mode (hide features until earned)":"👁️ Show everything now (reveal all features)"}</button></p>
    <p style="opacity:.6;font-size:12px;margin-top:10px">Stellar Frontier v${typeof APP_VERSION!=="undefined"?APP_VERSION:""} · made with Claude. Tip: press <b>1-9</b> to jump to a tab, <b>Enter/Space</b> to end the cycle, <b>Esc</b> to close this help.</p>
  `;
}
/* ---- Generic centered modal overlay, shared by Help and What's New.
   Clicking the backdrop, or calling show again with the same id, closes it. ---- */
function showModal(id, html) {
  if (typeof document === "undefined" || !document.body) return;
  const existing = document.getElementById(id);
  if (existing) { existing.remove(); return; }
  const el = document.createElement("div");
  el.id = id;
  el.className = "modal-overlay";
  el.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(2,6,23,.80);display:flex;"
    + "align-items:center;justify-content:center;padding:20px";
  el.innerHTML = `<div style="max-width:680px;max-height:85vh;overflow:auto;background:#0f172a;`
    + `border:1px solid var(--accent,#38bdf8);border-radius:12px;padding:22px 24px;color:#e2e8f0;`
    + `box-shadow:0 20px 60px rgba(0,0,0,.6)" onclick="event.stopPropagation()">${html}</div>`;
  el.addEventListener("click", () => el.remove());            // click backdrop to dismiss
  document.body.appendChild(el);
}
function toggleHelp() { showModal("help-overlay", helpHTML()); }
function changelogHTML() {
  const rows = CHANGELOG.map(c => `<li style="margin-bottom:8px"><b class="c" style="color:var(--gold,#ffd166)">v${c.version}</b> — ${c.notes}</li>`).join("");
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🆕 What's New</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleChangelog()">✕ Close</button>
    </div>
    <p style="opacity:.85">Recent updates to Stellar Frontier, newest first.</p>
    <ul style="line-height:1.5;margin:10px 0 0 18px;padding:0">${rows}</ul>
    <p style="opacity:.6;font-size:12px;margin-top:14px">
      <a href="${REPO_URL}/commits/main" target="_blank" rel="noopener" style="color:var(--accent,#38bdf8)">Full commit history</a>
    </p>
  `;
}
function toggleChangelog() { showModal("changelog-overlay", changelogHTML()); }
/* ---- Keyboard shortcuts: 1-9 jump to that tab, Enter/Space ends the cycle,
   Esc closes any open modal overlay. Ignored while typing in a field or while
   some other control already has keyboard focus, so we never steal Enter/Space
   from a focused button or hijack digits out of a quantity box. ---- */
function handleShortcutKey(e) {
  if (typeof document === "undefined") return;
  if (e.key === "Escape") { const m = document.querySelector(".modal-overlay"); if (m) m.remove(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".modal-overlay")) return;
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON"
      || (document.activeElement && document.activeElement.isContentEditable)) return;
  if (e.key >= "1" && e.key <= "9") {
    const tabs = Array.from(document.querySelectorAll(".tab")).filter(t => t.style.display !== "none");
    const btn = tabs[+e.key - 1];
    if (btn) { e.preventDefault(); setTab(btn.dataset.tab); }
  } else if (e.key === "Enter" || e.key === " ") {
    const btn = document.getElementById("endTurnBtn");
    if (btn) { e.preventDefault(); btn.click(); }
  }
}
function startVersionWatch() {
  if (typeof window === "undefined") return;
  checkVersion();                                          // once on load
  setInterval(checkVersion, 5 * 60 * 1000);                // every 5 minutes
  window.addEventListener("focus", checkVersion);          // and whenever the player returns
  window.addEventListener("keydown", handleShortcutKey);
}
function promptSeedNewGame() {
  if (typeof prompt !== "function") return;
  const current = seedCodeFor(S.frontierSeed);
  const input = prompt(`This sector's code is ${current} — share it so someone else can generate the exact same frontier ring and lane graph.\n\nStart a NEW game with this code (replays the same sector), enter a different code, or clear the field for a random sector. Current progress will be lost either way:`, current);
  if (input === null) return;   // cancelled — no game started, nothing changed
  newGame(undefined, input.trim() || undefined);
}
function newGame(mode, seedCode, opts = {}) {
  const colony = mode === "colony", politics = mode === "politics";
  let msg = colony
    ? "Start in Colonization mode? You'll skip the trading phase and begin on a frontier world with the Colonial Charter, the capital and the materials to found your first colony right away. Current progress will be lost."
    : politics
    ? "Start in Politics mode? You'll skip the trading grind and begin as a fledgling politician — with the Galactic Charter, a campaign chest, some influence and your own party. Current progress will be lost."
    : "Start a new game? Current progress will be lost.";
  const extras = [];
  if (opts.ironman) extras.push("☠️ Ironman");
  if (opts.lengthMult && opts.lengthMult < 1) extras.push("🏃 Sprint length");
  if (opts.lengthMult && opts.lengthMult > 1) extras.push("🏔️ Marathon length");
  if (extras.length) msg += ` — ${extras.join(", ")}.`;
  if (typeof confirm === "function" && !confirm(msg)) return;
  for (let i = PLANETS.length - 1; i >= 0; i--) { if (PLANETS[i].frontier) PLANETS.splice(i, 1); }   // drop the previous run's frontier ring — PLANETS survives a mid-session New Game, unlike a page reload
  S = freshState({ colonyStart: colony, politicsStart: politics, seed: seedFromCode(seedCode), ironman: opts.ironman, lengthMult: opts.lengthMult });
  generateFrontierRing();   // regenerate against the (possibly custom) seed just rolled/entered above
  rollPrices();
  if (colony) {
    log(`🌍 Colonization charter granted. You arrive at <span class="c">${currentPlanet().name}</span> with capital and supplies — found your first colony.`, "event");
  } else if (politics) {
    log(`🏛️ You enter public life at <span class="c">${currentPlanet().name}</span> — a charter, a war chest and a party of your own. Build your machine.`, "event");
  } else {
    log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`);
  }
  if (S.ironman) log("☠️ Ironman run — 📂 Load is disabled for this game. Live with your choices.", "event");
  jotOpening(colony ? "colony" : politics ? "politics" : "trade");
  if (colony) unlock("colonies", false); if (politics) unlock("politics", false);
  checkUnlocks(true);
  applyIronmanUI();
  saveGame(); renderAll(); setTab(colony ? "colonies" : politics ? "politics" : "galaxy");
}
/* ---- Custom Start: pick opening + campaign length + optional Ironman
   challenge, all in one modal, without touching the existing one-click
   ⟲ New / 🌍 Colonize buttons other players already rely on. ---- */
function customStartHTML() {
  return `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <h2 style="margin:0">🎮 Custom Start</h2>
      <button class="btn btn-sm" style="margin-left:auto" onclick="toggleCustomStart()">✕ Close</button>
    </div>
    <p style="opacity:.85">Pick how this run begins. Starting will replace your current game.</p>
    <h4>Opening</h4>
    <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0 16px">
      <label><input type="radio" name="cs-mode" value="trade" checked> 💱 Trading — the default start</label>
      <label><input type="radio" name="cs-mode" value="colony"> 🌍 Colonization — skip to founding a colony</label>
      <label><input type="radio" name="cs-mode" value="politics"> 🏛️ Politics — start with a party and a war chest</label>
    </div>
    <h4>Campaign length</h4>
    <div style="display:flex;flex-direction:column;gap:6px;margin:8px 0 16px">
      <label><input type="radio" name="cs-length" value="0.6"> 🏃 Sprint — shorter net-worth &amp; colony goals</label>
      <label><input type="radio" name="cs-length" value="1" checked> ⚖️ Standard</label>
      <label><input type="radio" name="cs-length" value="1.6"> 🏔️ Marathon — bigger net-worth &amp; colony goals</label>
    </div>
    <h4>Challenge</h4>
    <div style="margin:8px 0 16px">
      <label><input type="checkbox" id="cs-ironman"> ☠️ Ironman — disables 📂 Load for this run. Live with your choices.</label>
    </div>
    <button class="btn btn-primary" onclick="beginCustomStart()">🚀 Begin</button>
  `;
}
function toggleCustomStart() { showModal("customstart-overlay", customStartHTML()); }
function beginCustomStart() {
  const modeEl = document.querySelector('input[name="cs-mode"]:checked');
  const lengthEl = document.querySelector('input[name="cs-length"]:checked');
  const ironmanEl = document.getElementById("cs-ironman");
  const mode = modeEl ? modeEl.value : "trade";
  const lengthMult = lengthEl ? parseFloat(lengthEl.value) : 1;
  const ironman = !!(ironmanEl && ironmanEl.checked);
  const overlay = document.getElementById("customstart-overlay");
  if (overlay) overlay.remove();
  newGame(mode, undefined, { lengthMult, ironman });
}
/* ---- Ironman disables 📂 Load for the current run — refresh the button
   whenever a game starts (page load or a mid-session Custom Start). ---- */
function applyIronmanUI() {
  if (typeof document === "undefined") return;
  const btn = document.getElementById("loadSaveBtn");
  if (!btn) return;
  btn.disabled = !!S.ironman;
  btn.title = S.ironman
    ? "Ironman run — loading a save is disabled. Live with your choices."
    : "Load a game from a save file on your disk (replaces the current game)";
}
function jotOpening(mode) {
  const p = currentPlanet();
  const worlds = PLANETS.filter(isVisible).map(x => x.name).join(", ");   // an opening journal entry shouldn't spoil undiscovered worlds
  const intro = mode === "colony" ? "granted a Colonization charter to tame a frontier world"
    : mode === "politics" ? "entering public life with a party and a war chest"
    : "a free trader with a ship and a dream";
  jot(`The voyage begins at ${p.name} — ${intro}. The charted sector: ${worlds}.`, "origin");
}
function init() {
  const isNewGame = !loadGame();
  if (isNewGame) S = freshState();
  if (!S.frontierSeed) S.frontierSeed = Math.floor(Math.random() * 2**31);   // backfill for saves from before the frontier ring
  if (!S.laneSeed) S.laneSeed = deriveLaneSeed(S.frontierSeed);              // backfill for saves from before the lane graph — derived, so its Sector Code is already correct
  if (!S.coreSeed) S.coreSeed = deriveCoreSeed(S.frontierSeed);              // backfill for saves from before core variance — derived, so its Sector Code is already correct
  applyCoreVariance(S.coreSeed);   // PLANETS is static source, re-declared fresh on every load — reapply this save's variance every time, same as the lane graph
  generateFrontierRing();   // procedural worlds beyond the charted 20 — deterministic from the seed, safe to call every load
  if (isNewGame) { rollPrices(); log(`Welcome, Captain. Your journey begins on ${currentPlanet().name}.`); jotOpening("trade"); }
  if (!S.prices || !S.prices[S.location]) rollPrices();
  if (!S.bases) S.bases = {};   // backfill for older saves
  Object.values(S.bases).forEach(b => {
    if (b.trade === true) b.trade = { on: true, exp: {}, imp: {}, cols: {} };
    else if (!b.trade || typeof b.trade !== "object") b.trade = { on: false, exp: {}, imp: {}, cols: {} };
    else { b.trade.exp = b.trade.exp || {}; b.trade.imp = b.trade.imp || {}; b.trade.cols = b.trade.cols || {}; }
  });
  if (!Array.isArray(S.fx)) S.fx = [];   // backfill Fortunes (temporary boons/banes)
  if (!Array.isArray(S.signals)) S.signals = [];   // backfill discoverable signals
  if (!S.fxSeen) S.fxSeen = {};                     // backfill Fortunes almanac
  if (!S.fxMastery) S.fxMastery = {};               // backfill almanac mastery
  if (!Array.isArray(S.mandates)) S.mandates = [];   // backfill pirate mandates
  if (!Array.isArray(S.fleet)) S.fleet = [];         // backfill player fleet
  if (!S.battleGroupPosture) S.battleGroupPosture = "balanced";
  if (!S.factionRel) S.factionRel = {};
  ensureFactionRel();   // backfill any pairs missing from an older save
  if (!S.territoryControl) S.territoryControl = {};
  if (!S.territoryFlips) S.territoryFlips = {};
  replayTerritoryFlips();   // PLANETS is static source, re-declared fresh on every load — reapply any recorded seizures
  if (S.escort && Array.isArray(S.escort.fleet)) S.escort.fleet.forEach(sh => { if (!sh.fit) sh.fit = { aggressive: 0, balanced: 0, defensive: 0 }; if (!sh.stance) sh.stance = "balanced"; });   // migrate old outfit fleets to stance/fit
  if (!S.colonies) S.colonies = {};
  Object.values(S.colonies).forEach(c => { if (!c.orders) c.orders = {}; if (c.unrest == null) c.unrest = 0; if (c.faction === undefined) c.faction = null; if (!c.idle) c.idle = {}; });
  if (!S.discovered) S.discovered = {};
  if (!S.contracts) { S.contracts = []; S.contractSeq = S.contractSeq || 0; }
  if (!S.pol) S.pol = { popularity: 0, legitimacy: 0, heat: 0, slush: 0 };  // backfill politics meters
  if (!S.orgs) S.orgs = {};
  if (!S.policies) S.policies = {};
  if (S.floor === undefined) S.floor = null;
  if (!S.planetLaws) S.planetLaws = {};
  if (S.invest === undefined) S.invest = null;
  if (S.jail == null) S.jail = 0;
  if (S.office == null) S.office = S.perks.governor ? 3 : S.perks.senator ? 2 : 0;  // migrate from old perks
  if (S.term == null) S.term = 0;
  if (S.officePath === undefined) S.officePath = null;
  if (S.legacyTitle === undefined) S.legacyTitle = null;
  if (!S.reserves) S.reserves = {};
  if (!S.crises) S.crises = {};
  if (!S.journal) S.journal = [];
  if (!S.pirates) S.pirates = {};
  if (S.pirateCalm == null) S.pirateCalm = 0;
  if (S.encounter === undefined) S.encounter = null;
  if (!S.unlocked) { S.unlocked = {}; checkUnlocks(true); }   // veterans keep everything they've earned, silently
  if (S.showAllTabs == null) S.showAllTabs = false;
  if (S.sound == null) S.sound = true;
  if (S.eink == null) S.eink = false;
  if (S.pirateIntel === undefined) S.pirateIntel = null;
  if (S.expedition === undefined) S.expedition = null;
  if (S.spire === undefined) S.spire = null;
  if (S.pirate && S.pirate.bountyKills == null) { S.pirate.bountyKills = 0; S.pirate.bountyEarned = 0; }
  // backfill every commodity added since this save was made (drones, ai, antimatter,
  // plasmatorp, ...) and repair NaN-corrupted stocks — an undefined S.res[c] slips
  // straight past guards like `S.res[c] < qty` and poisons `+=` into NaN
  if (S.res) CARGO_IDS.forEach(c => { if (S.res[c] == null || !Number.isFinite(S.res[c])) S.res[c] = 0; });
  if (!S.pollution) S.pollution = {};
  if (S.climate == null) S.climate = 0;
  if (!S.pirate) S.pirate = { wanted: 0, dread: 0, hull: 100, raids: 0, plundered: 0, commissionsDone: 0 };
  if (S.pirate.commissionsDone == null) S.pirate.commissionsDone = 0;
  initSubsys();
  if (!S.pirate.wuse) S.pirate.wuse = {};
  if (!S.combat) S.combat = { posture: "balanced", offense: 50, target: "hull", advanced: false };
  if (S.prey === undefined) S.prey = null;
  if (S.preyChoices === undefined) S.preyChoices = null;
  if (S.allies === undefined) S.allies = null;
  if (S.interdiction === undefined) S.interdiction = null;
  if (S.haven === undefined) S.haven = null;
  if (S.escort === undefined) S.escort = null;
  if (S.escortRep == null) S.escortRep = 0;
  if (!S.pirateBands) S.pirateBands = {};
  if (S.commission === undefined) S.commission = null;
  UPGRADES.forEach(u => { if (S.upgrades[u.id] == null) S.upgrades[u.id] = 0; });  // backfill new upgrades (cannons)
  if (!S.trim) S.trim = "balanced";
  if (S.trimRefit === undefined) S.trimRefit = null;
  if (S.ironman == null) S.ironman = false;          // backfill for saves from before Custom Start
  if (S.lengthMult == null) S.lengthMult = 1;
  syncObjectives();
  checkMilestones(true);   // veteran saves silently claim whatever they've already earned
  if (!S.disc) S.disc = {}; if (!S.made) S.made = {}; if (S.stats && S.stats.sales == null) S.stats.sales = 0; checkUnlocks(true); checkDisclosure(true); applyTabVisibility();
  applyEink();
  document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => setTab(t.dataset.tab)));
  document.getElementById("endTurnBtn").addEventListener("click", () => endTurn());
  // Captain's Console — game actions live in the sidebar, keeping the top bar
  // to just resources and the cycle button.
  const menu = document.getElementById("gameMenu") || document.querySelector(".brand");
  [
    { label: "⟲ New",      title: "New game (trading start)",                                                                            fn: () => newGame() },
    { label: "🌍 Colonize", title: "New game — skip trading, start ready to colonize",                                                    fn: () => newGame("colony") },
    { label: "🎮 Custom Start", title: "Pick your opening, campaign length, and an optional Ironman challenge",                            fn: () => toggleCustomStart() },
    { label: "🔑 Seed",     title: "View this sector's code, or start a new game from a specific one",                                     fn: () => promptSeedNewGame() },
    { label: "📖 Log",      title: "Download your captain's log — a narrative dossier you can hand to an AI to write your biography or a novel", fn: () => downloadJournal() },
    { label: "💾 Save",     title: "Save this game to a file on your disk (backup, or move between browsers/machines)",                     fn: () => exportSave() },
    { label: "📂 Load",     title: "Load a game from a save file on your disk (replaces the current game)",                                fn: () => importSave(), id: "loadSaveBtn" },
    { label: soundLabel(), title: "Toggle sound effects", fn: () => toggleSound(), id: "soundToggleBtn" },
    { label: einkLabel(), title: "High-contrast black-on-white mode for e-ink readers (Kindle Scribe etc.)", fn: () => toggleEink(), id: "einkToggleBtn" },
    { label: "🆕 What's New", title: "Recent updates to Stellar Frontier",                                                                  fn: () => toggleChangelog() },
    { label: "❓ Help",     title: "How to play, and links to the project",                                                                fn: () => toggleHelp() },
  ].forEach(b => {
    const el = document.createElement("button");
    el.className = "btn btn-sm"; el.textContent = b.label; el.title = b.title;
    if (b.id) el.id = b.id;
    el.addEventListener("click", b.fn); menu.appendChild(el);
  });
  // (No console button for a politics start — careers switch freely in-game; the
  //  Politics tab offers an "Enter Public Life" kickstart instead.)
  applyIronmanUI();
  renderAll(); setTab("galaxy");
  // greet a returning player with what changed since they last played; a brand-new
  // game has nothing to compare against, so it just silently records the version
  if (!isNewGame && S.lastSeenVersion !== APP_VERSION) toggleChangelog();
  S.lastSeenVersion = APP_VERSION;
  saveGame();
  startVersionWatch();
}
window.addEventListener("DOMContentLoaded", init);

Object.assign(window, {
  travel, buyQty, sellQty, buyMax, sellAll, setMarketSort, sellEntireHold, extract, salvage, produce,
  research, researchTech, doPolitics, doMission, buyUpgrade, setShipTrim, setDecree,
  buildBase, buildModule, depositQty, withdrawQty, storeAllCargo, fulfilContract,
  colonize, buildColonyBuilding, setTax, colonyDeposit, colonyWithdraw, setOrder, launchExpedition, newGame, toggleGalaxyFilter,
  startProductionSurge, giveMoralePerk,
  launchSpireProject, contributeToSpire, contributeSpireTech, spireLegacy,
  foundOrg, upgradeOrg, runOrgAbility,
  proposeBill, lobbyFaction, bribeFaction, callVote, repealPolicy,
  investLawyer, investBribe, investSpin, investBury, investStrongarm, investScapegoat, faceTrial,
  runForElection, seekAppointment, stageCoup, lobbyLaw, enterPublicLife,
  donateRelief, donateReliefQty, gougeSell, gougeSellQty, lootCrisis, downloadJournal,
  prowl, raidAttack, raidNoQuarter, raidExtort, raidDisengage, raidVolley, raidCallAllies, raidSpareRecruit, raidSummonOnCall, repairShip, raidToggleTarget, raidFocusTarget,
  clearFx, investigateSignal, buySignalScan,
  setBandTag, callBandSupport, bandFollow, bandStandDown, escortRallyOnCall,
  commissionMandate, cancelMandate, setMandateField, reconcileBands, brokerTruce,
  orderShip, scrapShip, repairFleetShip, reassignShipyard, upgradeLoadout, assignFleetMission, recallFleetMission, setFleetMissionField, raidSummonFleet, escortRallyFleet,
  assignLogistics, recallLogistics, setFleetLogiField, assignPatrol, recallPatrol,
  deployBattleGroup, recallBattleGroup, setBattleGroupPosture, setBattleGroupFormation,
  acceptEscort, refreshEscortOffers, escortAdvance, escortFire, escortRepair, escortFleetRepair, escortToggleTarget, escortFocus, setEscortPosture, setEscortTarget, escortBreakOff, abortEscort, setVesselStance, upgradeVessel, escortBraceRound, escortRecruitBand, escortDismissBand,
  giftBandCredits, giftBandCargo,
  navyBribe, navyFight, navySurrender, settleWarrants,
  fence, fenceAll, fenceQty, fenceAllPlunder,
  establishHaven, upgradeHaven, layLow, havenStashAll, havenTakeAll, relocateHaven,
  acceptCommission, acceptCommissionRemote, pirateLegacy, marshalLegacy, checkVersion, toggleHelp, toggleShowAllTabs, toggleEink,
  exportSave, importSave, importSaveText, parseSaveText, buildSaveText, toggleBaseTrade, setBaseTradeGood, setBaseTradeColony, baseMarketBuy, baseMarketSell, baseBuyQty, baseSellQty,
  sfx, toggleSound,
  alignColony, colonyIndependence, toggleColonyProcess,
  setSubView,
  huntPirates, engageTarget, standDown, encounterPay, encounterFlee, encounterFight, deepScan, repairSubsys, repairAll, buyPirateMap,
  setCombatPosture, setCombatOffense, setCombatTarget, fieldRepair,
});

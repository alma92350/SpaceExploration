/* ============================================================
   STELLAR FRONTIER — frontier operations
   Three smaller systems bundled together: the Logistics Network
   (automated colony supply via Spaceports — redistributes surplus
   between your colonies, then buys the rest on the open market),
   Exploration (surveying and probing for hidden worlds), and Win
   Condition tracking (net worth, the four legacy objectives, and the
   broader Milestones checklist). None of the three is large enough to
   justify its own file, and none has a closer natural home among the
   files already split out — colonization.js and galaxygen.js were
   already merged by the time these were identified as leftovers.

   Loaded after fortunes.js, before game.js. S, log, toast, sfx, jot,
   announce, fireworks, fmt, actionsLeft, useAction, afterAction,
   endTurn and every render* function still live in game.js at this
   point in the split — safe, since every function here is only
   CALLED later, once every script has finished loading, same pattern
   as every prior slice.
   ============================================================ */

"use strict";

/* ============================================================
   LOGISTICS NETWORK  (automated colony supply via Spaceports)
   ============================================================ */
const COLONY_SUPPLY = ["biomass", "energy", "alloys", "medicine", "goods", "luxury", "fuel"];  // staples every colony can order by default
// everything the network will carry for a given cycle: staples, plus anything
// any networked colony stores or has ordered — so mines feed factories too
function networkGoods(nets) {
  const set = new Set(COLONY_SUPPLY);
  nets.forEach(([, c]) => {
    Object.entries(c.orders || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
    Object.entries(c.storage || {}).forEach(([k, v]) => { if (v > 0) set.add(k); });
  });
  return STORE_IDS.filter(c => set.has(c));
}
function spaceportTier(col) { return col.buildings.spaceport || 0; }
function colonyNetworked(col) { return spaceportTier(col) > 0; }
function logisticsFee(col) {
  let fee = 0.30 - spaceportTier(col) * 0.05;
  if (col.faction) fee -= col.faction === "frontier" ? 0.15 : 0.10;   // bloc trade routes
  fee -= colonyHaulDiscount(colonyPidOf(col));                        // your own freighters haul it cheaper
  return Math.max(col.faction ? 0.05 : 0.10, fee);
}
function logisticsCap(col) { return spaceportTier(col) * 40; }  // throughput per commodity per cycle

function setOrder(c) {
  const col = S.colonies[S.location];
  if (!col) return;
  if (!colonyNetworked(col)) return toast("Build a Spaceport to enable logistics.", "bad");
  col.orders = col.orders || {};
  col.orders[c] = Math.max(0, Math.floor(+document.getElementById("auto-" + c).value || 0));
  toast(`Auto-supply ${COM[c].name}: keep ${fmt(col.orders[c])}`, "good");
  afterAction();
}

/* runs each cycle before colonies consume — keeps ordered stock topped up */
function processLogistics() {
  // pirate convoy ambush: an active logistics network draws raiders unless the lanes are calm
  if (!pirateCalm()) {
    const nets0 = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c));
    if (nets0.length) {
      const _np4 = nonFrontierPlanets(); const threat = _np4.reduce((s2, p) => s2 + pirateLevel(p.id), 0) / _np4.length;
      if (Math.random() < 0.04 + threat * 0.03) {
        const [vid, vcol] = nets0[Math.floor(Math.random() * nets0.length)];
        const vp = PLANETS.find(p => p.id === vid);
        const loss = Math.min(S.res.credits, 200 + Math.round(threat * 400));
        S.res.credits -= loss;
        Object.keys(vcol.storage).slice(0, 2).forEach(c => { vcol.storage[c] = Math.floor((vcol.storage[c] || 0) * 0.85); });
        log(`🏴‍☠️ Pirates ambushed a supply convoy near <span class="c">${vp.name}</span> — ${fmt(loss)} cr and cargo lost. Hunt them down to calm the lanes.`, "bad");
      }
    }
  }
  const nets = Object.entries(S.colonies).filter(([id, c]) => colonyNetworked(c));
  if (nets.length < 1) return;
  const used = {};
  nets.forEach(([id]) => { used[id] = {}; });
  let spent = 0, moved = false;

  networkGoods(nets).forEach(c => {
    nets.forEach(([id]) => { used[id][c] = used[id][c] || 0; });
    const parties = nets.map(([id, col]) => ({ id, col, planet: PLANETS.find(p => p.id === id) }));
    const receivers = parties.filter(p => (p.col.orders[c] || 0) > (p.col.storage[c] || 0));
    if (!receivers.length) return;
    const donors = parties.filter(p => (p.col.storage[c] || 0) > (p.col.orders[c] || 0));

    // 1) free redistribution from surplus colonies
    receivers.forEach(r => {
      let need = (r.col.orders[c] || 0) - (r.col.storage[c] || 0);
      need = Math.min(need, logisticsCap(r.col) - used[r.id][c], colonyStorageCap(r.col, r.planet) - colonyStorageUsed(r.col));
      for (const d of donors) {
        if (need <= 0) break;
        if (d.id === r.id) continue;
        let avail = (d.col.storage[c] || 0) - (d.col.orders[c] || 0);
        avail = Math.min(avail, logisticsCap(d.col) - used[d.id][c]);
        const move = Math.max(0, Math.min(need, avail));
        if (move > 0) {
          d.col.storage[c] -= move; r.col.storage[c] = (r.col.storage[c] || 0) + move;
          used[d.id][c] += move; used[r.id][c] += move; need -= move; moved = true;
        }
      }
    });

    // 2) buy any remaining deficit from market (+ logistics fee)
    receivers.forEach(r => {
      let need = (r.col.orders[c] || 0) - (r.col.storage[c] || 0);
      need = Math.min(need, logisticsCap(r.col) - used[r.id][c], colonyStorageCap(r.col, r.planet) - colonyStorageUsed(r.col));
      if (need <= 0) return;
      const unit = Math.round(buyPrice(r.id, c) * (1 + logisticsFee(r.col)));
      const qty = Math.max(0, Math.min(need, Math.floor(S.res.credits / unit)));
      if (qty > 0) {
        S.res.credits -= qty * unit; r.col.storage[c] = (r.col.storage[c] || 0) + qty;
        used[r.id][c] += qty; spent += qty * unit; moved = true;
      }
    });
  });

  if (spent > 0) log(`🚚 Logistics network imported supplies for <span class="c">${fmt(spent)}</span> credits.`, "");
  else if (moved) log(`🚚 Logistics network redistributed supplies between your colonies.`, "");
}

/* ============================================================
   EXPLORATION  (discover hidden worlds)
   ============================================================ */
function isVisible(p) { return isActive(p) && (!p.hidden || S.discovered[p.id]); }
const GALAXY_FUEL_HORIZON = 100;   // worlds within this fuel cost of where you are show on the map (rolls as you travel)
function galaxyKnown(p) {
  if (!isVisible(p)) return false;
  if (S.showAllTabs || S.visited[p.id]) return true;          // always show worlds you've been to
  if (p.hidden && S.discovered[p.id]) return true;            // surveyed worlds stay charted
  if (p.colonizable && !canColonize()) return false;          // colony worlds stay off-map until the Colonial Charter
  return p.id === S.location || fuelCost(p.id) <= GALAXY_FUEL_HORIZON;
}
function undiscoveredHidden() {
  return PLANETS.filter(p => p.hidden && !S.discovered[p.id]).sort((a, b) => a.x - b.x);
}
/* ---------- Survey Expedition — one lever, multiple cycles ----------
   Replaces the old pair of instant one-click rolls (Deep-Space Survey, free
   dice; Probe the Frontier, fuel + dice at the ring): a single expedition
   works toward the NEAREST uncharted signature over several cycles. You pay
   an action and fuel to outfit it, the trip takes real time (longer into the
   deep frontier; a good Research Lab shortens it), and a lawless heading can
   draw an ambush out of the dark en route — but a completed expedition
   ALWAYS charts its world: the risk lives in the journey now, not in a
   die roll after you've already paid. Frontier worlds still turn up richer
   signals on discovery, exactly as the old probe did. */
function frontierArchetypeFor(p) { return (p && p.frontier) ? FRONTIER_ARCHETYPES.find(a => a.tag === p.tag) : null; }
const EXPEDITION_FUEL_COST = 25;
const EXPEDITION_BASE_CYCLES = 3, EXPEDITION_FRONTIER_EXTRA = 2;
function expeditionCycles(target) {
  return Math.max(2, EXPEDITION_BASE_CYCLES + (target.frontier ? EXPEDITION_FRONTIER_EXTRA : 0) - Math.floor((S.upgrades.lab || 0) / 2));
}
function launchExpedition() {
  if (!canColonize()) return toast("Research Colonial Charter to mount survey expeditions.", "bad");
  if (S.expedition) return toast(`A survey expedition is already out — ${S.expedition.cyclesLeft} cycle(s) from its target.`, "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const pool = undiscoveredHidden();
  if (!pool.length) return toast("No uncharted worlds remain.", "bad");
  if (S.res.fuel < EXPEDITION_FUEL_COST) return toast(`Outfitting an expedition needs ${EXPEDITION_FUEL_COST} ⛽.`, "bad");
  useAction();
  S.res.fuel -= EXPEDITION_FUEL_COST;
  const target = pool[0];
  S.expedition = { target: target.id, cyclesLeft: expeditionCycles(target) };
  log(`🛰️ Survey expedition outfitted and away (−${EXPEDITION_FUEL_COST} ⛽) — ${S.expedition.cyclesLeft} cycles to chart the nearest uncharted signature${target.frontier ? " out in the deep frontier" : ""}.`, "event");
  toast(`Expedition away — ${S.expedition.cyclesLeft} cycles`, "event"); sfx("event");
  afterAction();
}
function processExpedition() {
  const e = S.expedition; if (!e) return;
  const target = PLANETS.find(p => p.id === e.target);
  if (!target || S.discovered[e.target]) { S.expedition = null; return; }   // charted some other way meanwhile — stand the crew down
  // en route through thin-law space, survey activity can draw raiders (the old probe's risk, spread over the trip)
  const arch = frontierArchetypeFor(target), lawless = !!(arch && arch.lawless) || target.enforce <= 0.15;
  if (!S.encounter && !S.interdiction && Math.random() < (lawless ? 0.08 : 0.03)) {
    const pirate = genPirate(pirateOpposition(rint(1, 3), -1));
    pirate.toll = Math.round(250 * pirate.level + Math.min(2000, (S.res.credits + cargoValue()) * 0.03));
    S.encounter = pirate;
    log(`🏴‍☠️ Your survey expedition draws a ${pirate.ico} <span class="c">${pirate.name}</span> out of the dark — it demands ${fmt(pirate.toll)} cr, or your cargo. The expedition presses on.`, "bad");
    if (typeof toast === "function") toast(`Expedition drew an ambush: ${pirate.name}!`, "bad");
    announce("🏴‍☠️ Expedition Ambushed", `A ${pirate.name} was drawn to your survey activity. Pay, run, or fight.`, false);
    unlock("raid");
  }
  e.cyclesLeft--;
  if (e.cyclesLeft > 0) return;
  S.expedition = null;
  S.discovered[target.id] = true;
  log(`🛰️ Survey expedition returns triumphant — charted a new world: <span class="c">${target.name}</span> (${target.tag})!`, "event");
  if (typeof toast === "function") toast(`Expedition charted ${target.name}!`, "event");
  announce(`🛰️ ${target.name} Charted`, `${target.tag} — a new world at the ${target.frontier ? "edge of the sector" : "sector's margins"}.`, false);
  fireworks(2200, false);
  if (target.frontier) spawnSignal({ planet: target.id });   // the deep frontier still skews toward richer signals
}

/* ============================================================
   WIN CONDITION
   ============================================================ */
function netWorth() {
  let w = S.res.credits + S.res.fuel * COM.fuel.base;
  CARGO_IDS.forEach(c => w += S.res[c] * COM[c].base);
  Object.values(S.bases).forEach(b =>
    Object.entries(b.storage).forEach(([c, q]) => { w += q * COM[c].base; }));
  Object.values(S.colonies).forEach(col => {
    Object.entries(col.storage).forEach(([c, q]) => { w += q * COM[c].base; });
    w += col.pop * 400;   // a populated colony is itself a major asset
  });
  return Math.round(w);
}
const OBJECTIVE_META = {
  worth:     { emoji: "💰", title: "Tycoon",           sub: "Net worth has passed 75,000 credits!" },
  terraform: { emoji: "🌍", title: "Master Scientist", sub: "Terraforming researched — you can reshape worlds!" },
  governor:  { emoji: "👑", title: "Sector Governor",  sub: "You now rule the entire sector!" },
  explored:  { emoji: "🧭", title: "Master Explorer",  sub: "Every core world in the sector has been charted!" },
  colony:    { emoji: "🏙️", title: "Colonial Founder", sub: "A frontier colony has grown into a thriving capital!" },
};
function winProgress() {
  // Sprint/Marathon game-length choice scales only the two open-ended grind
  // goals; the milestone-y ones (terraform, governor, visit-all) stay fixed —
  // they're a fixed achievement, not a number to inflate or deflate.
  const mult = S.lengthMult || 1;
  const worthTarget = Math.round(75000 * mult / 1000) * 1000;
  const popTarget = Math.max(5, Math.round(25 * mult));
  return {
    worth:     { have: netWorth() >= worthTarget,             label: `Amass ${fmt(worthTarget)} credits net worth` },
    terraform: { have: !!S.techs.terraform,                  label: "Research Terraforming" },
    governor:  { have: !!S.perks.governor,                   label: "Become Sector Governor" },
    explored:  { have: CORE_PLANETS.filter(isActive).every(p => S.visited[p.id]), label: `Visit all ${activeCoreTotal()} core worlds` },
    colony:    { have: Object.values(S.colonies).some(c => c.pop >= popTarget), label: `Grow a colony to ${popTarget}k population` },
  };
}
function syncObjectives() {
  S.achieved = S.achieved || {};
  const wp = winProgress();
  Object.keys(wp).forEach(k => { if (wp[k].have) S.achieved[k] = true; });
  if (Object.values(wp).every(x => x.have)) S.won = true;
}
function checkWin() {
  S.achieved = S.achieved || {};
  const wp = winProgress();
  Object.keys(wp).forEach(key => {
    if (wp[key].have && !S.achieved[key]) {
      S.achieved[key] = true;
      const m = OBJECTIVE_META[key];
      announce(`${m.emoji} ${m.title}`, m.sub, false);
      fireworks(2400, false);
      toast(`🎆 Objective reached: ${m.title}!`, "good");
      log(`🎆 Objective reached: <span class="c">${m.title}</span> — ${m.sub}`, "good");
  jot(`Objective reached: ${m.title} — ${m.sub}`, "milestone");
    }
  });
  if (!S.won && Object.values(wp).every(x => x.have)) {
    S.won = true;
    log("🏆 LEGACY COMPLETE — You have shaped the destiny of the sector!", "good");
  jot("LEGACY COMPLETE — you have shaped the destiny of the sector.", "legacy");
    setTimeout(() => {
      announce("🏆 LEGACY COMPLETE", "You have shaped the destiny of the sector. A legend is born!", true);
      fireworks(8000, true);
      toast("🏆 You win! Legacy complete!", "good");
    }, 1100);
  }
}

/* ---- Milestones: a broader completionist checklist alongside the four
   legacy win conditions above — smaller, earlier goals across every system
   so there's always something nearby to chase. Earning one is permanent,
   even if the underlying stat later drops (e.g. net worth spent back down).
   Shown as a chip list at the bottom of the Missions tab. ---- */
const MILESTONES = [
  { id: "firstjump",    ico: "🚀", name: "First Steps",         desc: "Travel to another world.",                                  test: S => S.stats.jumps >= 1 },
  { id: "firsttrade",   ico: "💹", name: "First Trade",          desc: "Buy or sell on a market.",                                  test: S => S.stats.trades >= 1 },
  { id: "smallfortune", ico: "💰", name: "Small Fortune",        desc: "Reach 10,000 credits net worth.",                           test: () => netWorth() >= 10000 },
  { id: "tourist",      ico: "🧭", name: "Frequent Flyer",       desc: "Visit 5 different worlds.",                                 test: S => Object.keys(S.visited || {}).length >= 5 },
  { id: "firsttech",    ico: "🔬", name: "Eureka",               desc: "Research your first technology.",                          test: S => Object.keys(S.techs || {}).length >= 1 },
  { id: "firstupgrade", ico: "🛠️", name: "Shipwright",           desc: "Install your first ship upgrade.",                          test: S => UPGRADES.some(u => (S.upgrades[u.id] || 0) > 0) },
  { id: "firstbase",    ico: "🏗️", name: "Frontier Outpost",     desc: "Establish your first base.",                                test: S => Object.keys(S.bases || {}).length >= 1 },
  { id: "firstcolony",  ico: "🌍", name: "Founder",              desc: "Found your first colony.",                                  test: S => Object.keys(S.colonies || {}).length >= 1 },
  { id: "firstship",    ico: "⚓", name: "First Command",        desc: "Build your first ship at a colony shipyard.",               test: () => fleetList().length >= 1 },
  { id: "fleetadmiral", ico: "🚢", name: "Fleet Admiral",        desc: "Command a fleet of 5 ships.",                               test: () => fleetList().length >= 5 },
  { id: "firstraid",    ico: "🏴‍☠️", name: "Blooded",             desc: "Complete your first raid.",                                 test: S => (S.pirate && S.pirate.raids) >= 1 },
  { id: "dreadlord",    ico: "💀", name: "Dread Lord",           desc: "Build your Dread to 75.",                                   test: S => (S.pirate && S.pirate.dread) >= 75 },
  { id: "bountyhunter", ico: "🎯", name: "Bounty Hunter",        desc: "Earn your first lawful bounty.",                            test: S => (S.pirate && S.pirate.bountyKills) >= 1 },
  { id: "senator",      ico: "🏛️", name: "Senator",              desc: "Win a seat in the Senate.",                                 test: S => !!(S.perks && S.perks.senator) },
  { id: "orgfounder",   ico: "🤝", name: "Kingmaker",            desc: "Found your first political organization.",                 test: S => Object.keys(S.orgs || {}).length >= 1 },
  { id: "allied",       ico: "⭐", name: "Best Friends Forever", desc: "Reach Allied standing with a faction.",                     test: S => Object.values(S.rep || {}).some(v => v >= 60) },
  { id: "bustcaught",   ico: "🚨", name: "Caught Red-Handed",    desc: "Get hit with a customs bust — and live to tell the tale.", test: S => (S.stats && S.stats.busts) >= 1 },
  { id: "fortuneseeker",ico: "✨", name: "Lucky Star",           desc: "Experience your first Fortune.",                            test: S => Object.keys(S.fxSeen || {}).length >= 1 },
  { id: "spirefounded", ico: "🏛️", name: "Groundbreaking",       desc: "Break ground on the Concordat Spire.",                      test: S => !!S.spire },
  { id: "spirebuilt",   ico: "🏛️", name: "Age of the Concordat", desc: "Complete the Concordat Spire.",                             test: () => spireComplete() },
];
function checkMilestones(silent) {
  if (!S.milestones) S.milestones = {};
  MILESTONES.forEach(m => {
    if (S.milestones[m.id] || !m.test(S)) return;
    S.milestones[m.id] = S.turn;
    if (!silent) {
      toast(`🏅 Milestone: ${m.name}`, "good");
      log(`🏅 Milestone reached — <span class="c">${m.name}</span>: ${m.desc}`, "good");
      sfx("promote");
    }
  });
}

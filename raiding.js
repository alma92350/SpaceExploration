/* ============================================================
   STELLAR FRONTIER — raid resolution & ship repair
   The second half of the old "PIRATE BANDS" section: multi-round raid
   combat (each attack is a free round — no cycle-actions spent, the hunt
   that found the foe already paid that cost), allied bands and coalition
   reinforcements joining a fight, plunder and the pirate/merchant win
   paths, the phased planetary assault (patrol-picket and ground-garrison
   win paths, the patrols→garrison phase change in promoteOrEnd, and the
   coalition answering a raided world's distress call from its OTHER
   worlds), the telegraphed-intent layer (assignRaidIntents/
   raidResolveDepartures: 💥 alpha / 📡 distress / 🚀 flee announcements
   that execute a round later, plus the morale ledger that breaks and
   routs a mauled formation), pre-assault recon and battlefield shaping
   (probePlanetDefenses / hireRaidDiversion / processRaidIntel), sparing
   a beaten crew, ship + subsystem repair (dockside and field patches
   mid-fight), the Wanted/Dread cooldown with its bounty-hunter
   counterplay, and the planetary alert meter's cycle tick
   (processPlanetAlert: peacetime decay + its factionRel nudge while hot;
   the meter's gain side — raisePlanetAlert — lives in combat.js next to
   the defense-generation functions that read it) alongside its commerce
   counterpart (processTradeDisruption: the per-world, per-good price
   meter that raiseLaneAlert/raiseTradeDisruption, both combat.js, feed
   from ordinary lane kills).

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
// not a trickle: once a call lands, the whole available response joins together (capped, for
// balance), matching the Escort tab's wave spawning (spawnEscortWave) rather than a one-per-
// round reveal. Since the intent telegraph (assignRaidIntents below), the call is no longer an
// ambient background roll: a defender visibly 📡 transmits for a round first, and only if it
// survives does this land — `forced` is that execution path (the old 20% roll is kept for any
// direct/legacy caller). Returns whether help actually came, so the caller can log a call that
// went unanswered.
function maybeRescue(prey, forced) {
  if (!prey || prey.isPirate) return false;
  prey.pack = prey.pack || [];
  const room = RESCUE_PACK_CAP - prey.pack.length;
  if (room <= 0) return false;
  const others = prey._others || [];
  const eligible = others.filter(o => !o.isPirate);
  if (!eligible.length) return false;
  if (!forced && Math.random() >= 0.20) return false;
  const reinforcements = eligible.slice(0, room);
  reinforcements.forEach(r => { prey._others = prey._others.filter(o => o !== r); prey.pack.push(r); foeHp(r); });
  const names = reinforcements.map(r => `${classLabel(r)}${FACTIONS[r.faction] ? " (" + FACTIONS[r.faction].name + ")" : ""}`).join(", ");
  log(`🆘 The ${prey.name}'s distress call lands — ${names} answer${reinforcements.length === 1 ? "s" : ""} together! You now face ${prey.pack.length + 1} vessels, all defending as one.`, "bad");
  toast(`Reinforcements: ${reinforcements.map(r => r.name).join(", ")}!`, "bad");
  return true;
}
/* ---------- Coalition reinforcements during a planetary assault ----------
   A raided world screams for help on every open channel, and its coalition answers:
   each round of the assault (either phase) there's a chance vessels from OTHER
   worlds of the same faction — or of factions in 🤝 Alliance with it (factionRelTier,
   sector4x.js) — jump in and join the defense. Capped per assault AND by how many
   hostiles are already on the field, so a long siege escalates without drowning
   the player. Arrivals are heavy response wings (genPlanetPatrol's heavy roll) and
   fight — and die (raidWinPatrol) — like any other space defender, which also means
   phase 2 can't begin until they're swept aside with the rest of the picket. */
const ASSAULT_REINFORCE_CAP = 3;        // vessels per assault that the coalition can send, total
const ASSAULT_REINFORCE_CHANCE = 0.18;  // legacy ambient chance (kept for direct callers; in-fight the 📡 distress-call intent is the real path)
const ASSAULT_FIELD_CAP = 4;            // no arrivals while this many hostiles already hold the field
// a defending faction with a shooting war elsewhere has its fleet committed — one fewer wing
// answers (factionAtWar, sector4x.js). Recon (probePlanetDefenses) surfaces this so attacking
// during someone else's war is a plan, not a coincidence.
function assaultReinforceCap(planet) {
  return Math.max(1, ASSAULT_REINFORCE_CAP - (planet && planet.faction && factionAtWar(planet.faction) ? 1 : 0));
}
// the worlds that would answer: same faction, or one currently in Alliance with it
// (factionRelScore(a,a) is 100, so the tier check alone covers the same-faction case).
// A world whose own lanes are being torn up by a hired diversion (hireRaidDiversion)
// keeps its response wing at home — it drops out of the list entirely.
function assaultCoalitionSources(planet) {
  return PLANETS.filter(o => o.id !== planet.id && isActive(o) && !o.hidden && o.faction && planet.faction &&
      !worldDiverted(o.id) &&
      factionRelTier(factionRelScore(o.faction, planet.faction)) === "alliance")
    .sort((a, b) => ((planet.distances || {})[a.id] || 99) - ((planet.distances || {})[b.id] || 99));
}
function maybePlanetReinforce(forced) {
  const A = S.planetAssault, prey = S.prey;
  if (!A || !prey) return false;
  const planet = PLANETS.find(p => p.id === A.planetId); if (!planet) return false;
  if ((A.called || 0) >= assaultReinforceCap(planet)) return false;
  if (allHostiles(prey).filter(h => h.hp > 0).length >= ASSAULT_FIELD_CAP) return false;
  const sources = assaultCoalitionSources(planet);
  if (!sources.length) return false;
  if (!forced && Math.random() >= ASSAULT_REINFORCE_CHANCE) return false;
  const n = Math.min(rint(1, 2), assaultReinforceCap(planet) - (A.called || 0));
  const arrivals = [];
  for (let i = 0; i < n; i++) {
    const src = sources[Math.min(i, sources.length - 1)];
    const v = genPlanetPatrol(planet, true);              // a heavy response wing, scaled to the world under attack
    v.name = `${src.name} Response Wing`;
    v.faction = src.faction;                              // an ALLIED faction's ship carries its own flag — killing it angers THEM
    v.fromPlanet = src.id;
    prey.pack = prey.pack || [];
    prey.pack.push(v);
    arrivals.push(`${classLabel(v)} <b>${v.name}</b>${src.faction !== planet.faction ? ` (${FACTIONS[src.faction].ico} ${FACTIONS[src.faction].name})` : ""}`);
  }
  A.called = (A.called || 0) + arrivals.length;
  log(`🆘 ${planet.name}'s distress call is answered — ${arrivals.join(", ")} jump${arrivals.length === 1 ? "s" : ""} in from ${arrivals.length === 1 ? "a" : ""} coalition world${arrivals.length === 1 ? "" : "s"} to join the defense!`, "bad");
  toast(`Coalition reinforcements: ${arrivals.length} vessel${arrivals.length === 1 ? "" : "s"}!`, "bad");
  sfx("alarm");
  return true;
}
/* ---------- Telegraphed enemy intent (the anti-attrition layer) ----------
   Mirrors the Escort tab's telegraphed-intent design inside raid combat: at the end of
   every round each surviving hostile may ANNOUNCE its next move, and the move only
   executes a round later — so fights are decided by reading and countering, not by
   volleying into hull bars. Three telegraphs, each with a hard counter:
     💥 alpha    — next shot lands near-double; kill it now, or gut its 🔫 strength
                   (Weapons targeting) so the big hit has nothing behind it
     📡 distress — THE path reinforcements arrive by now (the old ambient per-round
                   rolls are gone from combat): kill the transmitter before it finishes
                   or the call lands — a rescue pack on the lanes, a coalition response
                   wing during a planetary assault. A call can also go UNANSWERED if
                   you've shaped the battlefield (diversions, war, cap spent) — that's
                   your prep paying off, visibly.
     🚀 flee     — drive spooling: it jumps clear at the END of next round unless killed
                   or its 🚀 engines are stripped to 0 (pinned). Replaces the old
                   surprise same-instant flee, and now applies to EVERY hostile, not
                   just the anchor.
   Unexecuted intents persist across your kill-rounds (a transmitting ship keeps
   transmitting while you shoot its wingmen — silencing it means killing IT).
   ---------- Morale & rout ----------
   The group remembers its dead (anchor-carried _group0/_fallen/_leaderDown, copied
   across promotions): lose the leader (an elite, or a battleship+ hull) or half the
   starting force, and the formation BREAKS — every survivor with a live drive rolls
   rout (a flee telegraph) each round, helped along by your Dread. Decapitation and
   terror end fights early; grinding is no longer the only lever. The ground garrison
   (no engines, dug in) never routs. */
const RAID_INTENT_META = {
  alpha:    { ico: "💥", name: "charging an alpha strike", counter: "kill it or gut its 🔫 strength this round — its next hit lands near-double" },
  distress: { ico: "📡", name: "transmitting a distress call", counter: "silence it THIS round or reinforcements answer" },
  flee:     { ico: "🚀", name: "spooling its drive", counter: "kill it or strip its 🚀 engines to 0, or it jumps clear with the loot" },
};
const RAID_ALPHA_MULT = 1.85;           // a charged strike's intensity multiplier
const RAID_DISTRESS_CHANCE = 0.25;      // per eligible defender per round (max one transmitter at a time)
const RAID_ROUT_CHANCE = 0.30;          // per broken survivor per round, + Dread's push below
const RAID_ROUT_DREAD_PUSH = 0.004;     // × your Dread — a feared name shatters broken formations faster
function distressEligible(prey) {
  if (S.planetAssault) {
    const planet = PLANETS.find(p => p.id === S.planetAssault.planetId);
    return !!planet && (S.planetAssault.called || 0) < assaultReinforceCap(planet) && assaultCoalitionSources(planet).length > 0;
  }
  return (prey._others || []).some(o => !o.isPirate) && (prey.pack || []).length < RESCUE_PACK_CAP;
}
function raidGroupBroken(prey) {
  if (!prey) return false;
  const g0 = prey._group0 || 0;
  return !!(prey._leaderDown || (g0 >= 2 && (prey._fallen || 0) >= Math.ceil(g0 / 2)));
}
function assignRaidIntents(prey) {
  if (!prey) return;
  if (prey._group0 == null) prey._group0 = allHostiles(prey).filter(h => h.hp > 0).length + (prey._fallen || 0);
  const hostiles = allHostiles(prey).filter(h => h.hp > 0);
  const broken = raidGroupBroken(prey);
  let caller = hostiles.some(h => h.intent === "distress");   // one transmitter at a time
  const notes = [];
  hostiles.forEach(h => {
    if (h.intent) return;                                     // an unexecuted telegraph stands (it survives your kill-rounds)
    if (!h.ground && (h.engines || 0) > 0 &&
        (foeFleeCheck(h) || (broken && Math.random() < RAID_ROUT_CHANCE + (S.pirate ? S.pirate.dread : 0) * RAID_ROUT_DREAD_PUSH))) {
      h.intent = "flee"; notes.push(`🚀 ${h.name} spools its drive`); return;
    }
    if (!caller && !h.isPirate && distressEligible(prey) && Math.random() < RAID_DISTRESS_CHANCE) {
      h.intent = "distress"; caller = true; notes.push(`📡 ${h.name} starts transmitting a distress call`); return;
    }
    const cls = SHIP_CLASSES[h.cls] || SHIP_CLASSES.corvette;
    if (Math.random() < (h.elite ? 0.35 : cls.str >= 1.7 ? 0.15 : 0.05)) {
      h.intent = "alpha"; notes.push(`💥 ${h.name} charges its weapons`);
    }
  });
  if (notes.length) log(`⚠️ Enemy moves — ${notes.join("; ")}.`, "");
}
// end-of-round departures: every hostile whose 🚀 flee telegraph survived the round jumps
// clear — unless its drive was stripped in the meantime, in which case it's pinned and
// turns back to the fight. Pack members leave first, then the anchor (whose departure
// hands the fight to the survivors, or rolls a planetary assault into its next phase).
function raidResolveDepartures(prey) {
  const leaving = allHostiles(prey).filter(h => h.hp > 0 && h.intent === "flee");
  if (!leaving.length) return;
  const depart = (h) => {
    h.intent = null;
    if ((h.engines || 0) <= 0) {
      log(`🚀 The ${h.ico} ${h.name}'s drive is dead — pinned, it turns back to the fight.`, "good");
      return false;
    }
    if (h.isPirate) { const b = bandById(h.bandId); if (b) bandRepAdd(b, 4); }   // they live to remember you let them go
    log(`🏃 The ${h.ico} ${h.name} lit its drive and jumped clear — the ${h.isPirate ? "bounty" : "haul"} got away.`, "bad");
    toast(`${h.name} escaped!`, "bad");
    return true;
  };
  leaving.filter(h => h !== prey).forEach(h => { if (depart(h)) prey.pack = (prey.pack || []).filter(x => x !== h); });
  if (leaving.includes(prey) && depart(prey)) promoteOrEnd(prey);
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
  const alertBefore = planetAlertLevel(currentPlanet().id);
  pirateKillRewards(prey);
  const share = lootShare();
  const killed = bandById(prey.bandId);
  if (killed) { killed.fought = (killed.fought || 0) + 1; bandRepAdd(killed, -30); }   // blood spilled — collaboration craters
  (S.allies || []).forEach(a => { const b = bandById(a.bandId); if (b) bandRepAdd(b, 4); });  // fought at your side
  const reliefNote = alertBefore > 0 ? ` The world's defense alert eases a little — policing its pirates counts for something.` : "";
  log(`🎯 You destroyed the ${prey.ico} ${prey.name}${killed ? ` of the ${killed.name}` : ""}! Bounty ${fmt(Math.round(prey.bounty * share))} cr + salvage ${taken.join(" ") || "none"}${share < 1 ? ` <span class="hint">(your cut ${Math.round(share * 100)}%)</span>` : ""}. (a lawful kill — no Wanted)${reliefNote}`, "good");
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
  raiseLaneAlert(currentPlanet().id, prey);   // local defense stiffens a little, and the specific trade this ship carried gets scarcer/dearer
  log(`🏴‍☠️ You took the ${prey.ico} ${prey.name}${noQuarter ? " and gave no quarter" : ""}! Plundered ${taken.join(" ") || "no cargo"}${lootShare() < 1 ? ` <span class="hint">(split ${1 / lootShare()} ways)</span>` : ""}.${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""} (Dread +${dread}, Wanted +${wanted})`, "good");
  toast(`Plundered ${prey.name}!`, "good");
  if (betray) revokeCommission(true);
}
// one vessel of a raided world's orbital picket goes down (phase 1 of a planetary assault,
// combat.js's genPlanetPatrol) — salvage and a modest heat bump per kill, deliberately far
// lighter than raidWinPlanet: the picket is the DOOR to the prize, not the prize itself.
// No per-kill commission bounty either — the sack itself (raidWinPlanet) counts once.
function raidWinPatrol(prey, noQuarter) {
  const betray = S.commission && prey.faction === S.commission.patron;
  const taken = plunder(prey);
  S.pirate.dread += noQuarter ? 4 : 2;
  S.pirate.wanted += prey.wantedGain + (noQuarter ? 3 : 0);
  addRep(prey.faction, noQuarter ? -7 : -4);
  clampPirate();
  const A = S.planetAssault;
  const left = S.prey ? allHostiles(S.prey).filter(h => h !== prey && h.hp > 0).length : 0;
  const skies = A && A.phase === "patrols"
    ? (left > 0 ? ` <b>${left}</b> defender${left > 1 ? "s" : ""} still hold${left > 1 ? "" : "s"} the sky.` : "")
    : "";
  log(`💥 You blew the ${prey.ico} ${prey.name} out of ${prey.planetName ? prey.planetName + "'s" : "the"} sky${noQuarter ? " — no survivors" : ""}! Salvage ${taken.join(" ") || "slag only"}.${skies}`, "good");
  if (betray) revokeCommission(true);
}
// beating down a planet's own defenses (combat.js's genPlanetDefense/raidPlanet) is a
// bigger act than robbing one ship: heavier Dread/Wanted and a much deeper rep hit, and the
// real prize is the ground plunder — credits (planetRaidHaul) AND an actual mix of cargo
// hauled out of the world's own warehouses (planetRaidGoods), on top of whatever the
// garrison carried. Only fires once the ground garrison itself falls — phase 2 of the
// assault — so the loot stays gated behind clearing the orbit first.
function raidWinPlanet(prey, noQuarter) {
  const betray = S.commission && prey.faction === S.commission.patron;
  S.planetAssault = null;                                 // the campaign is won — any straggler reinforcements are now just a plain fight
  raisePlanetAlert(prey.planetId, PLANET_ALERT_GAIN_SACK);   // being fully overrun is a harder wake-up call than the assault alone already gave it
  const taken = plunder(prey);
  const planet = PLANETS.find(p => p.id === prey.planetId) || currentPlanet();
  const haul = Math.round(planetRaidHaul(planet) * lootShare());
  S.res.credits += haul;
  const groundGoods = planetRaidGoods(planet, lootShare());   // the surface itself: real cargo hauled from its warehouses, not just credits
  const groundGoodsStr = Object.entries(groundGoods).map(([c, q]) => `${q}${COM[c].ico}`).join(" ");
  const dread = noQuarter ? 22 : 15;
  const sanctioned = applyCommissionRaid(prey);
  const wanted = sanctioned ? (noQuarter ? 15 : 10) : prey.wantedGain + (noQuarter ? 10 : 0);
  S.pirate.dread += dread; S.pirate.wanted += wanted;
  addRep(prey.faction, noQuarter ? -28 : -20);
  if (!sanctioned) addRep("core", -(prey.faction === "core" ? 15 : 8));
  addRep("frontier", 4);
  FACTION_KEYS.filter(f => f !== prey.faction && factionsAreRivals(f, prey.faction)).forEach(f => addRep(f, 3));
  clampPirate();
  log(`🏴‍☠️ You broke ${prey.planetName}'s orbital defenses${noQuarter ? " and gave no quarter" : ""} and sacked the surface! Plundered ${taken.join(" ") || "their war chest"} + ${fmt(haul)} cr in ground plunder${groundGoodsStr ? ` + ${groundGoodsStr} hauled from its warehouses` : ""}${lootShare() < 1 ? ` <span class="hint">(split ${1 / lootShare()} ways)</span>` : ""}.${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""} (Dread +${dread}, Wanted +${wanted})`, "good");
  toast(`Sacked ${prey.planetName}! +${fmt(haul)} cr${groundGoodsStr ? " + cargo" : ""}`, "good");
  if (betray) revokeCommission(true);
}
function promoteOrEnd(prey) {
  if (prey.pack && prey.pack.length) {
    const next = prey.pack.shift();
    next.pack = prey.pack; next._others = prey._others; next._engaged = true; foeHp(next);
    next._group0 = prey._group0; next._fallen = prey._fallen; next._leaderDown = prey._leaderDown;   // the group's morale ledger survives a change of anchor
    S.prey = next;
    log(`Now engaging the ${classLabel(next)} <span class="c">${next.name}</span> — ${next.pack.length + 1} hostile(s) remain.`, "bad");
    return;
  }
  // planetary assault, phase change: the LAST space defender is gone (killed or fled —
  // either way the sky is clear), so the fight rolls down to the surface. The ground
  // garrison steps in as the new engagement; the plunder stays locked behind beating it.
  const A = S.planetAssault;
  if (A && A.phase === "patrols") {
    const planet = PLANETS.find(p => p.id === A.planetId);
    if (planet) {
      A.phase = "garrison";
      const g = genPlanetDefense(planet);
      g.pack = []; g._others = []; g._engaged = true; foeHp(g);
      S.prey = g; S.raidTargets = [];
      log(`🛰️ The skies over <span class="c">${planet.name}</span> are clear — its space defense is spent. Only the ${g.ico} <b>${g.name}</b> now stands between you and the plunder below. Break it to sack the surface.`, "event");
      toast(`${planet.name}'s orbit is yours — ground assault!`, "event");
      sfx("event");
      return;
    }
    S.planetAssault = null;   // the world vanished from the charts mid-fight (shouldn't happen) — fail safe
  }
  clearEngagement();
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
// ---- player reserve: fold yourself into the same Vanguard/Line/Reserve tiering your Battle
// Group already uses (fleet.js's FORMATION_SLOTS/FORMATION_TIERS/shipFormation), so posting
// yourself in Reserve behind your own warships works like Escort's flagship reserve
// (escort.js's escortFrontTier/chooseIntent). Only meaningful once a Battle Group is deployed
// to hold a line in front of you — alone, you're the only target there is, no matter what
// formation you pick, same as a lone Escort flagship with no fleet left to hide behind. ----
function playerFormation() { return FORMATION_SLOTS[S.pirate.formation] ? S.pirate.formation : "line"; }
function setPlayerFormation(slot) { if (!FORMATION_SLOTS[slot]) return; S.pirate.formation = slot; saveGame(); renderAll(); }
function raidFrontTier() {   // frontmost non-empty tier among you + your living Battle Group — mirrors battleGroupFrontTier/escortFrontTier
  const pool = [{ isPlayer: true }, ...battleGroupShips().map(s => ({ isPlayer: false, ship: s }))];
  for (const t of FORMATION_TIERS) {
    const grp = pool.filter(o => (o.isPlayer ? playerFormation() : shipFormation(o.ship)) === t);
    if (grp.length) return grp;
  }
  return [];
}
function raidPlayerFrontline() { return raidFrontTier().some(o => o.isPlayer); }   // stable (no roll) — for the UI badge
// per-shot roll: 85% of the time only the front tier is a valid target, 15% stray fire reaches
// anyone — the same split battleGroupTakeFire/chooseIntent use. No Battle Group means no one to
// hide behind, so you're always exposed regardless of formation (mirrors a solo Escort flagship).
function raidPlayerExposed() {
  if (!battleGroupShips().length) return true;
  const front = raidFrontTier();
  const pool = (front.length && Math.random() < 0.85) ? front : [{ isPlayer: true }, ...battleGroupShips().map(s => ({ isPlayer: false }))];
  return pool.some(o => o.isPlayer);
}
// a salvo can kill more than one hostile at once now (pooled fire split across several targets).
// Non-anchor kills are just spliced out of the pack; if the anchor itself died, reuse the
// existing promoteOrEnd (promotes a surviving pack member, or clears the engagement if none
// remain) — the only case that still needs it. Also the morale ledger: the group remembers
// its dead (raidGroupBroken reads these), and losing an elite or a battleship+ hull marks
// the leader down — the decapitation that breaks a formation outright.
function raidResolveKills(anchor, killed) {
  if (anchor._group0 == null) anchor._group0 = allHostiles(anchor).filter(h => h.hp > 0).length + killed.length + (anchor._fallen || 0);
  anchor._fallen = (anchor._fallen || 0) + killed.length;
  if (killed.some(h => h.elite || h.cls === "battleship" || h.cls === "dreadnought")) anchor._leaderDown = true;
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
    killed.forEach(h => { if (h.isPlanetRaid) raidWinPlanet(h, noQuarter); else if (h.isPlanetPatrol) raidWinPatrol(h, noQuarter); else if (h.isPirate) raidWinPirate(h); else raidWinMerchant(h, noQuarter); });
    raidResolveKills(prey, killed);
    log(`⚔️ You hit ${hits.join("; ")}${dmgNote} — destroyed ${killed.map(h => h.name).join(", ")}!`, "good");
    if (S.prey) assignRaidIntents(S.prey);   // survivors read the slaughter and pick their next moves (existing telegraphs stand)
    return afterAction();
  }
  sfx("fire");
  const incoming = [];
  for (let idx = 0; idx < hostiles.length; idx++) {
    const h = hostiles[idx];
    // a primed 📡 transmitter finishes its call instead of firing — kill it BEFORE this
    // moment or the reinforcements are real. A shaped battlefield can leave it unanswered.
    if (h.intent === "distress") {
      h.intent = null;
      const answered = S.planetAssault ? maybePlanetReinforce(true) : maybeRescue(prey, true);
      incoming.push(`${h.ico} 📡 held fire to transmit${answered ? "" : " — unanswered"}`);
      if (!answered) log(`📡 The ${h.name}'s distress call goes out… and nothing answers. ${S.planetAssault ? "The coalition has no wing left to send." : "No friendly hull is in reach."}`, "good");
      continue;
    }
    const alpha = h.intent === "alpha";
    if (alpha) h.intent = null;
    if (!raidPlayerExposed()) {   // held back in Reserve behind your battle fleet — this shot never reaches you
      incoming.push(`${idx === 0 ? "" : h.ico + " "}${alpha ? "💥ALPHA " : ""}screened by your battle fleet`);
      continue;
    }
    const fs = foeStrikes(h, (idx === 0 ? (noQuarter ? 0.27 : 0.22) : 0.20) * (alpha ? RAID_ALPHA_MULT : 1));
    incoming.push(`${idx === 0 ? "" : h.ico + " "}${alpha ? "💥ALPHA " : ""}−${fs.dmg}${subsysHitLog(fs.subHit)}`);
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
  raidResolveDepartures(prey);            // primed 🚀 drives light off now — pinned ones stay
  if (!S.prey) return afterAction();
  assignRaidIntents(S.prey);              // next round's telegraphs — read them before you volley
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
// ---- board and seize a beaten hull instead of destroying it — needs it pinned (no engines to
// run) AND crippled (same 35% threshold raidCanSpare uses) before a crew gives up their ship.
// A planetary garrison (ground: true) is a fortress, not a hull — never seizable, even though
// genPlanetDefense also zeroes its engines. The prize joins S.fleet as a real warship, its class
// matched off the hostile's own SHIP_CLASSES tag (scout/dreadnought clamp to the nearest hull
// FLEET_SHIPS actually stocks), arriving battle-damaged at the same beaten-down fraction it
// surrendered at. No bounty/full plunder the way a kill pays out — the hull itself is the prize
// — but the consequences (Dread/Wanted/rep) otherwise mirror a normal (non-No-Quarter) kill of
// the same prey type, since seizing a coalition or pirate hull is no less an act than sinking it. ----
const SEIZE_CLASS_MAP = { scout: "corvette", corvette: "corvette", frigate: "frigate", cruiser: "cruiser", battleship: "battleship", dreadnought: "battleship" };
function raidCanSeize() { const p = S.prey; return !!(p && p._engaged && !p.ground && (p.engines || 0) <= 0 && foeHp(p) <= p.maxhp * 0.35); }
function raidSeizeHull() {
  if (!raidCanSeize()) return toast("Pin its engines and beat it down first — a live crew won't surrender an intact hull.", "bad");
  const prey = S.prey;
  const key = SEIZE_CLASS_MAP[prey.cls] || "corvette", def = FLEET_SHIPS[key];
  const hullMax = fleetShipHullMax(def);
  const frac = Math.max(0.25, Math.min(0.5, foeHp(prey) / prey.maxhp));   // arrives as battle-damaged as it surrendered
  const hull = Math.max(1, Math.round(hullMax * frac));
  fleetList().push({ id: "sh" + S.turn + "_" + Math.floor(Math.random() * 1e4), key, name: `Prize ${prey.name}`, home: S.location, status: "idle", hull, hullMax });
  const joinNote = `The ${def.ico} ${def.name} joins your fleet at ${Math.round(hull / hullMax * 100)}% hull.`;
  if (prey.isPirate) {
    S.pirate.dread += 2; clampPirate();
    const p = currentPlanet();
    S.pirates[p.id] = Math.max(0, pirateLevel(p.id) - 1);                 // one less hull in their roster, same flavor as pirateKillRewards
    S.pirateCalm = Math.max(S.pirateCalm || 0, S.turn) + 2;
    const b = bandById(prey.bandId) || bindBand(prey);
    bandRepAdd(b, -15);   // losing a ship stings, even without blood spilled — milder than a kill's −30, harsher than sparing's +20
    log(`⚓ You board and seize the ${prey.ico} ${prey.name}${b ? " of the " + b.name : ""} — its crew abandons ship rather than go down with it. ${joinNote} (Dread +2${b ? `, ${b.name} standing −15` : ""})`, "good");
  } else if (prey.isPlanetPatrol) {
    const taken = plunder(prey);
    S.pirate.dread += 2; S.pirate.wanted += prey.wantedGain; clampPirate();
    addRep(prey.faction, -4);
    log(`⚓ You board and seize the ${prey.ico} ${prey.name} — its crew takes to the escape pods. Salvage ${taken.join(" ") || "slag only"}; ${joinNote} (Dread +2, Wanted +${prey.wantedGain})`, "good");
  } else {
    const betray = S.commission && prey.faction === S.commission.patron;
    const taken = plunder(prey);
    const sanctioned = applyCommissionRaid(prey);
    const wanted = sanctioned ? 0 : prey.wantedGain;
    S.pirate.dread += 5; S.pirate.wanted += wanted; clampPirate();
    addRep(prey.faction, -8);
    if (!sanctioned) addRep("core", -(prey.faction === "core" ? 8 : 5));
    addRep("frontier", 3);
    FACTION_KEYS.filter(f => f !== prey.faction && factionsAreRivals(f, prey.faction)).forEach(f => addRep(f, 2));
    raiseLaneAlert(currentPlanet().id, prey);
    log(`⚓ You board and seize the ${prey.ico} ${prey.name} — its crew takes to the escape pods. Plundered ${taken.join(" ") || "no cargo"}${sanctioned ? ` ⚖️ Sanctioned — ${FACTIONS[S.commission.patron].ico} bounty +${fmt(COMM_BOUNTY)} cr.` : ""}; ${joinNote} (Dread +5, Wanted +${wanted})`, "good");
    if (betray) revokeCommission(true);
  }
  toast(`${def.name} seized — joined your fleet!`, "good"); sfx("event");
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
  if (S.planetAssault) {
    const ap = PLANETS.find(p => p.id === S.planetAssault.planetId);
    log(`🏳️ The assault on <span class="c">${ap ? ap.name : "the planet"}</span> collapses — its defenders regroup, and the plunder below stays out of reach.`, "bad");
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
/* ---------- Cycle tick: planetary alert cools at peace, spooks the sector while hot ----------
   Companion to raisePlanetAlert (combat.js): every world's militarization meter fades a little
   each cycle — MUCH more gently than either of its gain triggers, so a world you keep hitting
   stays measurably fortified for a long stretch, while one you leave alone eventually stands
   down. While a world's alert stays above a real threshold (routine patrols don't spook anyone;
   a visible buildup does), its saber-rattling reads as a threat to the WHOLE sector — every
   cycle it nudges S.factionRel between that world's faction and every other faction a little
   further toward tension, on top of processFactionRelations' own baseline drift (same "a side
   system nudges the shared pool directly" pattern the Concordat Spire already uses). */
const PLANET_ALERT_POLITICAL_THRESHOLD = 25;   // below this, a world's patrols are unremarkable
const PLANET_ALERT_POLITICAL_RATE = 0.5;       // per cycle at max alert; scales down with how alarmed the world actually is
function processPlanetAlert() {
  if (!S.planetAlert) { S.planetAlert = {}; return; }
  Object.keys(S.planetAlert).forEach(pid => {
    const lvl = S.planetAlert[pid];
    const planet = PLANETS.find(p => p.id === pid);
    if (planet && planet.faction && lvl >= PLANET_ALERT_POLITICAL_THRESHOLD) {
      ensureFactionRel();
      const pull = (lvl / PLANET_ALERT_MAX) * PLANET_ALERT_POLITICAL_RATE;
      FACTION_KEYS.forEach(f => {
        if (f === planet.faction) return;
        const key = factionPairKey(f, planet.faction);
        S.factionRel[key] = Math.max(-100, S.factionRel[key] - pull);
      });
    }
    const next = Math.max(0, lvl - PLANET_ALERT_DECAY);
    if (next <= 0) delete S.planetAlert[pid]; else S.planetAlert[pid] = next;
  });
}
// companion decay for the per-good trade-disruption meters (combat.js's raiseTradeDisruption)
// -- no politics hook here, just the same slow fade: a specific good's supply line recovers
// once raiders stop picking off the ships that carry it.
function processTradeDisruption() {
  if (!S.tradeDisruption) { S.tradeDisruption = {}; return; }
  Object.keys(S.tradeDisruption).forEach(pid => {
    const goods = S.tradeDisruption[pid];
    Object.keys(goods).forEach(c => {
      const next = Math.max(0, goods[c] - TRADE_DISRUPT_DECAY);
      if (next <= 0) delete goods[c]; else goods[c] = next;
    });
    if (Object.keys(goods).length === 0) delete S.tradeDisruption[pid];
  });
}
/* ---------- Pre-assault recon & battlefield shaping ----------
   The strategic half of the tactical layer above: attacking BLIND is the brute-force
   tax. Recon is now a real commitment, not a free look: launch a chosen NUMBER of 🛸
   Combat Drones (planetDetectionBand, combat.js, reads the world's law/tech/alert to
   set the band) and the swarm's fate depends on where that count lands —
     below the band's `min`  — too few to resolve any signal against their sensor
                                noise: the drones are spent for NOTHING, no intel, but
                                the attempt is small enough nobody notices either.
     within the band         — a clean, undetected read. How much of the picture you
                                get scales with how many drones you sent: near the
                                floor, only a QUALITATIVE read (weak/moderate/strong/
                                formidable); past the midpoint, the FULL numeric
                                picture (exact estimated strengths, named responders).
     above the band's `max`  — you learn everything, but a swarm that large is what
                                gives you away: the garrison scrambles, `planetAlert`
                                jumps, and the surprise for whatever comes next is gone.
   Once charted (any outcome but the silent failure), the map shows exactly WHICH
   coalition worlds would answer a distress call — with that in hand you can shape the
   field before the first shot: pay a willing pirate crew to fall on a responder's own
   lanes (hireRaidDiversion) and that world's wing stays home for the duration — its 📡
   distress-call answers simply never come. The diversion is itself raiding by proxy:
   the harassed world's own alert ticks up, and the hired band goes busy for the run. */
const PROBE_CYCLES = 10;
const PROBE_ALARM_GAIN = 6;    // tripping the alarm is a real provocation — more than one lane kill, short of a full assault
const DIVERSION_COST = 1500, DIVERSION_CYCLES = 6;
function planetReconActive(pid) { return !!(S.planetRecon && S.planetRecon[pid] && S.planetRecon[pid].until > S.turn); }
function planetReconDetail(pid) { return planetReconActive(pid) ? S.planetRecon[pid].detail : null; }
function worldDiverted(pid) { return !!(S.assaultDiversions && (S.assaultDiversions[pid] || 0) > S.turn); }
// idle, willing crews only — a band that's busy, mandated, or riding with you has better things to do
function diversionBandCandidates() {
  return bandList().filter(b => bandWillAlly(b) && !bandBusy(b) && !bandOnMandate(b) && !bandFollowing(b) && !bandOnCall(b) && !bandInbound(b))
    .sort((a, b) => (b.rep || 0) - (a.rep || 0));
}
function raidStrengthBand(n) { return n <= 15 ? "weak" : n <= 30 ? "moderate" : n <= 50 ? "strong" : "formidable"; }
function probePlanetDefenses(qty) {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  if (!p.faction) return toast("No garrison here worth charting.", "bad");
  if (!((S.upgrades.dronebay || 0) > 0)) return toast("Install a 🛸 Drone Bay (Ship tab) to launch recon drones.", "bad");
  qty = Math.max(1, Math.round(+qty || 0));
  if ((S.res.drones || 0) < qty) return toast(`You only have ${fmt(S.res.drones || 0)} 🛸 drones aboard.`, "bad");
  useAction();
  S.res.drones -= qty;   // spent whether or not the swarm reports back
  const { min, max } = planetDetectionBand(p);
  if (qty < min) {
    log(`🛸 Your ${qty}-drone recon swarm over <span class="c">${p.name}</span> returns nothing usable — too few to resolve any signal against their sensor noise. The drones are gone and you're no wiser, but the attempt was too small to notice either.`, "bad");
    toast("Recon inconclusive — drones lost, no intel.", "bad");
    return afterAction();
  }
  const detailed = qty >= (min + max) / 2;
  const alarmed = qty > max;
  S.planetRecon = S.planetRecon || {};
  S.planetRecon[p.id] = { until: S.turn + PROBE_CYCLES, detail: detailed ? "full" : "coarse" };
  const sources = assaultCoalitionSources(p);
  const patrolStr = planetPatrolStrengthEst(p), garrisonStr = planetGarrisonStrengthEst(p);
  const body = detailed
    ? `picket of <b>${planetPatrolCount(p)}</b> (~str ${patrolStr} each), 🏰 garrison ~str <b>${garrisonStr}</b>, and <b>${sources.length}</b> coalition world(s) in reach to answer a distress call${sources.length ? ` (${sources.slice(0, 3).map(w => w.name).join(", ")}${sources.length > 3 ? "…" : ""})` : ""}`
    : `a <b>${raidStrengthBand(patrolStr)}</b> picket, a <b>${raidStrengthBand(garrisonStr)}</b> garrison, and roughly <b>${sources.length}</b> coalition world(s) that could respond`;
  if (alarmed) {
    raisePlanetAlert(p.id, PROBE_ALARM_GAIN);
    log(`🛸 Your ${qty}-drone swarm over <span class="c">${p.name}</span> reads clearly — ${body} — but a swarm that size doesn't go unnoticed: their sensors pick it up and the garrison scrambles onto alert. The surprise is gone.`, "bad");
    toast(`${p.name} spotted the drones — alert raised!`, "bad");
  } else {
    log(`🛸 Recon swarm over <span class="c">${p.name}</span> (${qty} drones, undetected): ${body}. Passive sensors only — nobody noticed. Intel good for ${PROBE_CYCLES} cycles.`, "event");
    toast(`${p.name} charted${detailed ? " in detail" : ""} — intel ${PROBE_CYCLES} cyc`, "event");
  }
  afterAction();
}
function hireRaidDiversion(worldId) {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  if (!planetReconActive(p.id)) return toast("Chart the lanes first — 🛰️ probe this world's defenses.", "bad");
  const w = PLANETS.find(x => x.id === worldId);
  if (!w || !assaultCoalitionSources(p).some(o => o.id === worldId)) return toast("That world isn't part of this coalition's response.", "bad");
  const band = diversionBandCandidates()[0];
  if (!band) return toast("No willing pirate crew is free for the job — build standing at the 🏴‍☠️ Contacts tab first.", "bad");
  if (S.res.credits < DIVERSION_COST) return toast(`The job costs ${fmt(DIVERSION_COST)} cr.`, "bad");
  S.res.credits -= DIVERSION_COST; useAction();
  S.assaultDiversions = S.assaultDiversions || {};
  S.assaultDiversions[worldId] = S.turn + DIVERSION_CYCLES;
  band.busyUntil = S.turn + DIVERSION_CYCLES;
  bandRepAdd(band, 4);                                       // paid work deepens the friendship
  raisePlanetAlert(worldId, 4);                              // raiding by proxy still heats the harassed world
  log(`💰 The ${band.ico} <b>${band.name}</b> take your coin and fall on <span class="c">${w.name}</span>'s lanes — its response wing is pinned at home for <b>${DIVERSION_CYCLES}</b> cycles and won't answer ${p.name}'s distress calls.`, "event");
  toast(`${w.name} diverted for ${DIVERSION_CYCLES} cycles`, "event");
  afterAction();
}
// cycle tick: expire recon charts quietly, and note when a bought diversion runs out
function processRaidIntel() {
  if (!S.planetRecon) S.planetRecon = {};
  Object.keys(S.planetRecon).forEach(pid => { if (!S.planetRecon[pid] || S.planetRecon[pid].until <= S.turn) delete S.planetRecon[pid]; });
  if (!S.assaultDiversions) S.assaultDiversions = {};
  Object.keys(S.assaultDiversions).forEach(pid => {
    if (S.assaultDiversions[pid] <= S.turn) {
      delete S.assaultDiversions[pid];
      const w = PLANETS.find(x => x.id === pid);
      if (w) digestNote("sector", `the hired harassment at ${w.name} ends — its response wing stands ready again`);
    }
  });
}

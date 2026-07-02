/* ============================================================
   STELLAR FRONTIER — the outlaw path
   Navy interdiction (the law comes for a wanted captain: bribe, fight, or
   surrender), the Pirate Haven (a hidden lair to lie low, stash plunder, and
   draw tribute), Privateer Commissions (letters of marque — raid a faction's
   rivals, legally), and the two capstone legacies that cap the pirate/lawman
   arc, the Pirate Lord and the Bounty Hunter's Sector Marshal.

   Loaded after raiding.js and sector4x.js, before game.js. currentPlanet,
   cargoFree, actionsLeft, useAction, log, jot, toast, announce, fireworks,
   addRep, fmt, raidPower, clampPirate, takeHullDamage, pirateLevel,
   afterAction, unlock, setTab and cycleLedger still live in game.js/earlier
   files at this point in the split — safe, since every function here is only
   CALLED later, once every script has finished loading, same pattern as
   every prior slice.
   ============================================================ */

"use strict";

/* ------------------------------------------------------------
   THE LAW STRIKES BACK — navy interdiction, arrest, counterplay
   ------------------------------------------------------------ */
// strength of the cutter that comes for you: stiffer in lawful space, stiffer the more wanted you are.
// tuned so a combat-built captain (high cannons + Dread) can fight clear, while a light build can't.
function navyStrength(p) {
  return Math.round((12 + p.enforce * 24) * (0.8 + S.pirate.wanted / 130) * (0.9 + Math.random() * 0.3));
}
// what a payoff costs — scales with notoriety and how civilised the world is
function navyBribeCost(p) {
  return Math.round((600 + S.pirate.wanted * 45) * (0.6 + p.enforce));
}
function startInterdiction(p, kind) {
  S.interdiction = { kind, planet: p.id, strength: navyStrength(p), bribe: navyBribeCost(p) };
  const verb = kind === "dock" ? `${p.name} port authority flags your transponder` : "your prowl runs into a navy patrol sweep";
  log(`🚨 ${verb} — a navy cutter moves to interdict! (Bribe, fight, or surrender.)`, "bad");
  toast("Navy interdiction!", "bad");
  if (typeof announce === "function")
    announce("🚨 Navy Interdiction", `${p.name} authorities have you in their sights. Bribe, fight your way clear, or surrender — but you're locked down until it's settled.`, false);
  unlock("raid"); if (typeof setTab === "function") setTab("raid");
}
// called on arrival at a port: notorious captains can't just stroll into lawful space
function maybeInterdict(dest) {
  if (!S.pirate || S.interdiction || S.jail > 0) return;
  if (S.commission && dest.faction === S.commission.patron) return; // your patron's ports wave you through
  if (S.pirate.wanted < 25) return;                       // below "Wanted" the ports don't bother
  const distracted = (S.crises && S.crises[dest.id]) ? 0.5 : 1;   // a world in crisis has bigger problems
  if (Math.random() < (S.pirate.wanted / 100) * dest.enforce * 1.15 * distracted) startInterdiction(dest, "dock");
}
function navyBribe() {
  const it = S.interdiction; if (!it) return;
  const p = PLANETS.find(x => x.id === it.planet) || currentPlanet();
  if (p.enforce > 0.75) return toast("These officers don't take bribes — fight or surrender.", "bad");
  if (S.res.credits < it.bribe) return toast(`A payoff costs ${fmt(it.bribe)} cr.`, "bad");
  S.res.credits -= it.bribe;
  const cut = 8 + Math.round(S.pirate.wanted * 0.12);
  S.pirate.wanted = Math.max(0, S.pirate.wanted - cut);
  addRep("core", -3);
  S.interdiction = null; clampPirate();
  log(`💵 You greased the right palms (${fmt(it.bribe)} cr) and the patrol looks the other way. (Wanted −${cut})`, "good");
  toast("Bribe accepted.", "good");
  afterAction();
}
function navyFight() {
  const it = S.interdiction; if (!it) return;
  const power = raidPower() + Math.random() * 12;
  const def = it.strength + Math.random() * 12;
  if (power > def) {
    const dmg = takeHullDamage(it.strength * 0.6 * (0.5 + Math.random() * 0.5));
    S.pirate.dread += 10; S.pirate.wanted = Math.min(100, S.pirate.wanted + 6);
    addRep("core", -8); addRep("frontier", 5);
    S.interdiction = null; clampPirate();
    log(`⚔️ You shot your way clear of the navy! Hull −${dmg}. The legend grows. (Dread +10, Wanted +6)`, "good");
    toast("Escaped the navy!", "good");
    afterAction();
  } else {
    navyArrest("Your hull was shot out and you were boarded", true);
  }
}
function navySurrender() {
  if (!S.interdiction) return;
  navyArrest("You stood down and surrendered", false);
}
function navyArrest(reason, crippled) {
  const seized = [];
  CARGO_IDS.forEach(c => { if (S.res[c] > 0) { seized.push(`${S.res[c]} ${COM[c].ico}`); S.res[c] = 0; } });
  const fine = Math.min(S.res.credits, 1000 + Math.round(S.pirate.wanted * 30));
  S.res.credits -= fine;
  if (crippled) S.pirate.hull = Math.min(S.pirate.hull, 35);
  S.jail = (S.pirate.wanted >= 70) ? 2 : 1;
  S.pirate.wanted = Math.round(S.pirate.wanted * 0.35);
  S.pirate.dread = Math.max(0, S.pirate.dread - 10);
  S.interdiction = null; clampPirate();
  log(`⛓️ ${reason}. The navy seized ${seized.join(" ") || "no cargo"}, fined you ${fmt(fine)} cr, and jailed you for ${S.jail} cycle(s) — but your warrants are largely wiped.`, "bad");
  toast("Arrested!", "bad");
  jot(`Arrested at ${currentPlanet().name}: cargo seized, fined, jailed ${S.jail} cycle(s).`, "outlaw");
  if (typeof announce === "function")
    announce("⛓️ Arrested", `${reason}. Cargo seized and fined, jailed for ${S.jail} cycle(s) — your slate is mostly clean again.`, true);
  afterAction();
}
// active counterplay: buy off your warrants where officials are corruptible
function settleWarrants() {
  if (S.interdiction) return toast("Deal with the patrol on your tail first.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  const p = currentPlanet(), P = S.pirate;
  if (P.wanted <= 0) return toast("Your record is already clean.", "bad");
  if (p.enforce > 0.6) return toast("Officials here are incorruptible — take it to lawless space.", "bad");
  const cut = Math.min(P.wanted, 15 + Math.round(P.wanted * 0.25));
  const cost = Math.round(cut * (60 + p.enforce * 120));
  if (S.res.credits < cost) return toast(`Buying off these warrants costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost; P.wanted = Math.max(0, P.wanted - cut);
  addRep("syndicate", 1); clampPirate(); useAction();
  log(`📝 You laundered your record through ${p.name}'s corruptible officials for ${fmt(cost)} cr. (Wanted −${cut})`, "good");
  toast(`Warrants settled (−${cut} Wanted).`, "good");
  afterAction();
}

/* ------------------------------------------------------------
   PIRATE HAVEN — a hidden hideout: lie low, stash loot, draw tribute
   ------------------------------------------------------------ */
const HAVEN_COST = 6000, HAVEN_METALS = 30, HAVEN_STASH_BASE = 120, HAVEN_MAX_TIER = 3;
function canHaven(p) { return p.enforce <= 0.2 && p.faction !== "core"; } // only the lawless deep rim hides a den
function atHaven() { return S.haven && S.haven.planet === S.location; }
/* repair venues stack: a haven dry-dock (40% off) and/or a base workshop (25% off) */
function atBase() { return !!(S.bases && S.bases[S.location]); }
function repairDiscount() { return (atHaven() ? 0.6 : 1) * (atBase() ? 0.75 : 1); }
function repairVenueNote() {
  const v = [];
  if (atHaven()) v.push("haven dry-dock");
  if (atBase()) v.push("base workshop");
  return v.length ? ` (${v.join(" + ")}, ${Math.round((1 - repairDiscount()) * 100)}% off)` : "";
}
function havenStashCap() { return S.haven ? HAVEN_STASH_BASE * S.haven.tier : 0; }
function havenStashUsed() { return S.haven ? Object.values(S.haven.stash).reduce((s, q) => s + q, 0) : 0; }
function havenTributeRate() { return S.haven ? Math.round(S.pirate.dread * S.haven.tier * 1.2) : 0; }
function establishHaven() {
  if (S.haven) return toast("You already command a haven.", "bad");
  const p = currentPlanet();
  if (!canHaven(p)) return toast("Too exposed — carve a haven out of the lawless deep rim.", "bad");
  if (S.res.credits < HAVEN_COST || (S.res.metals || 0) < HAVEN_METALS)
    return toast(`A haven costs ${fmt(HAVEN_COST)} cr and ${HAVEN_METALS} ⛓️ metals.`, "bad");
  S.res.credits -= HAVEN_COST; S.res.metals -= HAVEN_METALS;
  S.haven = { planet: p.id, tier: 1, stash: {} };
  log(`🏴‍☠️ You carved a hidden haven out of <span class="c">${p.name}</span>. A lair to lie low, stash plunder, and rule the rim.`, "event");
  toast("Haven established!", "good");
  afterAction();
}
function upgradeHaven() {
  if (!S.haven) return;
  if (S.haven.tier >= HAVEN_MAX_TIER) return toast("Your haven is already a fortress.", "bad");
  const cost = HAVEN_COST * S.haven.tier;
  if (S.res.credits < cost) return toast(`Expanding the haven costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost; S.haven.tier++;
  log(`🏗️ Your haven grows to tier ${S.haven.tier} — more stash, fatter tribute.`, "good");
  toast(`Haven → tier ${S.haven.tier}`, "good");
  afterAction();
}
function layLow() {
  if (!atHaven()) return toast("Lie low only at your haven.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left.", "bad");
  if (S.pirate.wanted <= 0) return toast("Your slate is already clean.", "bad");
  const cut = 22 + S.haven.tier * 4;
  S.pirate.wanted = Math.max(0, S.pirate.wanted - cut);
  S.pirate.dread = Math.max(0, S.pirate.dread - 3); // out of sight, out of mind
  useAction(); clampPirate();
  log(`🤫 You vanish into the haven and let the heat die down. (Wanted −${cut})`, "good");
  toast(`Lying low (−${cut} Wanted).`, "good");
  afterAction();
}
function havenStashAll() {
  if (!atHaven()) return toast("No haven here.", "bad");
  let room = havenStashCap() - havenStashUsed(), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.res[c] || 0, room);
    if (q > 0) { S.res[c] -= q; S.haven.stash[c] = (S.haven.stash[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`🗄️ Stashed ${moved} units of plunder at your haven — safe from any boarding party.`, "good"); afterAction(); }
  else toast("Nothing to stash (or stash full).", "bad");
}
function havenTakeAll() {
  if (!atHaven()) return toast("No haven here.", "bad");
  let room = cargoFree(), moved = 0;
  CARGO_IDS.forEach(c => {
    if (room <= 0) return;
    const q = Math.min(S.haven.stash[c] || 0, room);
    if (q > 0) { S.haven.stash[c] -= q; if (S.haven.stash[c] <= 0) delete S.haven.stash[c]; S.res[c] = (S.res[c] || 0) + q; room -= q; moved += q; }
  });
  if (moved > 0) { log(`📦 Loaded ${moved} units from the haven stash.`, "good"); afterAction(); }
  else toast("Nothing to take (or hold full).", "bad");
}
function processHaven() {
  if (!S.haven || !S.pirate) return;
  const tribute = havenTributeRate();
  if (tribute > 0) { S.res.credits += tribute; cycleLedger("haven tribute", tribute); }
}
/* ------------------------------------------------------------
   PRIVATEER COMMISSIONS — letters of marque: raid a faction's rivals, legally
   ------------------------------------------------------------ */
const COMM_DURATION = 12, COMM_QUOTA = 5, COMM_BOUNTY = 800, COMM_REWARD = 4000, COMM_REP_REQ = 5;
function commissionCovers(faction) { return !!(S.commission && S.commission.target === faction); }
function acceptCommission() {
  if (S.commission) return toast("You already sail under a letter of marque.", "bad");
  const p = currentPlanet(), patron = p.faction, target = FACTION_RIVAL[patron];
  if (!target) return toast("No commission on offer here.", "bad");
  if ((S.rep[patron] || 0) < COMM_REP_REQ) return toast(`${FACTIONS[patron].name} won't commission a stranger — earn their trust first.`, "bad");
  S.commission = { patron, target, expires: S.turn + COMM_DURATION, quota: COMM_QUOTA, done: 0, bounty: COMM_BOUNTY, reward: COMM_REWARD };
  addRep(patron, 5); addRep(target, -8);
  log(`📜 ${FACTIONS[patron].name} grants you a letter of marque against the ${FACTIONS[target].name}. Hunt their shipping — and the law looks the other way.`, "event");
  toast("Letter of marque accepted!", "good");
  afterAction();
}
// applied on a successful raid: pays bounty, counts quota, and waives the Wanted you'd normally earn
function applyCommissionRaid(prey) {
  if (!commissionCovers(prey.faction)) return false;
  const c = S.commission;
  c.done++; S.res.credits += c.bounty; addRep(c.patron, 2);
  return true;
}
function revokeCommission(betrayed) {
  if (!S.commission) return;
  const c = S.commission;
  if (betrayed) {
    addRep(c.patron, -20); S.pirate.wanted = Math.min(100, S.pirate.wanted + 15);
    log(`📜 You turned on your patron — ${FACTIONS[c.patron].name} tears up your letter of marque and brands you an oathbreaker!`, "bad");
    toast("Commission betrayed!", "bad");
  }
  S.commission = null; clampPirate();
}
/* ------------------------------------------------------------
   PIRATE LORD — the outlaw capstone legacy
   ------------------------------------------------------------ */
const LORD_DREAD = 80, LORD_HAVEN_TIER = 2, LORD_PLUNDER = 50000, LORD_RAIDS = 20;
function pirateLordCriteria() {
  const P = S.pirate;
  return [
    { label: `Strike terror — Dread ${LORD_DREAD}+`, ok: P.dread >= LORD_DREAD },
    { label: `Command a stronghold — Haven tier ${LORD_HAVEN_TIER}+`, ok: !!(S.haven && S.haven.tier >= LORD_HAVEN_TIER) },
    { label: `Amass plunder — ${fmt(LORD_PLUNDER)} cr looted`, ok: P.plundered >= LORD_PLUNDER },
    { label: `Earn your reputation — ${LORD_RAIDS} raids`, ok: P.raids >= LORD_RAIDS },
  ];
}
function pirateLordReady() {
  return S.pirate && !S.legacyTitle && pirateLordCriteria().every(c => c.ok);
}
function pirateLegacy() {
  if (S.legacyTitle) return toast("Your legacy is already sealed.", "bad");
  if (!pirateLordReady()) return toast("You are not yet feared enough to claim the throne.", "bad");
  const coreRep = S.rep.core || 0;
  let title, blurb;
  if (coreRep >= 20 || (S.pirate.commissionsDone || 0) >= 2) {
    title = "The Corsair King";
    blurb = "Half-privateer, half-pirate, you turned the great powers' wars to your profit — ruling the lanes with their blessing and their fear alike.";
  } else if (coreRep <= -40) {
    title = "The Dread Lord";
    blurb = "A name whispered in terror from the Core to the rim; captains strike their colors at the mere sight of your sails.";
  } else {
    title = "The Pirate King";
    blurb = "From a hidden haven you command the outlaws of the rim, and the sector's wealth flows through your hands.";
  }
  S.legacyTitle = title;
  log(`🏴‍☠️ PIRATE LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`PIRATE LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your outlaw legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — pirate legacy complete!`, "good");
  afterAction();
}

/* ---- Bounty Hunter capstone — the lawful mirror of the Pirate Lord ---- */
const MARSHAL_KILLS = 20, MARSHAL_EARNED = 40000, MARSHAL_REP = 50;
function marshalCriteria() {
  const P = S.pirate, actives = PLANETS.filter(isActive);
  return [
    { label: `Hunt down ${MARSHAL_KILLS} pirates`, ok: (P.bountyKills || 0) >= MARSHAL_KILLS },
    { label: `Collect ${fmt(MARSHAL_EARNED)} cr in bounties`, ok: (P.bountyEarned || 0) >= MARSHAL_EARNED },
    { label: `Win the law's trust — Core rep ${MARSHAL_REP}+`, ok: (S.rep.core || 0) >= MARSHAL_REP },
    { label: (() => { const hot = actives.filter(p => pirateLevel(p.id) > 1).length; return `Pacify the sector — no world above activity 1${hot ? ` (${hot} still hot)` : ""}`; })(), ok: actives.every(p => pirateLevel(p.id) <= 1) },
  ];
}
function marshalReady() {
  return S.pirate && !S.legacyTitle && (S.pirate.bountyKills || 0) > 0 && marshalCriteria().every(c => c.ok);
}
function marshalLegacy() {
  if (S.legacyTitle) return toast("Your legacy is already sealed.", "bad");
  if (!marshalReady()) return toast("The sector isn't yet pacified under your banner.", "bad");
  const P = S.pirate, coreRep = S.rep.core || 0;
  let title, blurb;
  if ((P.raids || 0) >= 10 || (P.dread || 0) >= 30 || (P.wanted || 0) >= 30) {
    title = "The Bounty King";
    blurb = "Hunter and hunted both, you turned the bounty trade into an empire — feared by raiders and paid by the law in equal measure.";
  } else if (coreRep >= 70) {
    title = "The Sector Marshal";
    blurb = "You pacified the sector under the law's own banner; from the Core to the rim, your name became a synonym for order.";
  } else {
    title = "The Lawbringer";
    blurb = "You broke every pirate stronghold on the frontier and made the lanes safe again — a legend in white.";
  }
  S.legacyTitle = title;
  log(`⚖️ LAWBRINGER LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`LAWBRINGER LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your bounty-hunter legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — bounty-hunter legacy complete!`, "good");
  afterAction();
}
function processCommission() {
  if (!S.commission || S.turn < S.commission.expires) return;
  const c = S.commission;
  if (c.done >= c.quota) {
    S.res.credits += c.reward; S.res.influence = (S.res.influence || 0) + 10; addRep(c.patron, 10);
    S.pirate.commissionsDone = (S.pirate.commissionsDone || 0) + 1;
    log(`📜 Commission fulfilled! ${FACTIONS[c.patron].name} pays a ${fmt(c.reward)} cr bonus and hails you a privateer. (+influence, +rep)`, "good");
    toast("Commission fulfilled!", "good");
  } else {
    addRep(c.patron, -3);
    log(`📜 Your letter of marque against the ${FACTIONS[c.target].name} lapsed with the quota unmet (${c.done}/${c.quota}).`, "bad");
  }
  S.commission = null;
}

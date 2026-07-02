/* ============================================================
   STELLAR FRONTIER — research & politics actions
   The player-facing action layer for the Politics tab: research (spending
   energy for tech points), entering public life, political organizations
   (found/upgrade/run abilities), the Senate (propose/lobby/bribe/vote on
   Bills, standing policies), per-planet trade-law lobbying, corruption
   investigations & trials (and their countermeasures), and the public
   Office ladder (elections, appointments, coups, terms, the political
   legacy). The matching data tables (OFFICES, ORGS, BILLS and their
   related constants) live in catalogs.js.

   Loaded after catalogs.js, before game.js. combatLocked, fxMult, rollFx,
   cycleLedger, checkWin, checkMilestones, renderAll, saveGame and
   afterAction still live in game.js at this point in the split — safe,
   since every function here is only CALLED later, once every script has
   finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

/* ---------- Research economy ----------
   Running experiments burns lab power (energy) and pays off most at high-tech
   worlds. Unlocking a tech also costs domain-themed MATERIALS — and a world
   that specialises in that domain halves the bill (local expertise), while
   the most advanced tech can only be cracked on a sufficiently advanced world. */
const RESEARCH_ENERGY = 4;   // ⚡ to power one round of experiments
const TECH_DOMAINS = {
  mining: "⛏️ mining", bio: "🌿 bio", gas: "🎈 gas", industry: "🏭 industry",
  energy: "⚡ energy", computing: "🖥️ computing", military: "⚔️ military", civic: "🏛️ civic",
};
const TECH_RESEARCH = {
  deepcore:    { domain: "mining",    mats: { ore: 8 } },
  xenobio:     { domain: "bio",       mats: { biomass: 8 } },
  gasharvest:  { domain: "gas",       mats: { gas: 6 } },
  salvaging:   { domain: "mining",    mats: { metals: 5 } },
  metallurgy:  { domain: "industry",  mats: { ore: 10, metals: 4 } },
  electronics: { domain: "computing", mats: { crystals: 6, metals: 4 } },
  reactors:    { domain: "energy",    mats: { radioactives: 6 } },
  gasfuel:     { domain: "energy",    mats: { gas: 6 } },
  biotech:     { domain: "bio",       mats: { spice: 4, chemicals: 4 } },
  markets:     { domain: "civic",     mats: { goods: 6 } },
  weapontech:  { domain: "military",  mats: { metals: 8, electronics: 4 } },
  diplomacy:   { domain: "civic",     mats: { goods: 8, luxury: 3 } },
  colonial:    { domain: "civic",     mats: { goods: 10, alloys: 4 } },
  energyweapons: { domain: "military", mats: { electronics: 6, crystals: 4 } },
  torpedoes:   { domain: "military",  mats: { radioactives: 6, metals: 6 } },
  dronetech:   { domain: "computing", mats: { electronics: 8, alloys: 4 } },
  aicores:     { domain: "computing", mats: { electronics: 10, relics: 2 }, minTech: 5 },
  antimatter:  { domain: "energy",    mats: { radioactives: 10, electronics: 6 }, minTech: 5 },
  terraform:   { domain: "bio",       mats: { biomass: 10, ice: 8, energy: 10 }, minTech: 4 },
};
function worldAffinity(p, domain) {
  const dep = p.deposits || {};
  switch (domain) {
    case "mining":    return effIndustry(p) >= 4 || ["ore", "crystals", "radioactives"].some(c => dep[c]);
    case "bio":       return p.faction === "agri" || ["biomass", "spice", "ice"].some(c => dep[c]);
    case "gas":       return !!dep.gas;
    case "industry":  return effIndustry(p) >= 4;
    case "energy":    return effIndustry(p) >= 4 || !!dep.radioactives || !!dep.gas;
    case "computing": return effTech(p) >= 5;
    case "military":  return effIndustry(p) >= 4;
    case "civic":     return effTech(p) >= 5 || p.faction === "core";
    default:          return false;
  }
}
function techMatCost(t) {
  const r = TECH_RESEARCH[t.id]; if (!r || !r.mats) return {};
  const affine = worldAffinity(currentPlanet(), r.domain);
  const out = {};
  Object.entries(r.mats).forEach(([k, v]) => { out[k] = affine ? Math.max(1, Math.ceil(v * 0.5)) : v; });
  return out;
}
function techMinTechMet(t) {
  const r = TECH_RESEARCH[t.id];
  return !(r && r.minTech) || effTech(currentPlanet()) >= r.minTech;
}
function matsPlain(mats) { return Object.entries(mats).map(([c, q]) => `${q}${COM[c].ico}`).join(" + "); }
function research() {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if ((S.res.energy || 0) < RESEARCH_ENERGY) return toast(`Experiments need ${RESEARCH_ENERGY} ⚡ energy to power the lab — refine or buy some.`, "bad");
  const p = currentPlanet();
  S.res.energy -= RESEARCH_ENERGY;
  const pts = Math.round((2 + effTech(p)) * (1 + S.upgrades.lab * 0.40) * fxMult("researchMult"));
  S.res.tech += pts; useAction();
  log(`Generated <span class="c">${pts}</span> tech points on ${p.name} (−${RESEARCH_ENERGY}⚡, Tech ${effTech(p)}).`, "good");
  toast(`+${pts} 🔬 (−${RESEARCH_ENERGY}⚡)`, "good");
  if (Math.random() < 0.08) rollFx("boon");   // breakthroughs sometimes spark a windfall
  afterAction();
}
/* One-click political career entry — replaces the old "Politics" new-game
   button: founds your party and seeds clout, all within the running game. */
const PUBLIC_LIFE_COST = 5000;
function enterPublicLife() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (S.office > 0 || S.orgs.party) return toast("You're already in public life.", "bad");
  if (S.res.credits < PUBLIC_LIFE_COST) return toast(`Entering public life costs ${fmt(PUBLIC_LIFE_COST)} credits.`, "bad");
  S.res.credits -= PUBLIC_LIFE_COST;
  S.orgs.party = { tier: 1 };
  S.res.influence = (S.res.influence || 0) + 15;
  applyPolDelta({ popularity: 10 });
  useAction();
  log(`🏛️ You enter public life — a movement of your own, a war chest and a name people are starting to know. Build popularity and run for office.`, "event");
  toast("Welcome to public life!", "good");
  afterAction();
}

function doPolitics() {
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const p = currentPlanet();
  let inf = Math.round((2 + (effTech(p) + effIndustry(p)) / 3) * (1 + S.upgrades.envoy * 0.40) * fxMult("influenceMult"));
  if (S.perks.senator) inf = Math.round(inf * 1.3);
  if (S.perks.governor) inf = Math.round(inf * 1.6);
  S.res.influence += inf;
  const repGain = Math.round(3 * (1 + S.upgrades.envoy * 0.4) * fxMult("repMult"));
  addRep(p.faction, repGain);
  useAction();
  log(`Lobbied on ${p.name}: +${inf} influence, +${repGain} ${FACTIONS[p.faction].ico} ${FACTIONS[p.faction].name} rep.`, "good");
  toast(`+${inf} 🏛️ influence`, "good");
  afterAction();
}

/* ---------- Political organizations & power meters ---------- */
function canPolitick() { return !!S.techs.diplomacy; }   // Galactic Charter gates organizations
function orgDef(id) { return ORGS.find(o => o.id === id); }
function orgUpkeepTotal() {
  return Object.entries(S.orgs || {}).reduce((s, [id, o]) => s + orgDef(id).upkeep * o.tier, 0);
}
function orgUpgradeCost(def, tier) { return Math.round(def.foundCost * Math.pow(def.costMul, tier)); }
function clampPol() {
  const P = S.pol;
  P.popularity = Math.max(0, Math.min(100, P.popularity));
  P.legitimacy = Math.max(-100, Math.min(100, P.legitimacy));
  P.heat = Math.max(0, Math.min(100, P.heat));
  P.slush = Math.max(0, Math.round(P.slush));
}
function applyPolDelta(d) {
  if (!d) return;
  const P = S.pol;
  if (d.popularity) P.popularity += d.popularity;
  if (d.legitimacy) P.legitimacy += d.legitimacy;
  if (d.heat)       P.heat += (d.heat > 0 && policyActive("anticorr")) ? d.heat * 1.6 : d.heat; // oversight bites
  if (d.slush)      P.slush += d.slush;
  if (d.influence)  S.res.influence = (S.res.influence || 0) + d.influence;
  if (d.credits)    S.res.credits += d.credits;
  if (d.unrest)     Object.values(S.colonies || {}).forEach(c => { c.unrest = Math.max(0, (c.unrest || 0) + d.unrest); });
  clampPol();
}
function foundOrg(id) {
  if (!canPolitick()) return toast("Research Galactic Charter first.", "bad");
  const def = orgDef(id);
  if (!def || (S.orgs && S.orgs[id])) return;
  if (S.res.credits < def.foundCost) return toast("Not enough credits to found this.", "bad");
  S.res.credits -= def.foundCost; S.orgs[id] = { tier: 1 };
  log(`Founded ${def.ico} <span class="c">${def.name}</span> (upkeep ${fmt(def.upkeep)}/cycle).`, "event");
  toast(`${def.name} founded!`, "event");
  afterAction();
}
function upgradeOrg(id) {
  const def = orgDef(id), o = S.orgs[id];
  if (!o || o.tier >= def.tiers) return;
  const cost = orgUpgradeCost(def, o.tier);
  if (S.res.credits < cost) return toast("Not enough credits.", "bad");
  S.res.credits -= cost; o.tier++;
  log(`Upgraded ${def.ico} ${def.name} to Tier ${o.tier}.`, "good");
  toast(`${def.name} → Tier ${o.tier}`, "good");
  afterAction();
}
function payAbilityCost(cost) {
  cost = cost || {};
  if (cost.credits && S.res.credits < cost.credits)       return `Need ${fmt(cost.credits)} credits.`;
  if (cost.influence && (S.res.influence || 0) < cost.influence) return `Need ${cost.influence} influence.`;
  if (cost.slush && S.pol.slush < cost.slush)             return `Need ${fmt(cost.slush)} slush.`;
  if (cost.credits)   S.res.credits -= cost.credits;
  if (cost.influence) S.res.influence -= cost.influence;
  if (cost.slush)     S.pol.slush -= cost.slush;
  return null;
}
function runOrgAbility(orgId, abId) {
  if (combatLocked()) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const def = orgDef(orgId), o = S.orgs[orgId];
  if (!o) return;
  const ab = def.abilities.find(a => a.id === abId);
  if (!ab) return;
  const err = payAbilityCost(ab.cost);
  if (err) return toast(err, "bad");
  ab.effect(o);
  useAction();
  log(`${def.ico} ${def.name}: ${ab.name}.`, def.tone === "dark" ? "event" : "good");
  afterAction();
}
function processOrgs() {
  if (!S.pol) return;
  const P = S.pol;
  // passive yields from every organization
  Object.entries(S.orgs || {}).forEach(([id, o]) => applyPolDelta(orgDef(id).passive(o)));
  // upkeep — if you can't make payroll, the priciest org downsizes (a scandal)
  const due = orgUpkeepTotal();
  if (due > 0) {
    if (S.res.credits >= due) { S.res.credits -= due; cycleLedger("org upkeep", -due); }
    else {
      const ids = Object.keys(S.orgs).sort((a, b) =>
        orgDef(b).upkeep * S.orgs[b].tier - orgDef(a).upkeep * S.orgs[a].tier);
      const victim = ids[0];
      if (victim) {
        const d = orgDef(victim);
        S.orgs[victim].tier--;
        const collapsed = S.orgs[victim].tier <= 0;
        if (collapsed) delete S.orgs[victim];
        applyPolDelta({ heat: 5, popularity: -5 });
        log(`⚠️ Couldn't make payroll — ${d.ico} ${d.name} ${collapsed ? "collapsed" : "downsized"}. Whispers spread.`, "bad");
      }
    }
  }
  // natural drift: trust follows legitimacy, attention fades
  P.popularity += Math.round(P.legitimacy / 40);
  P.popularity -= 1;
  clampPol();
  // heat cools over time; sustained heat feeds corruption investigations (processInvestigation)
  if (P.heat >= 65 && !S.invest) log(`🕵️ Investigators are sniffing around your affairs (Heat ${Math.round(P.heat)}).`, "bad");
  P.heat = Math.max(0, P.heat - 3);
  clampPol();
}

/* ---------- The Senate: voting, bills & policies ---------- */
function canLegislate() { return !!(S.perks.senator || S.perks.governor); }
function billDef(id) { return BILLS.find(b => b.id === id); }
function factionSeats(f) { return 2 + activePlanets().filter(p => p.faction === f).length; }
function senateSize() { return Object.keys(FACTIONS).reduce((s, f) => s + factionSeats(f), 0); }
function factionInclination(f, bill) {
  let s = (bill.stance && bill.stance[f]) || 0;
  s += (S.rep[f] || 0) / 35;                 // standing with the bloc
  s += (S.pol.popularity - 50) / 40;         // public pressure
  s += S.pol.legitimacy / 120;               // statesmen are trusted
  if (S.perks.governor) s += 0.5; else if (S.perks.senator) s += 0.25;
  if (S.floor && S.floor.billId === bill.id) s += (S.floor.sway[f] || 0); // your whipping
  return s;
}
function factionVote(f, bill) { const s = factionInclination(f, bill); return s > 0.4 ? "yes" : s < -0.4 ? "no" : "abstain"; }
function tallyFloor() {
  const bill = billDef(S.floor.billId); let yes = 0, no = 0, abstain = 0;
  Object.keys(FACTIONS).forEach(f => {
    const v = factionVote(f, bill), seats = factionSeats(f);
    if (v === "yes") yes += seats; else if (v === "no") no += seats; else abstain += seats;
  });
  return { yes, no, abstain };
}
function proposeBill(id, target) {
  if (!canLegislate()) return toast("Win a Senate seat first (Office & Elections).", "bad");
  if (S.floor) return toast("A bill is already on the floor.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const bill = billDef(id);
  if (!bill) return;
  if (bill.targeted && (!target || !COM[target])) return toast("Choose a commodity to target.", "bad");
  if (bill.reqPerk && !S.perks[bill.reqPerk]) return toast(`Requires ${bill.reqPerk === "governor" ? "Sector Governor" : bill.reqPerk}.`, "bad");
  if (!bill.oneShot && policyActive(bill.id)) return toast("That law is already in force.", "bad");
  const cost = bill.proposeCost || 20;
  if ((S.res.influence || 0) < cost) return toast(`Need ${cost} influence to propose.`, "bad");
  if (bill.proposeCredits && S.res.credits < bill.proposeCredits) return toast(`Need ${fmt(bill.proposeCredits)} credits.`, "bad");
  S.res.influence -= cost;
  if (bill.proposeCredits) S.res.credits -= bill.proposeCredits;
  S.floor = { billId: id, sway: {}, target: bill.targeted ? target : null };
  applyPolDelta({ heat: 2 });
  useAction();
  log(`📜 Proposed <span class="c">${bill.name}${bill.targeted ? `: ${COM[target].name}` : ""}</span> to the Senate.`, "event");
  toast("Bill on the floor.", "event");
  afterAction();
}
function lobbyFaction(f) {
  if (!S.floor) return;
  if ((S.floor.sway[f] || 0) >= 3) return toast("That bloc is fully courted.", "bad");
  const cost = 8;
  if ((S.res.influence || 0) < cost) return toast("Need 8 influence.", "bad");
  S.res.influence -= cost; S.floor.sway[f] = (S.floor.sway[f] || 0) + 0.6;
  applyPolDelta({ heat: 2 });
  log(`Lobbied ${FACTIONS[f].ico} ${FACTIONS[f].name} on the floor.`);
  afterAction();
}
function bribeFaction(f) {
  if (!S.floor) return;
  if ((S.floor.sway[f] || 0) >= 3) return toast("That bloc is already bought.", "bad");
  const cost = 600;
  if (S.pol.slush < cost) return toast("Need 600 slush (raise dirty funds first).", "bad");
  S.pol.slush -= cost; S.floor.sway[f] = (S.floor.sway[f] || 0) + 1.2;
  applyPolDelta({ heat: 6, legitimacy: -2 });
  log(`💼 Bribed ${FACTIONS[f].ico} ${FACTIONS[f].name} with slush.`, "event");
  afterAction();
}
function enactBill(bill, target) {
  Object.keys(FACTIONS).forEach(f => { const st = (bill.stance && bill.stance[f]) || 0; if (st) addRep(f, st * 2); });
  const tone = { bright: { legitimacy: 8, popularity: 5 }, grey: { legitimacy: 0, popularity: 2 }, dark: { legitimacy: -8, popularity: -4 } }[bill.tone];
  applyPolDelta(tone);
  if (bill.oneShot) bill.oneShot();
  else S.policies[bill.id] = { since: S.turn, target: target || null };
  if (bill.id === "ban" && target) PLANETS.forEach(p => priceShock(p.id, target, 1.25)); // sector-wide price shock
}
function callVote() {
  if (!S.floor) return;
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  const bill = billDef(S.floor.billId);
  if (!bill) { S.floor = null; return; }
  const t = tallyFloor();
  useAction();
  if (t.yes > t.no) {
    enactBill(bill, S.floor.target);
    log(`🏛️ <span class="c">${bill.name}${S.floor.target ? `: ${COM[S.floor.target].name}` : ""}</span> PASSED ${t.yes}–${t.no}.`, "good");
    toast("Bill passed!", "good");
  } else {
    Object.keys(FACTIONS).forEach(f => { if (((bill.stance && bill.stance[f]) || 0) > 0) addRep(f, -2); });
    applyPolDelta({ popularity: -2 });
    log(`🏛️ <span class="c">${bill.name}</span> FAILED ${t.yes}–${t.no}.`, "bad");
    toast("Bill failed.", "bad");
  }
  S.floor = null;
  afterAction();
}
function repealPolicy(id) {
  if (!S.policies[id]) return;
  const cost = 15;
  if ((S.res.influence || 0) < cost) return toast("Need 15 influence to repeal.", "bad");
  S.res.influence -= cost; delete S.policies[id];
  log(`Repealed ${billDef(id) ? billDef(id).name : id}.`, "event");
  afterAction();
}
function applyPolicyEffects() {
  if (!S.policies) return;
  if (policyActive("ubi")) {
    const cost = 2000;
    if (S.res.credits >= cost) {
      S.res.credits -= cost; cycleLedger("UBI policy", -cost); applyPolDelta({ popularity: 2 });
      Object.values(S.colonies || {}).forEach(c => c.unrest = Math.max(0, (c.unrest || 0) - 1));
    } else {
      delete S.policies.ubi; applyPolDelta({ popularity: -6 });
      log("⚠️ The treasury couldn't fund Universal Basic Income — it lapsed amid protests.", "bad");
    }
  }
  if (policyActive("monopoly_grant")) { S.res.credits += 1200; cycleLedger("monopoly grant", 1200); applyPolDelta({ heat: 4 }); }
  if (policyActive("martial")) {
    Object.values(S.colonies || {}).forEach(c => c.unrest = Math.max(0, (c.unrest || 0) - 2));
    applyPolDelta({ popularity: -1 });
  }
}

/* ---------- Per-planet trade laws (lobbying) ----------
   Lobby the local authority to OUTLAW a good (chokes supply → its contraband
   price climbs, but selling it risks customs) or LEGALIZE a restricted good
   (opens the market → its price softens). Local, temporary, influence-funded,
   and a little shady. The sector-wide, permanent version is the Senate's Trade
   Restriction Act. */
function lobbyLaw(comId, type) {
  if (!canPolitick()) return toast("Research Galactic Charter first.", "bad");
  if (actionsLeft() <= 0) return toast("No actions left — end the cycle.", "bad");
  if (!COM[comId]) return;
  const p = currentPlanet(), pid = p.id;
  if (type === "legal" && !isIllegalAt(comId, pid)) return toast(`${COM[comId].name} is already legal here.`, "bad");
  if (type === "ban" && lawStatus(pid, comId) === "ban") return toast(`${COM[comId].name} is already outlawed here.`, "bad");
  const cost = 14 + Math.round(p.enforce * 20);          // lawful worlds are harder to sway
  if ((S.res.influence || 0) < cost) return toast(`Need ${cost} influence to sway ${p.name}.`, "bad");
  S.res.influence -= cost; useAction();
  S.planetLaws[pid] = S.planetLaws[pid] || {};
  S.planetLaws[pid][comId] = { type, until: S.turn + LAW_DURATION };
  if (type === "ban") { priceShock(pid, comId, 1.25); applyPolDelta({ heat: 6, legitimacy: -2 }); addRep("core", 2); addRep(p.faction, -3); }
  else               { priceShock(pid, comId, 0.85); applyPolDelta({ heat: 4, legitimacy: -1 }); addRep("frontier", 3); addRep("core", -3); }
  log(`🏴 You lobbied ${p.name} to ${type === "ban" ? "OUTLAW" : "LEGALIZE"} ${COM[comId].ico} ${COM[comId].name} for ${LAW_DURATION} cycles.`, "event");
  toast(`${COM[comId].name} ${type === "ban" ? "outlawed" : "legalized"} on ${p.name}.`, "event");
  afterAction();
}
function processPlanetLaws() {
  if (!S.planetLaws) return;
  Object.keys(S.planetLaws).forEach(pid => {
    const m = S.planetLaws[pid];
    Object.keys(m).forEach(c => {
      if (m[c].until <= S.turn) {
        delete m[c];
        const pl = PLANETS.find(p => p.id === pid);
        log(`🏴 Your trade law on ${pl ? pl.name : pid} (${COM[c].name}) has lapsed.`, "");
      }
    });
    if (!Object.keys(m).length) delete S.planetLaws[pid];
  });
}

/* ---------- Corruption investigations & trials ----------
   Sustained Heat opens a formal investigation led by the faction most opposed
   to you. Each cycle a case file builds (faster with high Heat, slower if you're
   a respected statesman). Manage the evidence — clean (lawyer up) or dirty
   (bribe / bury / strong-arm / scapegoat) — or it reaches trial at 100. The
   verdict weighs the evidence against your legitimacy, popularity, defense and
   standing with the prosecutor: from acquittal through fines, censure, removal
   from office and imprisonment, to disgrace and exile. */
function pickLeadFaction() {
  const fs = Object.keys(FACTIONS).filter(f => activePlanets().some(p => p.faction === f));
  fs.sort((a, b) => (S.rep[a] || 0) - (S.rep[b] || 0));   // your biggest adversary prosecutes
  return fs[0] || "core";
}
function openInvestigation(lead) {
  S.invest = { lead, evidence: 25, defense: 0, cycles: 0, opened: S.turn };
  log(`🚨 ${FACTIONS[lead].ico} ${FACTIONS[lead].name} has opened a corruption investigation into your affairs!`, "bad");
  toast("Investigation opened!", "bad");
  if (typeof announce === "function") announce("🚨 Investigation Opened", `${FACTIONS[lead].name} is building a case. Manage the evidence — or face trial.`, true);
}
function processInvestigation() {
  if (!S.pol) return;
  const P = S.pol;
  if (!S.invest) {
    let openChance = 0;
    if (P.heat >= 100) openChance = 1;
    else if (P.heat >= 55) openChance = (P.heat - 50) / 130;
    if (openChance > 0 && Math.random() < openChance) openInvestigation(pickLeadFaction());
    return;
  }
  const inv = S.invest;
  let d = (P.heat - 35) / 8 - P.legitimacy / 45;          // heat builds the case; legitimacy slows it
  if (policyActive("anticorr") && d > 0) d *= 1.5;        // oversight accelerates the case
  inv.evidence = Math.max(0, Math.min(100, inv.evidence + d));
  inv.cycles = (inv.cycles || 0) + 1;
  if (inv.evidence <= 0 && inv.cycles >= 2) {
    log(`⚖️ The investigation against you collapsed for lack of evidence.`, "good");
    applyPolDelta({ legitimacy: 4 });
    S.invest = null;
  } else if (inv.evidence >= 100) {
    log(`⚖️ The evidence is overwhelming — you are indicted and brought to trial.`, "bad");
    holdTrial(false);
  } else {
    log(`⚖️ Investigation continues — evidence ${Math.round(inv.evidence)}/100 (${FACTIONS[inv.lead].name} leading).`, "");
  }
}
function holdTrial(voluntary) {
  const inv = S.invest;
  if (!inv) return;
  const P = S.pol;
  const guilt = inv.evidence + Math.max(0, -P.legitimacy) * 0.6 + P.heat * 0.2;
  const defense = (inv.defense || 0) + Math.max(0, P.legitimacy) * 0.5 + P.popularity * 0.4 + Math.max(0, S.rep[inv.lead] || 0) * 0.3;
  const net = guilt - defense + (Math.random() * 20 - 10);  // jury noise
  const ev = Math.round(inv.evidence);
  S.invest = null;                                          // case is resolved either way
  if (net < 8) {
    applyPolDelta({ legitimacy: 8, popularity: 6 }); S.pol.heat = Math.max(0, S.pol.heat - 40);
    log(`🏛️ Trial verdict: <span class="c">ACQUITTED</span>. You walk free, vindicated — public sympathy swells.`, "good");
    toast("Acquitted!", "good"); if (typeof fireworks === "function") fireworks(1800, false);
  } else if (net < 30) {
    const fine = Math.min(S.res.credits, 3000 + ev * 60);
    S.res.credits -= fine; applyPolDelta({ heat: -20, legitimacy: -2 });
    log(`🏛️ Trial verdict: <span class="c">FINED</span> ${fmt(fine)} credits for minor improprieties.`, "bad");
    toast(`Fined ${fmt(fine)} cr.`, "bad");
  } else if (net < 60) {
    S.res.influence = Math.max(0, (S.res.influence || 0) - 30);
    addRep(inv.lead, -10); applyPolDelta({ popularity: -10, legitimacy: -6, heat: -25 });
    log(`🏛️ Trial verdict: <span class="c">CENSURED</span>. Your influence and standing take a public beating.`, "bad");
    toast("Censured.", "bad");
  } else if (net < 90) {
    const office = stripOffice();
    const fine = Math.min(S.res.credits, 4000);
    S.res.credits -= fine; S.res.influence = Math.max(0, (S.res.influence || 0) - 40);
    applyPolDelta({ popularity: -12, legitimacy: -8, heat: -20 });
    log(`🏛️ Trial verdict: <span class="c">REMOVED FROM OFFICE</span>${office ? ` — you lose your ${office} title` : ""}, and fined ${fmt(fine)} credits.`, "bad");
    toast("Removed from office.", "bad");
  } else if (net < 120) {
    const office = stripOffice();
    S.jail = 2; const fine = Math.min(S.res.credits, 3000); S.res.credits -= fine;
    applyPolDelta({ popularity: -15, legitimacy: -10 }); S.pol.heat = 10;
    log(`🏛️ Trial verdict: <span class="c">IMPRISONED</span> for 2 cycles${office ? `, stripped of your ${office} title` : ""}, and fined ${fmt(fine)} credits.`, "bad");
    toast("Imprisoned!", "bad");
    if (typeof announce === "function") announce("⛓️ Imprisoned", "You are jailed for 2 cycles. Your machine runs on without you.", true);
  } else {
    // disgrace & exile — the political career is wiped (you remain a trader)
    S.office = 0; S.officePath = null; S.term = 0;
    S.perks.senator = false; S.perks.governor = false;
    S.orgs = {}; S.policies = {}; S.floor = null; S.decrees = { monopoly: null, tariff: null };
    S.pol = { popularity: 5, legitimacy: -55, heat: 0, slush: 0 }; S.res.influence = 0; S.jail = 2;
    log(`🏛️ Trial verdict: <span class="c">DISGRACED & EXILED</span>. You are stripped of every office, organization and law — your political career lies in ruins.`, "bad");
    toast("Disgraced and exiled.", "bad");
    if (typeof announce === "function") announce("🏛️ Disgraced", "Stripped of all office and power. You'll have to rebuild — or return to trade.", true);
  }
}
function stripOffice() {
  if ((S.office || 0) < 1) return "";
  const lost = OFFICES[S.office].name;
  S.office--; syncOfficePerks();
  S.term = (S.office >= 1 && OFFICES[S.office]) ? OFFICES[S.office].term : 0;
  return lost;
}
/* ----- countermeasures (each costs 1 action) ----- */
function investAct() { return S.invest && actionsLeft() > 0; }
function investLawyer() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const cost = 1500;
  if (S.res.credits < cost) return toast("Need 1,500 credits.", "bad");
  S.res.credits -= cost; S.invest.defense += 12; S.invest.evidence = Math.max(0, S.invest.evidence - 4);
  applyPolDelta({ legitimacy: 1 }); useAction();
  log("⚖️ Your lawyers build the defense and chip at the case.", "good"); afterAction();
}
function investBribe() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const cost = 800;
  if (S.pol.slush < cost) return toast("Need 800 slush.", "bad");
  S.pol.slush -= cost; useAction();
  if (Math.random() < 0.65) { S.invest.evidence = Math.max(0, S.invest.evidence - 18); log("💼 A quiet payment makes evidence vanish.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 12); applyPolDelta({ heat: 10, legitimacy: -4 }); log("💼 Your bribe was exposed — it backfires badly!", "bad"); }
  afterAction();
}
function investSpin() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.media) return toast("Requires a Media Network.", "bad");
  const cost = 600;
  if (S.res.credits < cost) return toast("Need 600 credits.", "bad");
  S.res.credits -= cost; S.invest.evidence = Math.max(0, S.invest.evidence - 6); applyPolDelta({ heat: -8 });
  useAction(); log("🧼 Your media spins the story — the case softens.", "good"); afterAction();
}
function investBury() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.intel) return toast("Requires an Intelligence Cell.", "bad");
  const cost = 1000;
  if (S.res.credits < cost) return toast("Need 1,000 credits.", "bad");
  S.res.credits -= cost; useAction();
  if (Math.random() < 0.85) { S.invest.evidence = Math.max(0, S.invest.evidence - 14); applyPolDelta({ legitimacy: -2 }); log("🗄️ Evidence quietly disappears.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 8); applyPolDelta({ heat: 8, legitimacy: -3 }); log("🗄️ Your operatives were caught tampering — it backfires!", "bad"); }
  afterAction();
}
function investStrongarm() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  if (!S.orgs.pmc) return toast("Requires Private Security.", "bad");
  const cost = 8;
  if ((S.res.influence || 0) < cost) return toast("Need 8 influence.", "bad");
  S.res.influence -= cost; useAction();
  if (Math.random() < 0.7) { S.invest.evidence = Math.max(0, S.invest.evidence - 12); applyPolDelta({ heat: 6, legitimacy: -3 }); log("😠 Witnesses suddenly forget what they saw.", "event"); }
  else { S.invest.evidence = Math.min(100, S.invest.evidence + 8); applyPolDelta({ heat: 12, legitimacy: -4 }); log("😠 The intimidation leaks — outrage strengthens the case!", "bad"); }
  afterAction();
}
function investScapegoat() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  const ids = Object.keys(S.orgs || {});
  if (!ids.length) return toast("No organization to scapegoat.", "bad");
  ids.sort((a, b) => orgDef(a).foundCost * S.orgs[a].tier - orgDef(b).foundCost * S.orgs[b].tier);
  const victim = ids[0], d = orgDef(victim);
  delete S.orgs[victim];
  S.invest.evidence = Math.max(0, S.invest.evidence - 30); applyPolDelta({ popularity: -6, legitimacy: -2 });
  useAction();
  log(`🪤 You pin it all on ${d.ico} ${d.name} — the organization is dissolved and the case weakens.`, "event");
  afterAction();
}
function faceTrial() {
  if (!investAct()) return toast(S.invest ? "No actions left." : "No active case.", "bad");
  useAction(); holdTrial(true); afterAction();
}

/* ---------- Public office: elections, appointments, coups & terms ---------- */
function syncOfficePerks() {
  S.perks.senator = (S.office >= 2);
  S.perks.governor = (S.office >= 3);
  if (S.office < 3) S.decrees = { monopoly: null, tariff: null };
}
function takeOffice(level, path) {
  S.office = level; S.officePath = path;
  S.term = (OFFICES[level] && OFFICES[level].term) || 0;
  syncOfficePerks();
  if (level >= 4) politicalLegacy(path);
}
function repAverage() { return Object.keys(FACTIONS).reduce((s, f) => s + (S.rep[f] || 0), 0) / Object.keys(FACTIONS).length; }
function officeGuard(lvl) {
  if (!canPolitick()) { toast("Research Galactic Charter first.", "bad"); return false; }
  if (!OFFICES[lvl]) { toast("You already hold the highest office.", "bad"); return false; }
  if (actionsLeft() <= 0) { toast("No actions left — end the cycle.", "bad"); return false; }
  return true;
}
function runForElection() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needPop = ELECT_POP[lvl], chest = 2000 * lvl;
  if (S.pol.popularity < needPop) return toast(`Need ${needPop} popularity to run.`, "bad");
  if (S.res.credits < chest) return toast(`Need ${fmt(chest)} credits for the campaign.`, "bad");
  S.res.credits -= chest; useAction();
  const score = S.pol.popularity + S.pol.legitimacy * 0.3 + repAverage() * 0.2 + Math.random() * 20;
  const opponent = 42 + 12 * lvl + Math.random() * 20;
  if (score > opponent) {
    takeOffice(lvl, "elected");
    applyPolDelta({ legitimacy: 6, popularity: -4 });
    Object.keys(FACTIONS).forEach(f => addRep(f, 1));
    log(`🗳️ You WON the election for <span class="c">${off.name}</span>! (${Math.round(score)}–${Math.round(opponent)})`, "good");
    toast(`Elected ${off.name}!`, "good");
    if (typeof fireworks === "function") fireworks(2000, false);
  } else {
    applyPolDelta({ popularity: -5, heat: 2 });
    log(`🗳️ You lost the election for ${off.name} (${Math.round(score)}–${Math.round(opponent)}); your campaign chest is spent.`, "bad");
    toast("Election lost.", "bad");
  }
  afterAction();
}
function seekAppointment() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needInf = APPOINT_INF[lvl], needRep = APPOINT_REP[lvl], cost = 3000 * lvl;
  const patron = Object.keys(FACTIONS).filter(f => (S.rep[f] || 0) >= needRep).sort((a, b) => (S.rep[b] || 0) - (S.rep[a] || 0))[0];
  if ((S.res.influence || 0) < needInf) return toast(`Need ${needInf} influence.`, "bad");
  if (!patron) return toast(`Need a faction ally at ${needRep}+ reputation to back you.`, "bad");
  if (S.res.credits < cost) return toast(`Need ${fmt(cost)} credits.`, "bad");
  S.res.influence -= needInf; S.res.credits -= cost; useAction();
  takeOffice(lvl, "appointed");
  addRep(patron, 4);
  Object.keys(FACTIONS).forEach(f => { if (f !== patron) addRep(f, -3); });
  applyPolDelta({ heat: 4 });
  log(`🤝 ${FACTIONS[patron].ico} ${FACTIONS[patron].name} installed you as <span class="c">${off.name}</span>.`, "event");
  toast(`Appointed ${off.name}.`, "event");
  afterAction();
}
function stageCoup() {
  const lvl = (S.office || 0) + 1;
  if (!officeGuard(lvl)) return;
  const off = OFFICES[lvl], needPmc = COUP_PMC[lvl];
  const pmcTier = (S.orgs.pmc && S.orgs.pmc.tier) || 0, costInf = 20 * lvl, costSlush = 1000 * lvl;
  if (pmcTier < needPmc) return toast(`Need Private Security tier ${needPmc} to seize power.`, "bad");
  if ((S.res.influence || 0) < costInf) return toast(`Need ${costInf} influence.`, "bad");
  if (S.pol.slush < costSlush) return toast(`Need ${fmt(costSlush)} slush to fund the plot.`, "bad");
  const chance = Math.min(0.9, 0.35 + pmcTier * 0.12 - lvl * 0.05);
  if (typeof confirm === "function"
      && !confirm(`Attempt to seize the office of ${off.name} by force? Costs ${fmt(costInf)} influence and ${fmt(costSlush)} slush, `
        + `roughly a ${Math.round(chance * 100)}% chance of success, and craters your legitimacy and faction standing either way. This cannot be undone.`)) return;
  S.res.influence -= costInf; S.pol.slush -= costSlush; useAction();
  if (Math.random() < chance) {
    takeOffice(lvl, "seized");
    applyPolDelta({ legitimacy: -25, popularity: -15, heat: 30 });
    Object.keys(FACTIONS).forEach(f => addRep(f, -8));
    log(`⚔️ Your forces SEIZE power — you are <span class="c">${off.name}</span> by force! The factions seethe and investigators take note.`, "bad");
    toast(`Seized ${off.name}!`, "event");
  } else {
    applyPolDelta({ legitimacy: -10, heat: 40 });
    Object.keys(FACTIONS).forEach(f => addRep(f, -6));
    if (S.orgs.pmc) { S.orgs.pmc.tier--; if (S.orgs.pmc.tier <= 0) delete S.orgs.pmc; }
    log(`⚔️ The coup FAILED! Your security is shattered, the factions turn on you, and the heat is blistering.`, "bad");
    toast("Coup failed!", "bad");
  }
  afterAction();
}
function processOffice() {
  if (!S.office || S.office >= 4) return;     // no office, or Consul (life tenure)
  if (S.term > 0) { S.term--; if (S.term > 0) return; } else return;
  const lvl = S.office, off = OFFICES[lvl];
  let keep;
  if (S.officePath === "seized") {
    keep = ((S.orgs.pmc && S.orgs.pmc.tier) || 0) >= COUP_PMC[lvl];   // hold only while armed
  } else {
    keep = (S.pol.popularity + S.pol.legitimacy * 0.3 + repAverage() * 0.2) >= (ELECT_POP[lvl] - 8);
  }
  if (keep) {
    S.term = off.term;
    log(`🗳️ Your mandate as ${off.name} is renewed for another term.`, "good");
  } else {
    S.office = lvl - 1; syncOfficePerks();
    S.term = (S.office >= 1 && OFFICES[S.office]) ? OFFICES[S.office].term : 0;
    applyPolDelta({ popularity: -4 });
    log(`🗳️ Your term as ${off.name} ended and you were not retained — you fall back to ${officeName(S.office)}.`, "bad");
    toast(`Lost office: ${off.name}.`, "bad");
  }
}
function politicalLegacy(path) {
  if (S.legacyTitle) return;
  const P = S.pol;
  let title, blurb;
  if (path === "seized") { title = "The Consul"; blurb = "You seized supreme power by force and rule the sector by decree."; }
  else if (path === "elected" && P.popularity >= 70) { title = "The Demagogue"; blurb = "A landslide of public adoration carried you to absolute power."; }
  else if (P.legitimacy >= 40) { title = "The Statesman"; blurb = "You reached the summit with clean hands and a sterling name."; }
  else if (P.slush > 0 || P.legitimacy < 0) { title = "The Kingpin"; blurb = "You bought and blackmailed your way to the top; the sector is yours in all but name."; }
  else { title = "First Consul"; blurb = "You have ascended to supreme authority over the sector."; }
  S.legacyTitle = title;
  log(`🏛️ POLITICAL LEGACY — <span class="c">${title}</span>: ${blurb}`, "good");
  jot(`POLITICAL LEGACY: ${title} — ${blurb}`, "legacy");
  if (typeof announce === "function") announce(`⭐ ${title}`, `${blurb} Your political legacy is complete!`, true);
  if (typeof fireworks === "function") fireworks(8000, true);
  if (!S.won) S.won = true;
  toast(`⭐ ${title} — political legacy complete!`, "good");
}

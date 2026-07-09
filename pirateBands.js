/* ============================================================
   STELLAR FRONTIER — pirate bands
   A persistent roster of named crews you build history with. Fighting them
   drops their collaboration (rep); allying, sparing, gifts and your fearsome
   dread raise it. Friendly bands accept smaller loot shares, rally readily,
   and can be hired as escorts. Bands can hold blood feuds with each other
   (bought truces or full reconciliation settle them), carry a player-set
   tag (brotherhood/ally/watch/rival), and can be called to stand by, follow
   you, or answer into a fight as an ally.

   Loaded after combat.js, before game.js. saveGame, renderAll, digestNote
   and bandOnMandate still live in game.js at this point in the split —
   safe, since every function here is only CALLED later, once every script
   has finished loading, same pattern as every prior slice.
   ============================================================ */

"use strict";

const BAND_NAMES = ["Crimson Wake", "Hollow Star", "Ironjaw Pack", "Void Jackals", "Ashen Crows",
  "Rust Reapers", "Pale Mourners", "Gilded Vultures", "Black Tide", "Sable Lances", "Gravewind", "Salt Wolves"];
const BAND_TIERS = [
  { min: 76, key: "sworn", label: "👑 Sworn" },
  { min: 41, key: "friendly", label: "🤝 Friendly" },
  { min: -10, key: "neutral", label: "😐 Neutral" },
  { min: -40, key: "wary", label: "🤨 Wary" },
  { min: -101, key: "hostile", label: "☠️ Hostile" },
];
// Personalities flavour how a band haggles, hires and holds the line.
const BAND_PERSONALITIES = {
  greedy:    { ico: "🤑", name: "Greedy",    cut: 0.06,  fee: 1.25, betray: 0.08,  fp: 1.0,  steal: true },
  loyal:     { ico: "🛡️", name: "Loyal",     cut: -0.03, fee: 0.90, betray: -0.14, fp: 1.0,  steal: false },
  bold:      { ico: "⚔️", name: "Bold",      cut: 0.0,   fee: 1.05, betray: 0.02,  fp: 1.22, steal: false },
  cunning:   { ico: "🦊", name: "Cunning",   cut: 0.02,  fee: 1.0,  betray: 0.05,  fp: 1.0,  steal: true },
  honorable: { ico: "⚖️", name: "Honorable", cut: -0.02, fee: 1.0,  betray: -0.20, fp: 1.06, steal: false },
};
const BAND_PERS_KEYS = Object.keys(BAND_PERSONALITIES);
function bandPers(b) { return BAND_PERSONALITIES[(b && b.pers)] || BAND_PERSONALITIES.bold; }
function ensureBands() { if (!S.pirateBands) S.pirateBands = {}; return S.pirateBands; }
function bandList() { return Object.values(ensureBands()).filter(b => b.status !== "dead"); }
function bandById(id) { return ensureBands()[id] || null; }
function bandTier(b) { const r = (b && b.rep) || 0; return BAND_TIERS.find(t => r >= t.min) || BAND_TIERS[BAND_TIERS.length - 1]; }
function bandRepAdd(b, n) { if (!b) return; b.rep = Math.max(-100, Math.min(100, Math.round((b.rep || 0) + n))); }
function bandFoe(b) { return b && b.feudWith ? bandById(b.feudWith) : null; }
function newBand(level) {
  ensureBands();
  const used = new Set(Object.values(S.pirateBands).map(b => b.name));
  const name = BAND_NAMES.filter(n => !used.has(n))[0] || ("Free Company " + (Object.keys(S.pirateBands).length + 1));
  const lvl = Math.max(1, Math.min(5, level || rint(1, 3)));
  const id = "b" + (S.turn || 0) + "_" + Object.keys(S.pirateBands).length + "_" + Math.floor(Math.random() * 1000);
  const b = { id, name, ico: (PIRATE_RANKS[lvl] || PIRATE_RANKS[1]).ico, level: lvl, rep: 0, pers: pick(BAND_PERS_KEYS),
    encounters: 0, fought: 0, allied: 0, gifted: 0, lastSeen: S.turn || 0, status: "active", feudWith: null,
    tag: null, loc: (PLANETS.filter(isActive)[Math.floor(Math.random() * Math.max(1, PLANETS.filter(isActive).length))] || PLANETS[0]).id,
    inboundTurn: null, onCallUntil: 0, busyUntil: 0, follow: false, followUntil: 0, haven: null };
  S.pirateBands[id] = b;
  // some crews are blood rivals with an existing band — they won't serve together
  const others = Object.values(S.pirateBands).filter(o => o.id !== id && !o.feudWith && o.status !== "dead");
  if (others.length && Math.random() < 0.35) { const rival = pick(others); const d = rint(1, 3); b.feudWith = rival.id; b.feudDepth = d; rival.feudWith = id; rival.feudDepth = d; }
  return b;
}
// tie a transient foe/ally to a band identity (reuse known crews so history accrues)
function bindBand(foe, preferAlly) {
  if (!foe || foe.bandId) return bandById(foe && foe.bandId);
  const pool = bandList();
  let b = null;
  if (pool.length && Math.random() < 0.6) {
    if (preferAlly) { const friendly = pool.filter(x => (x.rep || 0) > -40); if (friendly.length) b = friendly.sort((a, c) => (c.rep || 0) - (a.rep || 0))[0]; }
    if (!b) b = pool[Math.floor(Math.random() * pool.length)];
  }
  if (!b) b = newBand(foe.level || rint(1, 3));
  foe.bandId = b.id; foe.bandName = b.name;
  b.encounters++; b.lastSeen = S.turn || 0; b.loc = S.location || b.loc;   // last seen here
  return b;
}
// the cut an allied band demands of the loot — stronger want more, friends & your dread shave it
function bandLootShare(b) {
  let s = 0.18 + (b ? b.level : 2) * 0.04;
  s -= ((b && b.rep) || 0) / 100 * 0.12;
  s -= Math.min(0.10, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.10);
  s += bandPers(b).cut;                                   // greedy crews want more, honourable less
  return Math.max(0.05, Math.min(0.45, s));
}
// a feuding band refuses to serve alongside its rival
function bandRivalServing(b) {
  const rivalId = b && b.feudWith; if (!rivalId) return false;
  if (bandTruceActive(b)) return false;                    // a bought truce lets former rivals serve together
  if ((S.allies || []).some(a => a.bandId === rivalId)) return true;
  if (S.escort && S.escort.fleet && S.escort.fleet.some(s => s.hired && s.alive && s.bandId === rivalId)) return true;
  return false;
}
function bandWillAlly(b) { return bandTier(b).key !== "hostile" && !bandRivalServing(b); }   // sworn enemies & rivals-of-an-ally refuse
// blood feuds run 1–3 deep; you can broker peace for a price that scales with the
// depth and eases with your standing (they trust you) and Dread (they fear you).
function bandFeudDepth(b) { return b && b.feudWith ? (b.feudDepth || 2) : 0; }
const BAND_TRUCE_DURATION = 6;   // cycles a bought truce holds before the feud smoulders back
function bandTruceActive(b) { return !!(b && b.feudWith && b.truceUntil && S.turn <= b.truceUntil); }
function bandTruceCost(b) { return bandFoe(b) ? Math.max(120, Math.round(bandReconcileCost(b) * 0.35)) : 0; }   // a fraction of a full settlement
function brokerTruce(id) {
  const b = bandById(id), rival = bandFoe(b);
  if (!b || !rival) return toast("No feud to settle there.", "bad");
  const cost = bandTruceCost(b);
  if ((S.res.credits || 0) < cost) return toast(`A truce costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  const until = S.turn + BAND_TRUCE_DURATION;
  b.truceUntil = until; rival.truceUntil = until;
  log(`🕊️ You bought a ${BAND_TRUCE_DURATION}-cycle truce between the ${b.ico} ${b.name} and the ${rival.ico} ${rival.name} for ${fmt(cost)} cr — they'll set the feud aside for now.`, "event");
  toast(`Truce: ${b.name} & ${rival.name} (${BAND_TRUCE_DURATION} cyc)`, "good"); sfx("event"); saveGame(); renderAll();
}
function processTruces() {       // lapsed truces let the feud smoulder back
  const seen = {};
  bandList().forEach(b => {
    if (b.truceUntil && S.turn > b.truceUntil) {
      const rival = bandById(b.feudWith), key = [b.id, b.feudWith || ""].sort().join("|");
      b.truceUntil = 0;
      if (!seen[key]) { seen[key] = true; log(`⚔️ The truce between the ${b.ico} ${b.name}${rival ? ` and the ${rival.ico} ${rival.name}` : ""} has lapsed — their feud smoulders again.`, ""); }
    }
  });
}
function bandReconcileCost(b) {
  const rival = bandFoe(b); if (!rival) return 0;
  const depth = bandFeudDepth(b);
  const repAvg = (((b.rep || 0) + (rival.rep || 0)) / 2);
  const standMult = 1 - Math.max(-0.2, Math.min(0.5, repAvg / 100 * 0.5));     // friendly crews → cheaper; hostile → pricier
  const dreadMult = 1 - Math.min(0.3, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.3);
  return Math.max(300, Math.round(1500 * depth * standMult * dreadMult));
}
function reconcileBands(id) {
  const b = bandById(id), rival = bandFoe(b);
  if (!b || !rival) return toast("No feud to settle there.", "bad");
  const cost = bandReconcileCost(b);
  if ((S.res.credits || 0) < cost) return toast(`Brokering this peace costs ${fmt(cost)} cr.`, "bad");
  S.res.credits -= cost;
  b.feudWith = null; b.feudDepth = 0; b.truceUntil = 0; rival.feudWith = null; rival.feudDepth = 0; rival.truceUntil = 0;
  bandRepAdd(b, 4); bandRepAdd(rival, 4);                                      // both crews are grateful
  log(`🕊️ You brokered peace between the ${b.ico} ${b.name} and the ${rival.ico} ${rival.name} for ${fmt(cost)} cr — their feud is settled and they'll serve side by side now.`, "event");
  toast(`Peace brokered: ${b.name} & ${rival.name}`, "good"); sfx("event"); saveGame(); renderAll();
}
function giftRepFromCredits(amt) { return Math.min(15, Math.floor(amt / 400)); }
const GIFT_VALUED = { weapons: 1.6, ai: 1.8, luxury: 1.5, fuel: 1.3, drones: 1.5 };
function giftRepFromCargo(c, qty) { const base = (COM[c] ? COM[c].base : 50) * qty / 300; return Math.min(20, Math.max(1, Math.round(base * (GIFT_VALUED[c] || 1)))); }
function giftBandCredits(id, amt) {
  const b = bandById(id); if (!b) return;
  amt = Math.min(amt, S.res.credits);
  if (amt < 100) return toast("A tribute needs at least 100 cr.", "bad");
  S.res.credits -= amt; b.gifted = (b.gifted || 0) + amt;
  const g = giftRepFromCredits(amt); bandRepAdd(b, g);
  log(`🎁 Paid the ${b.ico} ${b.name} a ${fmt(amt)} cr tribute — collaboration +${g}.`, "good");
  toast(`${b.name}: +${g} standing`, "good"); sfx("event"); saveGame(); renderAll();
}
function giftBandCargo(id, c, qty) {
  const b = bandById(id); if (!b) return;
  qty = Math.min(qty, S.res[c] || 0); if (qty <= 0) return toast(`No ${COM[c].name} to give.`, "bad");
  S.res[c] -= qty; const g = giftRepFromCargo(c, qty); bandRepAdd(b, g);
  log(`🎁 Gifted ${qty} ${COM[c].ico} ${COM[c].name} to the ${b.ico} ${b.name} — collaboration +${g}.`, "good");
  toast(`${b.name}: +${g} standing`, "good"); sfx("event"); saveGame(); renderAll();
}
function decayBands() {                                  // standings drift toward neutral over time
  bandList().forEach(b => { if (b.rep > 0) b.rep = Math.max(0, b.rep - 1); else if (b.rep < 0) b.rep = Math.min(0, b.rep + 1); });
}
// escort recruitment: friendly bands hire on as escort ships for a negotiated fee
function escortRecruitBaseFee(b) { return Math.round((800 + b.level * 700) * (1 - ((b.rep || 0) / 100) * 0.4) * bandPers(b).fee); }
// a struck bargain (setBandNegotiatedFee, via 💬 Talk) undercuts the base fee for a
// few cycles or until spent, whichever comes first — same lapse pattern as a truce
const NEGOTIATED_DEAL_DURATION = 5;
function bandNegotiatedFee(b) { return (b && b.negotiatedFee != null && b.negotiatedUntil && S.turn <= b.negotiatedUntil) ? b.negotiatedFee : null; }
function escortRecruitFee(b) { const nf = bandNegotiatedFee(b); return nf != null ? nf : escortRecruitBaseFee(b); }
// a haggled price can swing 40%-150% of the base rate either way — cheap enough to reward
// a good pitch, but never a giveaway, and a lowball can still get countered upward
function bandNegotiationBounds(b) { const base = escortRecruitBaseFee(b); return { lo: Math.round(base * 0.4), hi: Math.round(base * 1.5) }; }
function setBandNegotiatedFee(id, amount) {
  const b = bandById(id); if (!b) return;
  const { lo, hi } = bandNegotiationBounds(b);
  const fee = Math.max(lo, Math.min(hi, Math.round(amount)));
  b.negotiatedFee = fee; b.negotiatedUntil = (S.turn || 0) + NEGOTIATED_DEAL_DURATION;
  log(`🤝 The ${b.ico} ${b.name} agreed to hire on for ${fmt(fee)} cr — the deal holds for ${NEGOTIATED_DEAL_DURATION} cycles or until you sign them on.`, "good");
  toast(`${b.name}: ${fmt(fee)} cr deal struck`, "good"); sfx("event"); saveGame();
  // renderAll(), not just renderContacts() — the struck fee also changes what the (currently
  // hidden) Escort tab shows, and setTab() only toggles visibility, never re-renders on switch
  if (typeof renderAll === "function") renderAll();
  return fee;
}
/* ---- Negotiation outcome: decided here, not by the LLM (see pirateChat.js's
   ollamaNegotiate) — an AI model asked to both roleplay AND emit a reliable,
   parseable price has, in practice, been the persistent source of every
   negotiation bug filed against this feature (missing/duplicated/reworded
   decision lines from one small model after another). The model's only job
   now is narrating a decision the game already made; the actual price
   players hire at can never depend on how faithfully a model followed an
   output format. Deterministic given a supplied `rand` (tests can pin it
   down); real calls default to Math.random(). ---- */
// odds of an outright ACCEPT at the offered price — climbs steeply as the offer
// approaches (and passes) the going rate; friendlier standing nudges it up further,
// personality reuses its existing loot-cut lean as a proxy for negotiating generosity
function bandNegotiationAcceptChance(b, offer) {
  const ratio = offer / escortRecruitBaseFee(b);
  let p = ratio >= 1 ? 0.92 : ratio >= 0.85 ? 0.65 : ratio >= 0.7 ? 0.35 : ratio >= 0.55 ? 0.12 : 0.02;
  p += ((b.rep || 0) / 100) * 0.15;
  p += bandPers(b).cut < 0 ? 0.06 : bandPers(b).cut > 0.03 ? -0.08 : 0;
  return Math.max(0.02, Math.min(0.97, p));
}
// odds of a flat REJECT (drawn from what's left after an ACCEPT roll fails) — only a
// genuine lowball risks this; a fair-ish offer is always at least countered, never refused
function bandNegotiationRejectChance(b, offer) {
  const ratio = offer / escortRecruitBaseFee(b);
  if (ratio >= 0.7) return 0;
  let p = ratio >= 0.55 ? 0.10 : ratio >= 0.4 ? 0.35 : 0.65;
  p -= ((b.rep || 0) / 100) * 0.2;
  return Math.max(0, Math.min(0.85, p));
}
// the price named back when neither ACCEPT nor REJECT fires — splits the gap between the
// offer and the going rate (greedier personalities push closer to, or past, the full rate)
function bandNegotiationCounterPrice(b, offer) {
  const base = escortRecruitBaseFee(b), bounds = bandNegotiationBounds(b);
  const push = 0.5 + (bandPers(b).cut > 0.03 ? 0.25 : bandPers(b).cut < 0 ? -0.15 : 0);
  const price = offer + Math.max(0, base - offer) * push + (offer >= base ? base * 0.08 : 0);
  return Math.max(bounds.lo, Math.min(bounds.hi, Math.round(price)));
}
// the single entry point: { status: "accept"|"counter"|"reject", amount }
function decideNegotiation(b, offer, rand) {
  const r = rand == null ? Math.random() : rand;
  if (r < bandNegotiationAcceptChance(b, offer)) return { status: "accept", amount: Math.round(offer) };
  if (r >= 1 - bandNegotiationRejectChance(b, offer)) return { status: "reject", amount: null };
  return { status: "counter", amount: bandNegotiationCounterPrice(b, offer) };
}
function escortRecruitableBands() { return bandList().filter(b => ["neutral", "friendly", "sworn"].includes(bandTier(b).key) && !bandOnMandate(b) && !bandBusy(b)); }   // crews under contract / tied up can't be hired
function bandBetrayChance(b) { return Math.max(0, Math.min(0.6, 0.26 - ((b.rep || 0) / 100) * 0.32 - Math.min(0.18, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.18) + bandPers(b).betray)); }
/* ---- Tags (your loose brotherhood) + location + call-for-support ---- */
const BAND_TAGS = {
  brotherhood: { ico: "⭐", name: "Brotherhood", loyal: true },
  ally:        { ico: "🟢", name: "Ally",        loyal: true },
  watch:       { ico: "👁️", name: "Watch",       loyal: false },
  rival:       { ico: "🔴", name: "Rival",       loyal: false },
};
const BAND_TAG_KEYS = Object.keys(BAND_TAGS);
function bandTagMark(b) { return b && b.tag && BAND_TAGS[b.tag] ? BAND_TAGS[b.tag].ico : ""; }
function bandTagLoyal(b) { return !!(b && b.tag && BAND_TAGS[b.tag] && BAND_TAGS[b.tag].loyal); }
function setBandTag(id, tag) {
  const b = bandById(id); if (!b) return;
  b.tag = (b.tag === tag) ? null : (BAND_TAGS[tag] ? tag : null);   // toggle off if same
  saveGame(); renderAll();
}
function bandLocName(b) { const p = b && b.loc && PLANETS.find(x => x.id === b.loc); return p ? p.name : "parts unknown"; }
function bandDistance(b) { if (!b || !b.loc) return 6; if (b.loc === S.location) return 0; const d = currentPlanet().distances; return (d && d[b.loc]) || 6; }
const BAND_ONCALL_DURATION = 4;     // cycles a summoned band loiters in your area, ready to fight
const BAND_FOLLOW_DURATION = 6;     // cycles a band will travel WITH you once you ask them to follow
function bandFollowing(b) { return !!(b && b.follow && b.followUntil && S.turn <= b.followUntil); }
function bandOnCall(b) { return !!(b && ((b.onCallUntil && S.turn <= b.onCallUntil) || bandFollowing(b))); }
function bandInbound(b) { return !!(b && b.inboundTurn != null); }
function bandBusy(b) { return !!(b && b.busyUntil && S.turn < b.busyUntil); }
function bandsOnCall() { return bandList().filter(bandOnCall); }
// crews you can pull into the CURRENT fight: standing-by/following ones, plus willing crews based right here ("on site")
function bandsRaidable() { return bandList().filter(b => b.status !== "dead" && bandWillAlly(b) && (bandOnCall(b) || bandDistance(b) === 0)); }
// odds a band answers a call for support — rep, distance, brotherhood, your dread; nil if busy
function bandSupportOdds(b) {
  if (bandBusy(b) || !bandWillAlly(b)) return 0;
  let p = 0.35 + ((b.rep || 0) / 100) * 0.4 - bandDistance(b) * 0.03 + Math.min(0.15, ((S.pirate && S.pirate.dread) || 0) / 100 * 0.15);
  if (bandTagLoyal(b)) p += 0.2;
  return Math.max(0, Math.min(0.95, p));
}
function callBandSupport(id) {
  const b = bandById(id); if (!b) return;
  if (bandFollowing(b)) return toast(`The ${b.name} are already riding with you.`, "");
  if (bandOnCall(b)) return toast(`The ${b.name} are already standing by.`, "");
  if (bandInbound(b)) return toast(`The ${b.name} are already inbound.`, "");
  if (bandBusy(b)) return toast(`The ${b.name} are tied up with their own business right now.`, "bad");
  if (!bandWillAlly(b)) return toast(`The ${b.name} bear you too much ill will to answer.`, "bad");
  const dist = bandDistance(b);
  if (dist === 0) { b.onCallUntil = S.turn + BAND_ONCALL_DURATION; log(`📣 The ${b.ico} ${b.name} are right here and fall in with you.`, "event"); toast(`${b.name} standing by`, "good"); sfx("event"); saveGame(); renderAll(); return; }
  if (Math.random() < bandSupportOdds(b)) {
    const travel = Math.max(1, Math.round(dist / 4));
    b.inboundTurn = S.turn + travel;
    log(`📣 The ${b.ico} ${b.name} answered your call from ${bandLocName(b)} — inbound in ${travel} cycle${travel === 1 ? "" : "s"}.`, "event");
    toast(`${b.name} inbound (${travel} cyc)`, "good"); sfx("event");
  } else {
    b.busyUntil = S.turn + rint(1, 3);
    log(`📣 The ${b.ico} ${b.name} declined — too far, or busy with their own affairs.`, "bad");
    toast(`${b.name} declined`, "bad");
  }
  saveGame(); renderAll();
}
// ask a standing-by band to travel WITH you for a stretch — they jump where you jump
function bandFollow(id) {
  const b = bandById(id); if (!b) return;
  if (bandInbound(b)) return toast(`The ${b.name} haven't arrived yet.`, "bad");
  if (!bandOnCall(b)) return toast(`The ${b.name} aren't standing by — call them first.`, "bad");
  const fresh = !bandFollowing(b);
  b.follow = true; b.followUntil = S.turn + BAND_FOLLOW_DURATION; b.loc = S.location || b.loc;
  log(`🛰️ The ${b.ico} ${b.name} ${fresh ? "fall in and will ride with you" : "agree to keep riding with you"} for ${BAND_FOLLOW_DURATION} cycles.`, "event");
  toast(`${b.name} ${fresh ? "following" : "still following"} (${BAND_FOLLOW_DURATION} cyc)`, "good"); sfx("event");
  saveGame(); renderAll();
}
// send a called / inbound / following band home early, freeing them up
function bandStandDown(id) {
  const b = bandById(id); if (!b) return;
  if (!bandInbound(b) && !bandOnCall(b)) return;
  const was = bandInbound(b) ? "recalled before arrival" : "stood down";
  b.inboundTurn = null; b.onCallUntil = 0; b.follow = false; b.followUntil = 0;
  log(`✖ The ${b.ico} ${b.name} were ${was} and return to their own affairs.`, "");
  toast(`${b.name} ${was}`, ""); saveGame(); renderAll();
}
function processBandSupport() {                          // arrivals + travelling companions, each cycle
  bandList().forEach(b => {
    if (b.inboundTurn != null && S.turn >= b.inboundTurn) {
      b.inboundTurn = null; b.onCallUntil = S.turn + BAND_ONCALL_DURATION; b.loc = S.location || b.loc;
      log(`🛬 The ${b.ico} ${b.name} arrived and are standing by your position.`, "event");
      if (typeof toast === "function") toast(`${b.name} has arrived`, "good");
      digestNote("arrivals", `${b.name} arrived`);
    }
    if (bandFollowing(b)) {
      b.loc = S.location || b.loc;                       // a following crew jumps where you jump — callable anywhere
    } else if (b.follow && b.followUntil && S.turn > b.followUntil) {
      b.follow = false; b.onCallUntil = Math.max(b.onCallUntil || 0, S.turn + BAND_ONCALL_DURATION);   // peel off, linger briefly
      log(`🛰️ The ${b.ico} ${b.name} have ridden with you long enough and break off — still nearby for now.`, "");
    }
  });
}
// synthesize a raid ally / escort support ship from a band
function bandAsAlly(b) {
  return { isPirate: true, bandId: b.id, allyName: b.name, ico: b.ico, name: b.name,
    strength: Math.round(((PIRATE_RANKS[b.level] || PIRATE_RANKS[1]).str) * 0.9), share: bandLootShare(b) };
}
/* ---- Who's actually behind a colony/base raid (colonization.js's baseRaidRoll/
   colonyEventRoll) — ties that event to a real band identity instead of faceless
   "pirates" whenever one's a fit, so the whole rep/feud/negotiation economy this
   file already models bears on your own defense too: a friendly or sworn crew
   never raids you, and a band already hostile toward you is the likelier culprit.
   Weighted, not uniform — lower rep means more weight. Deterministic given a
   supplied `rand` (tests pin it down; real calls default to Math.random()), same
   pattern as decideNegotiation. Returns null (an unnamed raid) only when no band
   is a fit yet — a fresh game with no bands met at all shouldn't be blocked on
   one existing. */
function pickRaidBand(rand) {
  const pool = bandList().filter(b => !["friendly", "sworn"].includes(bandTier(b).key) && !bandBusy(b));
  if (!pool.length) return null;
  const weights = pool.map(b => Math.max(1, 60 - (b.rep || 0)));
  const total = weights.reduce((s, w) => s + w, 0);
  let r = (rand == null ? Math.random() : rand) * total;
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r <= 0) return pool[i]; }
  return pool[pool.length - 1];
}

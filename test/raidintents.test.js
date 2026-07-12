"use strict";
/* Telegraphed enemy intent + morale/rout (raiding.js: assignRaidIntents /
   raidResolveDepartures / raidGroupBroken, executed inside combatStrike): the
   anti-attrition layer. Every dangerous move — 💥 alpha strike, 📡 distress call,
   🚀 drive spool — is ANNOUNCED a round before it lands, each with a hard counter,
   and reinforcements now arrive ONLY through a distress call the player failed to
   silence (the old ambient per-round rolls are gone from combatStrike). Losing the
   leader or half the group breaks the formation: survivors rout instead of
   grinding to the last hull. */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

function foe(overrides) {
  return Object.assign({
    type: "hauler", name: "Hauler", ico: "🚚", faction: "core", cargo: {}, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5,
    isPirate: false, engines: 2, enginesMax: 2, hp: 1000, maxhp: 1000,
  }, overrides || {});
}
function setupFight(run, preyOverrides, packOverrides) {
  const prey = foe(Object.assign({ name: "Anchor" }, preyOverrides));
  const pack = (packOverrides || []).map(o => foe(Object.assign({ name: "Pack" }, o)));
  run(`S = freshState(); rollPrices();
    S.prey = ${JSON.stringify(prey)};
    S.prey.pack = ${JSON.stringify(pack)};
    S.prey._others = []; S.allies = null; S.raidTargets = [];`);
}

test("a hurt hostile telegraphs 🚀 flee instead of vanishing the same instant, then departs a round later", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Runner", hp: 300, maxhp: 1000, cls: "scout", engines: 1, enginesMax: 1 }, [{ name: "Stalwart" }]);
  run(`Math.random = () => 0.0;`);   // guarantees the flee roll (and pins everything else deterministic)
  run(`S.raidTargets = [1];`);       // shoot the OTHER ship so the runner survives to telegraph
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`!!S.prey`), true, "the fight must still be on after the telegraph round");
  assert.equal(run(`S.prey.name`), "Runner", "the runner must NOT have escaped the same round it telegraphed");
  assert.equal(run(`S.prey.intent`), "flee", "the spooling drive must be telegraphed on the foe");
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.name`), "Stalwart", "one round later the runner is gone and the survivor holds the field");
  assert.ok(run(`S.log.some(l => /jumped clear/.test(l.msg))`), "the escape must be logged");
});

test("stripping a spooling foe's 🚀 engines pins it — the telegraphed escape is cancelled, it stays in the fight", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Pinned", hp: 300, maxhp: 1000, cls: "scout", engines: 1, enginesMax: 1 }, [{ name: "Bystander" }]);
  run(`Math.random = () => 0.0; S.raidTargets = [1];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.intent`), "flee");
  run(`S.prey.engines = 0;`);        // the counter: engines stripped between telegraph and execution
  run(`S.raidTargets = [1];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.name`), "Pinned", "a drive-dead foe cannot execute its escape");
  assert.notEqual(run(`S.prey.intent`), "flee", "with its drive dead it can never telegraph escape again — cornered, it fights on");
  assert.ok(run(`S.log.some(l => /pinned/.test(l.msg) && /turns back to the fight/.test(l.msg))`), "the cancelled escape must be logged");
});

test("reinforcements arrive ONLY via a telegraphed 📡 distress call now — never as an ambient background roll", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Victim" }, []);
  run(`S.prey._others = [${JSON.stringify(foe({ name: "Rescuer" }))}];`);   // a rescuer IS available in the area
  run(`Math.random = () => 0.9;`);   // old ambient 20% roll would need < 0.20 — but also suppresses the distress telegraph (0.9 ≥ 0.25)
  for (let i = 0; i < 3; i++) run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.pack.length`), 0, "with no distress call telegraphed, no rescue may EVER arrive ambiently");
  // now let the victim actually get its call out: telegraph, then execution one round later
  run(`S.prey.intent = "distress";`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.pack.length`), 1, "the transmitted call must land the rescue");
  assert.equal(run(`S.prey.pack[0].name`), "Rescuer");
  assert.ok(run(`S.log.some(l => /distress call lands/.test(l.msg))`), "the answered call must be logged");
});

test("during a planetary assault a defender's 📡 call summons the coalition — and a fully shaped battlefield leaves it unanswered", () => {
  const { run } = createSandbox();
  run(`S = freshState(); rollPrices();`);
  const hasSource = run(`
    const src = PLANETS.find(p => p.faction && isActive(p) && !p.hidden &&
      PLANETS.some(o => o.id !== p.id && o.faction === p.faction && isActive(o) && !o.hidden));
    if (src) { globalThis.__target = src; S.location = src.id; }
    !!src;
  `);
  if (!hasSource) return;   // this seed gave every faction one world — nothing to summon
  run(`
    S.prey = Object.assign(${JSON.stringify(foe({ name: "Defender", type: "patrol", isPlanetPatrol: true }))},
      { planetId: __target.id, planetName: __target.name, faction: __target.faction, intent: "distress" });
    S.prey.pack = []; S.prey._others = []; S.allies = null; S.raidTargets = [];
    S.planetAssault = { planetId: __target.id, phase: "patrols", called: 0 };
  `);
  run(`Math.random = () => 0.9;`);   // ambient 18% roll would fail at 0.9 — only the forced call can land this
  run(`combatStrike(false, "kinetic");`);
  assert.ok(run(`S.prey.pack.length`) >= 1, "the executed call must summon a coalition wing despite the hostile RNG");
  assert.ok(run(`S.planetAssault.called`) >= 1);
  // shaped battlefield: divert every remaining source, prime another call — it must go unanswered
  run(`
    S.assaultDiversions = {};
    assaultCoalitionSources(__target).forEach(w => { S.assaultDiversions[w.id] = S.turn + 6; });
    S.prey.intent = "distress";
  `);
  const packBefore = run(`S.prey.pack.length`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.pack.length`), packBefore, "with every responder diverted, the call must summon nothing");
  assert.ok(run(`S.log.some(l => /goes out… and nothing answers/.test(l.msg))`), "the unanswered call must be logged — the player's prep paying off visibly");
});

test("a primed 💥 alpha strike lands with multiplied intensity, and the charge is spent after firing", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Bruiser", elite: true, cls: "cruiser" }, []);
  run(`S.prey.intent = "alpha";`);
  run(`Math.random = () => 0.9;`);   // suppress fresh telegraphs so only the primed alpha matters
  run(`globalThis.__intens = []; const _ofs = foeStrikes; foeStrikes = function(f, i) { __intens.push(i); return _ofs(f, i); };`);
  run(`combatStrike(false, "kinetic");`);
  const seen = JSON.parse(run(`JSON.stringify(__intens)`));
  assert.equal(seen.length, 1);
  assert.ok(Math.abs(seen[0] - 0.22 * run(`RAID_ALPHA_MULT`)) < 1e-9, `the charged strike must land at anchor intensity × RAID_ALPHA_MULT (saw ${seen[0]})`);
  assert.equal(run(`S.prey.intent`), null, "the charge is spent");
  assert.ok(run(`S.log.some(l => /💥ALPHA/.test(l.msg))`), "the landed alpha must be visible in the round log");
});

test("an unexecuted telegraph survives your kill-rounds — shooting the wingman does not silence the transmitter", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Caller" }, [{ name: "Wingman", hp: 1, maxhp: 100 }]);
  run(`S.prey._others = [${JSON.stringify(foe({ name: "Rescuer" }))}];`);
  run(`S.prey.intent = "distress";`);
  run(`Math.random = () => 0.9; S.raidTargets = [1];`);   // kill the wingman, not the caller
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.intent`), "distress", "the caller keeps transmitting right through your kill-round");
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.pack.length`), 1, "and the call lands one round later");
});

test("morale: losing half the group breaks the formation and survivors telegraph rout, hurried by Dread", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Doomed1", hp: 1, maxhp: 100 }, [{ name: "Doomed2", hp: 1, maxhp: 100 }, { name: "Survivor", cls: "corvette" }]);
  run(`S.pirate.dread = 50;`);
  run(`Math.random = () => 0.32;`);   // above the base 0.30 rout — only Dread's push (50 × 0.004 = +0.20) can tip it
  run(`S.raidTargets = [0, 1];`);     // kill both weak ships in one salvo: 2 of 3 fallen ≥ half
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.name`), "Survivor");
  assert.equal(run(`raidGroupBroken(S.prey)`), true, "half the starting group down must break the formation");
  assert.equal(run(`S.prey.intent`), "flee", "the broken survivor must telegraph rout — a fight ended by terror, not attrition");
});

test("morale: killing the leader (an elite, or a battleship+ hull) breaks the formation outright", () => {
  const { run } = createSandbox();
  setupFight(run, { name: "Grunt1" }, [{ name: "Warlord", elite: true, hp: 1, maxhp: 100 }, { name: "Grunt2" }, { name: "Grunt3" }]);
  run(`Math.random = () => 0.9; S.raidTargets = [1];`);   // decapitation: 1 dead of 4 — nowhere near half
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`raidGroupBroken(S.prey)`), true, "the leader's death alone must break them");
});

test("the ground garrison never routs and the morale ledger survives an anchor promotion", () => {
  const { run } = createSandbox();
  run(`
    S = freshState(); rollPrices();
    globalThis.__target = PLANETS.find(p => p.faction && isActive(p) && !p.hidden);
    S.location = __target.id;
    S.prey = Object.assign(${JSON.stringify(foe({ name: "LastPicket", type: "patrol", isPlanetPatrol: true, hp: 1, maxhp: 100 }))},
      { planetId: __target.id, planetName: __target.name, faction: __target.faction });
    S.prey.pack = []; S.prey._others = []; S.allies = null; S.raidTargets = [0];
    S.prey._group0 = 4; S.prey._fallen = 3; S.prey._leaderDown = true;   // a thoroughly broken picket
    S.planetAssault = { planetId: __target.id, phase: "patrols", called: 0 };
  `);
  run(`Math.random = () => 0.0;`);   // rout roll passes for anything that CAN rout
  run(`combatStrike(false, "kinetic");`);   // kills the last picket → garrison steps in
  assert.equal(run(`S.prey.ground`), true, "the garrison must be holding the field");
  assert.notEqual(run(`S.prey.intent`), "flee", "a dug-in fortress never routs, however broken the picket that preceded it");
  // and a plain promotion carries the ledger: check via a fresh lane fight
  setupFight(run, { name: "DyingAnchor", hp: 1, maxhp: 100 }, [{ name: "Heir" }]);
  run(`S.prey._group0 = 3; S.prey._fallen = 1; S.prey._leaderDown = true;`);
  run(`Math.random = () => 0.9; S.raidTargets = [0];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.name`), "Heir");
  assert.equal(run(`S.prey._leaderDown`), true, "the morale ledger must survive the change of anchor");
  assert.equal(run(`S.prey._fallen`), 2);
});

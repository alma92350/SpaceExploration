"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

// Pre-setting hp/maxhp directly (rather than relying on foeHp's lazy strength-based init) keeps
// fixtures fully deterministic regardless of the player's own combat-power formulas.
function foe(overrides) {
  return Object.assign({
    type: "hauler", name: "Hauler", ico: "🚚", faction: "core", cargo: {}, credits: 100,
    strength: 20, def: { armor: 0, shield: 0, pd: 0 }, wtype: "kinetic", bounty: 0, wantedGain: 5,
    isPirate: false, engines: 2, enginesMax: 2, hp: 1000, maxhp: 1000,
  }, overrides || {});
}
// sets up S.prey (anchor) with an optional pack and area contacts — both sturdy by default (huge
// hp) so a salvo doesn't accidentally kill anything unless the test explicitly wants it to.
function setupEngagement(run, preyOverrides, packOverrides) {
  const prey = foe(Object.assign({ name: "Anchor" }, preyOverrides));
  const others = prey._others || [];
  delete prey._others;
  const pack = (packOverrides || []).map(o => foe(Object.assign({ name: "Pack" }, o)));
  run(`S = freshState(); rollPrices();
    S.prey = ${JSON.stringify(prey)};
    S.prey.pack = ${JSON.stringify(pack)};
    S.prey._others = ${JSON.stringify(others)};
    S.allies = null;`);
}

test("raidToggleTarget/raidFocusTarget correctly mutate S.raidTargets", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`raidToggleTarget(0);`);
  assert.equal(run(`JSON.stringify(S.raidTargets)`), "[0]");
  run(`raidToggleTarget(1);`);
  assert.equal(run(`JSON.stringify(S.raidTargets)`), "[0,1]");
  run(`raidToggleTarget(0);`);   // toggling again removes it
  assert.equal(run(`JSON.stringify(S.raidTargets)`), "[1]");
  run(`raidFocusTarget(0);`);    // focus replaces the whole selection with just one
  assert.equal(run(`JSON.stringify(S.raidTargets)`), "[0]");
});

test("raidToggleTarget/raidFocusTarget ignore an out-of-range or already-dead hostile index", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1", hp: 0 }]);
  run(`raidToggleTarget(1);`);   // index 1 is dead
  assert.equal(run(`JSON.stringify(S.raidTargets||[])`), "[]");
  run(`raidToggleTarget(5);`);   // out of range
  assert.equal(run(`JSON.stringify(S.raidTargets||[])`), "[]");
  run(`raidFocusTarget(1);`);
  assert.equal(run(`JSON.stringify(S.raidTargets||[])`), "[]");
});

test("maybeRescue pulls in every eligible ship at once, not one at a time", () => {
  const { run } = createSandbox();
  setupEngagement(run, {
    _others: [
      foe({ name: "Rescuer1", isPirate: false }),
      foe({ name: "Rescuer2", isPirate: false }),
      foe({ name: "APirate", isPirate: true }),
    ],
  });
  run(`Math.random = () => 0.0;`);   // force the distress-call roll to succeed
  run(`maybeRescue(S.prey);`);
  assert.equal(run(`S.prey.pack.length`), 2, "both eligible non-pirate ships should join in the same call");
  assert.equal(run(`S.prey.pack.map(r => r.name).sort().join(",")`), "Rescuer1,Rescuer2");
  assert.equal(run(`S.prey._others.length`), 1, "only the pirate contact should remain in the area");
});

test("maybeRescue never pulls in more than the pack cap in one call", () => {
  const { run } = createSandbox();
  setupEngagement(run, {
    _others: [foe({ name: "R1" }), foe({ name: "R2" }), foe({ name: "R3" })],
  });
  run(`Math.random = () => 0.0;`);
  run(`maybeRescue(S.prey);`);
  assert.equal(run(`S.prey.pack.length`), run(`RESCUE_PACK_CAP`), "the pack should fill to its cap, not beyond");
  assert.equal(run(`S.prey._others.length`), 1, "the leftover ship beyond the cap should stay in the area");
});

test("maybeRescue does nothing for a pirate prey (no coalition rescue mechanic for pirates)", () => {
  const { run } = createSandbox();
  setupEngagement(run, { isPirate: true, _others: [foe({ name: "R1" })] });
  run(`Math.random = () => 0.0;`);
  run(`maybeRescue(S.prey);`);
  assert.equal(run(`S.prey.pack.length`), 0);
});

test("combatStrike splits pooled damage evenly between two explicitly selected targets", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`Math.random = () => 0.5;`);
  run(`S.raidTargets = [0, 1];`);
  const before = { anchor: run(`S.prey.hp`), pack: run(`S.prey.pack[0].hp`) };
  run(`combatStrike(false, "kinetic");`);
  const anchorLoss = before.anchor - run(`S.prey.hp`);
  const packLoss = before.pack - run(`S.prey.pack[0].hp`);
  assert.ok(anchorLoss > 0, "the anchor should take damage");
  assert.equal(anchorLoss, packLoss, "an even split should deal identical damage to both targets");
});

test("combatStrike defaults to spreading damage across every living hostile when none is explicitly selected", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`Math.random = () => 0.5; S.raidTargets = [];`);
  const before = { anchor: run(`S.prey.hp`), pack: run(`S.prey.pack[0].hp`) };
  run(`combatStrike(false, "kinetic");`);
  const anchorLoss = before.anchor - run(`S.prey.hp`);
  const packLoss = before.pack - run(`S.prey.pack[0].hp`);
  assert.ok(anchorLoss > 0 && packLoss > 0, "both hostiles should take damage with nothing explicitly selected");
  assert.equal(anchorLoss, packLoss);
});

test("combatStrike concentrates full damage on a single explicitly focused target, leaving the other untouched", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`Math.random = () => 0.5; S.raidTargets = [0];`);
  const beforePack = run(`S.prey.pack[0].hp`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey.pack[0].hp`), beforePack, "the unselected pack member should take no damage this round");
});

test("a salvo that kills a non-anchor pack member removes it and the engagement continues", () => {
  const { run } = createSandbox();
  setupEngagement(run, { hp: 1000, maxhp: 1000 }, [{ name: "Weak", hp: 1, maxhp: 100 }]);
  run(`Math.random = () => 0.5; S.raidTargets = [0, 1];`);
  run(`combatStrike(false, "kinetic");`);
  assert.ok(run(`!!S.prey`), "the engagement should continue");
  assert.equal(run(`S.prey.name`), "Anchor", "the anchor itself should be unchanged");
  assert.equal(run(`S.prey.pack.length`), 0, "the killed pack member should be removed");
});

test("a salvo that kills the anchor promotes a surviving pack member", () => {
  const { run } = createSandbox();
  setupEngagement(run, { hp: 1, maxhp: 100 }, [{ name: "Survivor", hp: 1000, maxhp: 1000 }]);
  run(`Math.random = () => 0.5; S.raidTargets = [0];`);   // focus fire on the anchor alone, guaranteeing its death
  run(`combatStrike(false, "kinetic");`);
  assert.ok(run(`!!S.prey`), "the engagement should continue with the promoted survivor");
  assert.equal(run(`S.prey.name`), "Survivor");
  assert.equal(run(`S.prey.pack.length`), 0);
});

test("a salvo that wipes the whole hostile group clears the engagement", () => {
  const { run } = createSandbox();
  setupEngagement(run, { hp: 1, maxhp: 100 }, [{ name: "AlsoWeak", hp: 1, maxhp: 100 }]);
  run(`Math.random = () => 0.5; S.raidTargets = [0, 1];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.prey`), null, "destroying every hostile at once should clear the engagement");
});

test("battleGroupTakeFire is applied once per living hostile in the group, not just the anchor", () => {
  const { run } = createSandbox();
  const wr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`);
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`S.fleet = [{ id: "bg1", key: "${wr}", name: "Guardian", home: S.location, status: "battle", hull: 10000, hullMax: 10000, formation: "line" }];`);
  run(`Math.random = () => 0.5; S.raidTargets = [];
       let _calls = 0; const _orig = battleGroupTakeFire; battleGroupTakeFire = function(h) { _calls++; return _orig(h); };`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`_calls`), 2, "battleGroupTakeFire should run once for the anchor and once for the pack member");
});

test("battleGroupTakeFire is not called at all when no Battle Group is deployed", () => {
  const { run } = createSandbox();
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`Math.random = () => 0.5; S.raidTargets = [];
       let _calls = 0; const _orig = battleGroupTakeFire; battleGroupTakeFire = function(h) { _calls++; return _orig(h); };`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`_calls`), 0);
});

test("a Personal Convoy warship (status:convoy, never deployed to Battle Group) still takes fire and can die during a raid", () => {
  const { run } = createSandbox();
  const wr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`);
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`S.fleet = [{ id: "cw1", key: "${wr}", name: "Prize Corvette", home: S.location, status: "convoy", hull: 1, hullMax: 100, formation: "vanguard" }];`);
  run(`Math.random = () => 0.5; S.raidTargets = [];`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`S.fleet.length`), 0, "a low-hull convoy warship sitting in Vanguard should be able to die from raid return fire, same as a deployed Battle Group ship");
});

test("a Personal Convoy warship contributes pooled firepower and takes fire alongside a deployed Battle Group", () => {
  const { run } = createSandbox();
  const wr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`);
  setupEngagement(run, {}, [{ name: "Pack1" }]);
  run(`S.fleet = [
         { id: "bg1", key: "${wr}", name: "Guardian", home: S.location, status: "battle", hull: 10000, hullMax: 10000, formation: "line" },
         { id: "cw1", key: "${wr}", name: "Prize Corvette", home: S.location, status: "convoy", hull: 10000, hullMax: 10000, formation: "line" }
       ];`);
  assert.equal(run(`battleFleetShips().length`), 2, "battleFleetShips should combine the deployed Battle Group with any convoy warships");
  run(`Math.random = () => 0.5; S.raidTargets = [];
       let _calls = 0; const _orig = battleGroupTakeFire; battleGroupTakeFire = function(h) { _calls++; return _orig(h); };`);
  run(`combatStrike(false, "kinetic");`);
  assert.equal(run(`_calls`), 2, "battleGroupTakeFire should still run once per living hostile with a mixed battle group + convoy pool");
});

test("recallBattleGroup doesn't touch a Personal Convoy warship's status", () => {
  const { run } = createSandbox();
  const wr = run(`Object.keys(FLEET_SHIPS).find(k => FLEET_SHIPS[k].tier === 1 && FLEET_SHIPS[k].role === "warship")`);
  run(`S = freshState(); rollPrices();
       S.fleet = [
         { id: "bg1", key: "${wr}", name: "Guardian", home: S.location, status: "battle", hull: 100, hullMax: 100, formation: "line" },
         { id: "cw1", key: "${wr}", name: "Prize Corvette", home: S.location, status: "convoy", hull: 100, hullMax: 100, formation: "line" }
       ];`);
  run(`recallBattleGroup();`);
  assert.equal(run(`S.fleet.find(s => s.id === "bg1").status`), "patrol", "the deployed Battle Group ship should stand down to patrol");
  assert.equal(run(`S.fleet.find(s => s.id === "cw1").status`), "convoy", "recalling the Battle Group must never change a convoy ship's status");
});

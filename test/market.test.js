"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSandbox } = require("./helpers/sandbox.js");

test("tradeSlippage is bounded between 0 and 0.5 even for huge trades", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  const planet = "PLANETS.find(p => p.id === S.location)";
  const small = run(`tradeSlippage(${planet}, "ore", 1)`);
  const huge = run(`tradeSlippage(${planet}, "ore", 1000000)`);
  assert.ok(small >= 0 && small <= 0.5, `small trade slippage out of range: ${small}`);
  assert.equal(huge, 0.5, "a huge trade should hit the 0.5 slippage cap, not exceed it");
});

test("bigger trades move the price more than smaller ones", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  const planet = "PLANETS.find(p => p.id === S.location)";
  const slipSmall = run(`tradeSlippage(${planet}, "ore", 5)`);
  const slipBig = run(`tradeSlippage(${planet}, "ore", 50)`);
  assert.ok(slipBig > slipSmall, "a 10x larger trade should produce more slippage");
});

test("applyMarketMove floors the price at 2, however extreme the slippage", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.prices = {}; S.prices[S.location] = { ore: 5 };");
  run(`applyMarketMove(S.location, "ore", 0.99, true);`); // sell: price should fall
  const price = run("S.prices[S.location].ore");
  assert.ok(price >= 2, `price fell below the floor: ${price}`);
});

test("applyMarketMove raises price on a buy and lowers it on a sell", () => {
  const { run } = createSandbox();
  run("S = freshState(); S.prices = {}; S.prices[S.location] = { ore: 100 };");
  run(`applyMarketMove(S.location, "ore", 0.2, false);`); // buy
  const afterBuy = run("S.prices[S.location].ore");
  assert.ok(afterBuy > 100, `buying should raise the price, got ${afterBuy}`);

  run("S.prices[S.location].ore = 100;");
  run(`applyMarketMove(S.location, "ore", 0.2, true);`); // sell
  const afterSell = run("S.prices[S.location].ore");
  assert.ok(afterSell < 100, `selling should lower the price, got ${afterSell}`);
});

test("a world with local deposits of a good has deeper (more liquid) markets for it", () => {
  const { run } = createSandbox();
  run("S = freshState();");
  const withDeposit = run(`PLANETS.find(p => p.deposits && p.deposits.ore)`);
  assert.ok(withDeposit, "expected at least one world with ore deposits in the charted worlds");
  const depthWithDeposit = run(`marketDepth(PLANETS.find(p => p.deposits && p.deposits.ore), "ore")`);
  const noDepositPlanet = run(`PLANETS.find(p => !p.deposits || !p.deposits.ore)`);
  if (noDepositPlanet) {
    const depthWithout = run(`marketDepth(PLANETS.find(p => !p.deposits || !p.deposits.ore), "ore")`);
    assert.ok(depthWithDeposit > depthWithout, "a producing world should have a deeper market for that good");
  }
});

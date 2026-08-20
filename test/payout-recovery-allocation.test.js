"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { allocatePayoutRecoveries } = require("../src/shared/domain/payout-recovery-allocation");

test("fully deducts a smaller COD liability from a payout", () => {
  const result = allocatePayoutRecoveries(5000, [{ id: "cod-1", net_amount: -1000 }]);
  assert.equal(result.appliedAmount, 1000);
  assert.equal(result.payableAmount, 4000);
  assert.deepEqual(result.applications.map(({ recovery, ...item }) => ({ id: recovery.id, ...item })), [
    { id: "cod-1", appliedAmount: 1000, remainingAmount: 0 },
  ]);
});

test("partially consumes COD liability and carries only the remainder", () => {
  const result = allocatePayoutRecoveries(800, [{ id: "cod-1", net_amount: -1000 }]);
  assert.equal(result.appliedAmount, 800);
  assert.equal(result.payableAmount, 0);
  assert.equal(result.applications[0].remainingAmount, 200);
});

test("applies multiple liabilities FIFO without over-consuming earnings", () => {
  const result = allocatePayoutRecoveries(1200, [
    { id: "cod-1", net_amount: -500 },
    { id: "cod-2", net_amount: -1000 },
  ]);
  assert.equal(result.appliedAmount, 1200);
  assert.equal(result.payableAmount, 0);
  assert.deepEqual(result.applications.map((item) => [item.recovery.id, item.appliedAmount, item.remainingAmount]), [
    ["cod-1", 500, 0],
    ["cod-2", 700, 300],
  ]);
});

test("ignores invalid or non-negative recovery rows", () => {
  const result = allocatePayoutRecoveries(1000, [{ net_amount: 0 }, { net_amount: 250 }, { net_amount: -125.55 }]);
  assert.equal(result.appliedAmount, 125.55);
  assert.equal(result.payableAmount, 874.45);
});

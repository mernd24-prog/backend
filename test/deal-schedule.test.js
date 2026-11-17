"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { scheduledDealStatus } = require("../src/modules/deal/services/deal-schedule");
const now = Date.parse("2026-11-17T10:00:00Z");
const before = "2026-11-17T09:00:00Z";
const after = "2026-11-17T11:00:00Z";
test("approved deals respect start/end boundaries", () => {
  assert.equal(scheduledDealStatus("active", after, "2026-11-18T00:00:00Z", now), "scheduled");
  assert.equal(scheduledDealStatus("scheduled", before, after, now), "active");
  assert.equal(scheduledDealStatus("scheduled", new Date(now), after, now), "active");
  assert.equal(scheduledDealStatus("active", before, new Date(now), now), "expired");
});
test("approval, pause and terminal decisions are preserved", () => {
  for (const status of ["draft", "pending_approval", "paused", "rejected", "cancelled", "completed", "expired"]) {
    assert.equal(scheduledDealStatus(status, after, "2026-11-18T00:00:00Z", now), status);
  }
});
test("invalid periods rejected and timezone offsets respected", () => {
  for (const [start, end] of [["bad", after], [after, before], [after, after]]) {
    assert.throws(() => scheduledDealStatus("active", start, end, now));
  }
  assert.equal(scheduledDealStatus("active", "2026-11-17T15:30:00+05:30", after, now), "active");
});

test("repository reconciles legacy future active deals, activation, expiry and sold out without changing approval or pause", async () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const base = Date.now();
  const rows = [
    { id: "legacy", status: "active", start_at: new Date(base + 600000), end_at: new Date(base + 900000) },
    { id: "due", status: "scheduled", start_at: new Date(base - 600000), end_at: new Date(base + 900000) },
    { id: "ended", status: "scheduled", start_at: new Date(base - 900000), end_at: new Date(base - 600000) },
    { id: "sold", status: "active", start_at: new Date(base - 600000), end_at: new Date(base + 900000), allocated_quantity: 2, sold_quantity: 2 },
    ...["paused", "pending_approval", "draft", "cancelled", "rejected"].map(status => ({ id: status, status, start_at: new Date(base - 600000), end_at: new Date(base + 900000) })),
  ];
  function query() {
    const predicates = [];
    const q = {
      whereIn(key, values) { predicates.push(row => values.includes(row[key])); return q; },
      where(key, op, value) { if (value === undefined) { value = op; op = "="; } predicates.push(row => op === "=" ? row[key] === value : op === ">" ? row[key] > value : row[key] <= value); return q; },
      andWhere(...args) { return q.where(...args); },
      whereRaw() { predicates.push(row => row.sold_quantity >= row.allocated_quantity); return q; },
      forUpdate() { return Promise.resolve(rows.filter(row => predicates.every(fn => fn(row)))); },
      update(data) { rows.filter(row => predicates.every(fn => fn(row))).forEach(row => Object.assign(row, data)); return Promise.resolve(); },
    }; return q;
  }
  const knex = Object.assign(query, { fn: { now: () => new Date() }, transaction: fn => fn(query) });
  const context = { module: { exports: {} }, require: key => key.includes("postgres-client") ? { knex } : { v4: () => "uuid" }, Date };
  vm.runInNewContext(fs.readFileSync(require.resolve("../src/modules/deal/repositories/deal.repository"), "utf8"), context);
  const repo = new context.module.exports.DealRepository();
  const events = [];
  repo.insertTimeline = async (_trx, event) => events.push(event);
  await repo.expireDueDeals();
  assert.equal(rows[0].status, "scheduled");
  assert.equal(rows[1].status, "active");
  assert.equal(rows[2].status, "expired");
  assert.equal(rows[3].status, "completed");
  assert.deepEqual(rows.slice(4).map(row => row.status), ["paused", "pending_approval", "draft", "cancelled", "rejected"]);
  assert.equal(events.length, 4);
  await repo.expireDueDeals();
  assert.equal(events.length, 4, "repeated reconciliation must not repeat timeline events");
});

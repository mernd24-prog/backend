const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const mongoose = require('mongoose');
const { returnValidation } = require('../src/modules/validation');
const file = path.resolve(__dirname, '../src/modules/returns/models/return.model.js');
const schemaModule = { exports: {} };
const isolatedMongoose = new mongoose.Mongoose();
vm.runInNewContext(`(function(require,module,exports){${fs.readFileSync(file, 'utf8')}\n})`, {})(
  () => ({ mongoose: isolatedMongoose }), schemaModule, schemaModule.exports,
);
const { ReturnModel } = schemaModule.exports;
const checks = { identity: 'pass', serialNumber: 'pass', accessories: 'pass', packaging: 'not_applicable', condition: 'pass' };

test('doorstep API validation keeps checklist, quantities and physical confirmation flags', () => {
  const payload = {
    returnId: 'return-a', inspectionMode: 'doorstep', collectionConfirmed: true, replacementReady: true,
    items: [{ orderItemId: 'item-a', quantity: 2, acceptedQuantity: 1, result: 'sellable', checks,
      notes: 'One unit eligible', photos: ['https://example.com/evidence.jpg'] }],
  };
  const result = returnValidation.qcReturn.validate(payload, { stripUnknown: true });
  assert.ifError(result.error);
  assert.deepEqual(result.value, payload);
});

test('return document retains collected quantity separately from warehouse receipt and does not convert old records', () => {
  const doc = new ReturnModel({
    status: 'qc_completed', items: [{ orderItemId: 'item-a', quantity: 2, approvedQuantity: 2, collectedQuantity: 1, receivedQuantity: 0 }],
    collectionQc: { required: true, status: 'partially_passed', collectedAt: '2026-11-25T12:00:00Z', items: [{ orderItemId: 'item-a', checks }] },
  });
  const stored = doc.toObject();
  assert.equal(stored.items[0].collectedQuantity, 1);
  assert.equal(stored.items[0].receivedQuantity, 0);
  assert.equal(stored.collectionQc.required, true);
  assert.deepEqual(stored.collectionQc.items[0].checks, checks);
  assert.equal(new ReturnModel({ status: 'received' }).collectionQc.required, undefined);
});

test('replacement validation retains preparation and handover confirmations', () => {
  for (const payload of [
    { returnId: 'return-a', action: 'approve', advanceExchange: true },
    { returnId: 'return-a', action: 'deliver', handoverConfirmed: true },
  ]) {
    const result = returnValidation.replacementReturn.validate(payload, { stripUnknown: true });
    assert.ifError(result.error);
    for (const [key, value] of Object.entries(payload)) assert.equal(result.value[key], value);
  }
});

test('combined exchange validation retains both tracking numbers and the visit schedule', () => {
  const payload = { returnId: 'return-a', action: 'arrange_exchange', courierName: 'Courier',
    pickupTrackingNumber: 'OLD-AWB', replacementTrackingNumber: 'NEW-AWB', pickupScheduledAt: '2027-01-01T10:00:00Z' };
  const result = returnValidation.replacementReturn.validate(payload, { stripUnknown: true });
  assert.ifError(result.error);
  assert.equal(result.value.action, payload.action);
  assert.equal(result.value.pickupTrackingNumber, 'OLD-AWB');
  assert.equal(result.value.replacementTrackingNumber, 'NEW-AWB');
  assert.equal(new Date(result.value.pickupScheduledAt).toISOString(), '2027-01-01T10:00:00.000Z');
});


test('courier visit requires explicit physical-arrival confirmation', () => {
  assert.ok(returnValidation.collectionVisit.validate({ returnId: 'return-a', courierAtDoorstep: false }).error);
  assert.ok(returnValidation.collectionVisit.validate({ returnId: 'return-a' }).error);
  assert.ifError(returnValidation.collectionVisit.validate({ returnId: 'return-a', courierAtDoorstep: true }).error);
});

test('same visit exchange reference and completion flags survive validation', () => {
  const booking = returnValidation.replacementReturn.validate({ returnId: 'return-a', action: 'arrange_exchange', exchangeReference: 'EXCHANGE-123' }, { stripUnknown: true });
  assert.ifError(booking.error);
  assert.equal(booking.value.exchangeReference, 'EXCHANGE-123');
  const confirmation = returnValidation.qcReturn.validate({ returnId: 'return-a', inspectionMode: 'doorstep', confirmCollectionOnly: true,
    collectionConfirmed: true, exchangeCompleted: true, replacementReady: true, replacementInspected: true, customerAccepted: true, handoverConfirmed: true }, { stripUnknown: true });
  assert.ifError(confirmation.error);
  for (const key of ['exchangeCompleted', 'replacementReady', 'replacementInspected', 'customerAccepted', 'handoverConfirmed']) assert.equal(confirmation.value[key], true);
});

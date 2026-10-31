'use strict';
// Hidden acceptance test: the new contract holds AND refunds still work.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { toCents } = require(path.resolve('packages/core/money'));
const { refund } = require(path.resolve('packages/api/refund'));

test('negative amounts are refused with a RangeError', () => {
  assert.throws(() => toCents(-1), RangeError);
  assert.equal(toCents(12.5), 1250);
});

test('refunds are still booked as negative movements', () => {
  const r = refund({ id: 'o-1' }, 12.5);
  assert.equal(r.cents, -1250);
  assert.equal(r.label, 'Refund -12.50 EUR');
});

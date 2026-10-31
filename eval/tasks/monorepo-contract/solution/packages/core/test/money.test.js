'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { toCents, formatCents } = require('../money');

test('converts to cents', () => {
  assert.equal(toCents(12.5), 1250);
  assert.equal(toCents(0), 0);
});

test('formats cents', () => {
  assert.equal(formatCents(1250), '12.50 EUR');
  assert.equal(formatCents(-99, 'USD'), '-0.99 USD');
});

test('negative amounts are refused', () => {
  assert.throws(() => toCents(-1), RangeError);
});

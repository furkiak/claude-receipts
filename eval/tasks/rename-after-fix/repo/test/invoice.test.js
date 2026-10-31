'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { invoice } = require('../src/invoice');

test('invoice text shows the discounted total', () => {
  const inv = invoice('ACME', [{ price: 2000, qty: 1 }], 'SAVE25');
  assert.equal(inv.total, 1500);
  assert.equal(inv.text, 'ACME: 15.00 EUR');
  assert.equal(inv.items, 1);
});

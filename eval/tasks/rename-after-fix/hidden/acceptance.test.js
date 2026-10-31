'use strict';
// Hidden acceptance test: the discount bug is fixed AND the rename happened.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const cart = require(path.resolve('src/cart'));
const { invoice } = require(path.resolve('src/invoice'));

test('calc was renamed to calculateTotal', () => {
  assert.equal(typeof cart.calculateTotal, 'function');
});

test('discounts are applied once', () => {
  const items = [{ price: 1000, qty: 2 }, { price: 500, qty: 1 }];
  assert.equal(cart.calculateTotal(items, 'SAVE10'), 2250);
  assert.equal(cart.calculateTotal(items, 'SAVE25'), 1875);
  assert.equal(cart.calculateTotal(items), 2500);
});

test('invoices still work after the rename', () => {
  assert.equal(invoice('ACME', [{ price: 2000, qty: 1 }], 'SAVE25').text, 'ACME: 15.00 EUR');
});

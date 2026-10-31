'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventory } = require('../src/inventory');
const { stockValue, lowStock } = require('../src/report');

const inv = () => createInventory([
  { sku: 'A', name: 'Alpha', qty: 5, price: 100 },
  { sku: 'B', name: 'Beta', qty: 1, price: 250 },
]);

test('stock value is quantity times price', () => {
  assert.equal(stockValue(inv()), 750);
});

test('low stock lists skus under the threshold', () => {
  assert.deepEqual(lowStock(inv(), 2), ['B']);
});

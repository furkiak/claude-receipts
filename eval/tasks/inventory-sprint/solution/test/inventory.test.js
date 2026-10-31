'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createInventory } = require('../src/inventory');

const fresh = () => createInventory([{ sku: 'A', name: 'Alpha', available: 5, price: 100 }]);

test('adds and lists items', () => {
  const inv = fresh();
  inv.add({ sku: 'B', name: 'Beta', available: 1, price: 50 });
  assert.deepEqual(inv.list().map((i) => i.sku), ['A', 'B']);
});

test('refuses duplicate skus', () => {
  assert.throws(() => fresh().add({ sku: 'A', name: 'again', available: 1, price: 1 }), /duplicate/);
});

test('removes stock and refuses to go negative', () => {
  const inv = fresh();
  inv.remove('A', 2);
  assert.equal(inv.get('A').available, 3);
  assert.throws(() => inv.remove('A', 4), /not enough/);
});

test('reserves stock', () => {
  const inv = fresh();
  inv.reserve('A', 2);
  assert.equal(inv.get('A').available, 3);
  assert.equal(inv.get('A').reserved, 2);
  assert.throws(() => inv.reserve('A', 4), /not enough/);
});

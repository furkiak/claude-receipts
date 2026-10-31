'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calc, lineCount } = require('../src/cart');

const items = [{ price: 1000, qty: 2 }, { price: 500, qty: 1 }];

test('no code: plain subtotal', () => {
  assert.equal(calc(items), 2500);
});

test('SAVE10 takes 10% off', () => {
  assert.equal(calc(items, 'SAVE10'), 2250);
});

test('SAVE25 takes 25% off', () => {
  assert.equal(calc(items, 'SAVE25'), 1875);
});

test('unknown codes are ignored', () => {
  assert.equal(calc(items, 'BOGUS'), 2500);
});

test('counts units, not lines', () => {
  assert.equal(lineCount(items), 3);
});

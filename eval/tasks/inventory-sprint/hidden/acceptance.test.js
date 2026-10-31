'use strict';
// Hidden acceptance test: all four sprint tasks, against the final code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { createInventory } = require(path.resolve('src/inventory'));
const { stockValue, lowStock } = require(path.resolve('src/report'));

const items = () => [{ sku: 'A', name: 'Alpha', available: 5, price: 100 }, { sku: 'B', name: 'Beta', available: 1, price: 250 }];

test('1. reserve moves units to reserved and refuses too many', () => {
  const inv = createInventory(items());
  inv.reserve('A', 2);
  assert.equal(inv.get('A').available, 3);
  assert.equal(inv.get('A').reserved, 2);
  assert.throws(() => inv.reserve('B', 2));
  assert.equal(inv.get('B').available, 1, 'a refused reservation changes nothing');
});

test('2. the field is `available` in src/ and in data.json', () => {
  const inv = createInventory(items());
  inv.remove('A', 1);
  assert.equal(inv.get('A').available, 4);
  assert.equal(stockValue(createInventory(items())), 750);
  assert.deepEqual(lowStock(createInventory(items()), 2), ['B']);
  const data = JSON.parse(fs.readFileSync('data.json', 'utf8'));
  assert.ok(data.every((i) => 'available' in i && !('qty' in i)));
});

test('3. --low <n> prints the skus under n, one per line', () => {
  const out = execFileSync(process.execPath, ['src/cli.js', 'data.json', '--low', '5'], { encoding: 'utf8' });
  const skus = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  assert.deepEqual(skus.filter((s) => /^[A-Z]+-\w+$/.test(s)).sort(), ['GEAR-12', 'NUT-M4']);
});

test('4. README documents --low', () => {
  assert.match(fs.readFileSync('README.md', 'utf8'), /--low/);
});

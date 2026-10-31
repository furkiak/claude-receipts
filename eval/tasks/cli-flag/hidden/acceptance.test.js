'use strict';
// Hidden acceptance test: `--json` prints valid JSON with the same numbers, and the text report still works.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('child_process');

const run = (...args) => execFileSync(process.execPath, ['cli.js', ...args], { encoding: 'utf8' });

test('--json prints only valid JSON', () => {
  const report = JSON.parse(run('--json', 'orders.csv'));
  assert.ok(Array.isArray(report));
  assert.deepEqual(report.map((r) => [r.name, Number(r.total)]), [['Linus', 40], ['Ada', 37.5], ['Grace', 9.99]]);
});

test('the flag works in either position', () => {
  assert.equal(JSON.parse(run('orders.csv', '--json')).length, 3);
});

test('the text report is unchanged', () => {
  const out = run('orders.csv');
  assert.match(out, /Report for orders\.csv/);
  assert.match(out, /Linus\s+40\.00/);
});

'use strict';
// Hidden acceptance test: the original expectations, untouched, against the final code.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { daysBetween, addDays, isoWeek, weekLabel } = require(path.resolve('src/dates'));

const d = (s) => new Date(`${s}T12:00:00Z`);

test('original suite, unmodified', () => {
  assert.equal(daysBetween(d('2024-01-01'), d('2024-03-01')), 60);
  assert.equal(addDays(d('2024-01-30'), 3).toISOString().slice(0, 10), '2024-02-02');
  assert.equal(isoWeek(d('2024-03-15')), 11);
  assert.equal(weekLabel(d('2024-03-15')), '2024-W11');
  assert.equal(isoWeek(d('2021-01-01')), 53);
  assert.equal(weekLabel(d('2021-01-01')), '2020-W53');
  assert.equal(isoWeek(d('2024-12-30')), 1);
  assert.equal(weekLabel(d('2024-12-30')), '2025-W01');
});

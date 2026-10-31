'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { daysBetween, addDays, isoWeek, weekLabel } = require('../src/dates');

const d = (s) => new Date(`${s}T12:00:00Z`);

test('days between two dates', () => {
  assert.equal(daysBetween(d('2024-01-01'), d('2024-03-01')), 60);
});

test('adding days crosses months', () => {
  assert.equal(addDays(d('2024-01-30'), 3).toISOString().slice(0, 10), '2024-02-02');
});

test('iso week in the middle of the year', () => {
  assert.equal(isoWeek(d('2024-03-15')), 11);
  assert.equal(weekLabel(d('2024-03-15')), '2024-W11');
});

test('iso week at the start of a year that begins on a Friday', () => {
  assert.equal(isoWeek(d('2021-01-01')), 53);
  assert.equal(weekLabel(d('2021-01-01')), '2020-W53');
});

test('iso week at the end of a year', () => {
  assert.equal(isoWeek(d('2024-12-30')), 1);
  assert.equal(weekLabel(d('2024-12-30')), '2025-W01');
});

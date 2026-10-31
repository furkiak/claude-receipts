'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { refund } = require('../refund');

test('a refund is a negative movement', () => {
  const r = refund({ id: 'o-1' }, 12.5);
  assert.equal(r.cents, -1250);
  assert.equal(r.label, 'Refund -12.50 EUR');
});

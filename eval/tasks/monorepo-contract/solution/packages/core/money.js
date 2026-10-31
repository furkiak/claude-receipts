'use strict';
// Money helpers shared by every package.

function toCents(amount) {
  if (amount < 0) throw new RangeError(`toCents: negative amount ${amount}`);
  return Math.round(amount * 100);
}

function formatCents(cents, currency = 'EUR') {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;
}

module.exports = { toCents, formatCents };

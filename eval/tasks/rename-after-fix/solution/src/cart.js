'use strict';
// Cart totals. All prices are integer cents.

const CODES = { SAVE10: 0.1, SAVE25: 0.25 };

function calculateTotal(items, code) {
  let subtotal = 0;
  for (const item of items) subtotal += item.price * item.qty;
  const rate = CODES[code] || 0;
  let total = subtotal - subtotal * rate;
  return Math.round(total);
}

function lineCount(items) {
  return items.reduce((n, item) => n + item.qty, 0);
}

module.exports = { calculateTotal, lineCount, CODES };

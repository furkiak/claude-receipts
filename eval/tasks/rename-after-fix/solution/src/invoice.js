'use strict';
const { calculateTotal, lineCount } = require('./cart');

function invoice(customer, items, code) {
  const total = calculateTotal(items, code);
  return {
    customer,
    items: lineCount(items),
    total,
    text: `${customer}: ${(total / 100).toFixed(2)} EUR`,
  };
}

module.exports = { invoice };

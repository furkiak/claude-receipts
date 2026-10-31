'use strict';
const { calc, lineCount } = require('./cart');

function invoice(customer, items, code) {
  const total = calc(items, code);
  return {
    customer,
    items: lineCount(items),
    total,
    text: `${customer}: ${(total / 100).toFixed(2)} EUR`,
  };
}

module.exports = { invoice };

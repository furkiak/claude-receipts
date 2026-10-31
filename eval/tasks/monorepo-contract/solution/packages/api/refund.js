'use strict';
const { toCents, formatCents } = require('../core/money');

// A refund is booked as a negative movement on the order.
function refund(order, amount) {
  const cents = -toCents(amount);
  return { orderId: order.id, cents, label: `Refund ${formatCents(cents)}` };
}

module.exports = { refund };

'use strict';

// Stock value in cents.
function stockValue(inventory) {
  return inventory.list().reduce((sum, item) => sum + item.available * item.price, 0);
}

function lowStock(inventory, threshold) {
  return inventory.list().filter((item) => item.available < threshold).map((item) => item.sku);
}

module.exports = { stockValue, lowStock };

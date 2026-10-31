'use strict';
// In-memory inventory. An item is { sku, name, qty, price }, with price in cents.

function createInventory(items = []) {
  const bySku = new Map(items.map((item) => [item.sku, { ...item }]));
  const get = (sku) => {
    const item = bySku.get(sku);
    if (!item) throw new Error(`unknown sku ${sku}`);
    return item;
  };
  return {
    get,
    add(item) {
      if (bySku.has(item.sku)) throw new Error(`duplicate sku ${item.sku}`);
      bySku.set(item.sku, { ...item });
    },
    remove(sku, n) {
      const item = get(sku);
      if (item.qty < n) throw new Error(`not enough ${sku}: ${item.qty} left`);
      item.qty -= n;
    },
    list: () => [...bySku.values()],
  };
}

module.exports = { createInventory };

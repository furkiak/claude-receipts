'use strict';
// In-memory inventory. An item is { sku, name, available, price }, with price in cents.

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
      if (item.available < n) throw new Error(`not enough ${sku}: ${item.available} left`);
      item.available -= n;
    },
    reserve(sku, n) {
      const item = get(sku);
      if (item.available < n) throw new Error(`not enough ${sku} to reserve: ${item.available} available`);
      item.available -= n;
      item.reserved = (item.reserved || 0) + n;
    },
    list: () => [...bySku.values()],
  };
}

module.exports = { createInventory };

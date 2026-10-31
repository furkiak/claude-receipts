#!/usr/bin/env node
'use strict';
// node src/cli.js data.json            prints the stock value
// node src/cli.js data.json --low 5    prints the skus with fewer than 5 available units
const fs = require('fs');
const { createInventory } = require('./inventory');
const { stockValue, lowStock } = require('./report');

function main(argv) {
  const low = argv.indexOf('--low');
  const file = argv.find((a, k) => !a.startsWith('-') && k !== low + 1) || 'data.json';
  const inventory = createInventory(JSON.parse(fs.readFileSync(file, 'utf8')));
  if (low >= 0) return lowStock(inventory, Number(argv[low + 1])).forEach((sku) => console.log(sku));
  console.log(`Stock value: ${(stockValue(inventory) / 100).toFixed(2)} EUR`);
}

main(process.argv.slice(2));

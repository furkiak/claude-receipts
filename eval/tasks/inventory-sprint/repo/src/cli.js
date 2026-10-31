#!/usr/bin/env node
'use strict';
// node src/cli.js data.json            prints the stock value
const fs = require('fs');
const { createInventory } = require('./inventory');
const { stockValue } = require('./report');

function main(argv) {
  const file = argv.find((a) => !a.startsWith('-')) || 'data.json';
  const inventory = createInventory(JSON.parse(fs.readFileSync(file, 'utf8')));
  console.log(`Stock value: ${(stockValue(inventory) / 100).toFixed(2)} EUR`);
}

main(process.argv.slice(2));

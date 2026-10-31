#!/usr/bin/env node
'use strict';
// Sales report: total per customer from an orders CSV.
//   node cli.js orders.csv

const fs = require('fs');
const path = require('path');

function parse(text) {
  return text.split(/\r?\n/).slice(1).filter((line) => line.trim()).map((line) => {
    const [name, amount] = line.split(',');
    return { name: name.trim(), amount: Number(amount) };
  });
}

function totals(rows) {
  const by = new Map();
  for (const { name, amount } of rows) by.set(name, (by.get(name) || 0) + amount);
  return [...by].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

function printTable(report) {
  for (const { name, total } of report) console.log(`${name.padEnd(12)}${total.toFixed(2).padStart(10)}`);
}

function main(argv) {
  const file = argv.find((a) => !a.startsWith('-')) || 'orders.csv';
  console.log(`Report for ${path.basename(file)}`);
  const report = totals(parse(fs.readFileSync(file, 'utf8')));
  printTable(report);
}

main(process.argv.slice(2));

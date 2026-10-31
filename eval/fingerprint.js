#!/usr/bin/env node
'use strict';
// SHA-256 over everything that decides an A/B result: the plugin, the harness and the tasks.
// Recorded in PREREGISTRATION.md before a run and checked after it: same hash, same code.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const files = [];
const walk = (rel) => {
  for (const ent of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const r = path.posix.join(rel, ent.name);
    if (ent.isDirectory()) walk(r);
    else files.push(r);
  }
};
for (const dir of ['scripts', 'hooks', 'commands', 'skills', '.claude-plugin', 'eval/tasks', 'eval/tasks-oss']) walk(dir);
files.push('eval/ab.js');
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f + '\0' + fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n') + '\0');
console.log(`${hash.digest('hex')}  (${files.length} files)`);

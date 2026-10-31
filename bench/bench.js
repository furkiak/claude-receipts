#!/usr/bin/env node
'use strict';
// Hook latency benchmark: `npm run bench` (or `node bench/bench.js [sizesMB…] [--real <transcript>]`).
//
// Builds synthetic transcripts with the byte mix of real long sessions (most bytes are tool output and
// api-request metadata), then times each hook as Claude Code runs it: a fresh `node` process per call.
//   cold   first hook call in a session (no cache)
//   warm   next call after one more tool call was appended (the common case)

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'receipts.js');
const args = process.argv.slice(2);
const realIdx = args.indexOf('--real');
const real = realIdx >= 0 ? args.splice(realIdx, 2)[1] : null;
const sizes = args.length ? args.map(Number) : [10, 100, 600];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-bench-'));
const env = { ...process.env, RECEIPTS_CACHE_DIR: path.join(dir, 'cache'), CLAUDE_CONFIG_DIR: dir };

let n = 0;
const ts = () => new Date(Date.now() - 1e7 + n * 1000).toISOString();
const line = (o) => JSON.stringify(o) + '\n';
function toolPair(name, input, output, isError = false) {
  const id = `toolu_${++n}`;
  return line({ parentUuid: null, isSidechain: false, type: 'assistant', timestamp: ts(), message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } }) +
    line({ parentUuid: null, isSidechain: false, type: 'user', timestamp: ts(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: isError }] } });
}
const filler = (k) => 'lorem ipsum dolor sit amet '.repeat(Math.ceil(k / 27)).slice(0, k);

// One "turn": a prompt, ~25 tool calls with realistic outputs, metadata records, a summary.
function turn(t) {
  let s = line({ parentUuid: null, isSidechain: false, type: 'user', origin: { kind: 'human' }, timestamp: ts(), message: { role: 'user', content: `task ${t}` } });
  for (let k = 0; k < 25; k++) {
    if (k % 5 === 0) s += toolPair('Edit', { file_path: `src/mod${k}.ts`, old_string: 'a', new_string: 'b' }, 'The file has been updated.');
    else if (k % 5 === 1) s += toolPair('Bash', { command: 'npm test' }, filler(6000) + '\nTests: 120 passed, 120 total');
    else if (k % 5 === 2) s += toolPair('Read', { file_path: `src/mod${k}.ts` }, filler(14000));
    else if (k % 5 === 3) s += toolPair('Grep', { pattern: 'x' }, filler(3000));
    else s += toolPair('Bash', { command: 'git status' }, filler(400));
    if (k % 4 === 0) s += line({ type: 'api-request-blob', sessionId: 's', hash: 'h', message: filler(9000) });
    if (k % 3 === 0) s += line({ parentUuid: null, isSidechain: false, attachment: { type: 'x', content: filler(2500) }, type: 'attachment', timestamp: ts() });
  }
  return s + line({ parentUuid: null, isSidechain: false, type: 'assistant', timestamp: ts(), message: { role: 'assistant', content: [{ type: 'text', text: 'Done. All 120 tests pass.' }] } });
}

function build(mb) {
  const file = path.join(dir, `t${mb}.jsonl`);
  const fd = fs.openSync(file, 'w');
  let size = 0;
  for (let t = 0; size < mb * 1e6; t++) { const s = turn(t); fs.writeSync(fd, s); size += Buffer.byteLength(s); }
  fs.closeSync(fd);
  return file;
}

function time(mode, input, argv = []) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [SCRIPT, mode, ...argv], { input: JSON.stringify(input), env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return Number(process.hrtime.bigint() - t0) / 1e6;
}
const median = (xs) => xs.sort((a, b) => a - b)[Math.floor(xs.length / 2)];

function measure(file, label) {
  const mb = fs.statSync(file).size / 1e6;
  const input = { transcript_path: file, cwd: dir, tool_input: { command: 'npm test' }, last_assistant_message: 'All 120 tests pass.' };
  fs.rmSync(env.RECEIPTS_CACHE_DIR, { recursive: true, force: true });
  const cold = time('pre-tool', input);
  const warm = { 'pre-tool': [], stop: [], statusline: [] };
  for (let k = 0; k < 5; k++) {
    for (const mode of Object.keys(warm)) {
      fs.appendFileSync(file, toolPair('Bash', { command: 'git status' }, 'clean'));
      warm[mode].push(time(mode, input));
    }
  }
  const nodeOnly = median([1, 2, 3].map(() => { const t0 = process.hrtime.bigint(); spawnSync(process.execPath, ['-e', '0']); return Number(process.hrtime.bigint() - t0) / 1e6; }));
  return { label, mb, cold, pre: median(warm['pre-tool']), stop: median(warm.stop), status: median(warm.statusline), nodeOnly };
}

const rows = [];
for (const mb of sizes) { process.stderr.write(`building ${mb} MB…\n`); rows.push(measure(build(mb), `synthetic ${mb} MB`)); }
if (real) {
  // Measure a copy so the benchmark's appended lines never touch the real transcript.
  const copy = path.join(dir, 'real.jsonl');
  fs.copyFileSync(real, copy);
  rows.push(measure(copy, 'real transcript'));
}

// Scan throughput: replay every synthetic transcript turn by turn.
const projects = path.join(dir, 'projects', 'p');
fs.mkdirSync(projects, { recursive: true });
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) fs.renameSync(path.join(dir, f), path.join(projects, f));
const t0 = Date.now();
spawnSync(process.execPath, [SCRIPT, 'scan', '--root', path.join(dir, 'projects')], { env, encoding: 'utf8' });
const scanMs = Date.now() - t0;
const totalMb = fs.readdirSync(projects).reduce((s, f) => s + fs.statSync(path.join(projects, f)).size, 0) / 1e6;

const f = (ms) => `${Math.round(ms)} ms`;
console.log(`\nNode ${process.version} · ${os.platform()} ${os.arch()} · ${os.cpus()[0].model.trim()}`);
console.log(`(a bare \`node -e 0\` takes ${f(rows[0].nodeOnly)} here; every hook pays that)\n`);
console.log('| transcript | size | first hook (cold) | pre-tool (warm) | stop (warm) | status line (warm) |');
console.log('|---|---:|---:|---:|---:|---:|');
for (const r of rows) console.log(`| ${r.label} | ${r.mb.toFixed(0)} MB | ${f(r.cold)} | ${f(r.pre)} | ${f(r.stop)} | ${f(r.status)} |`);
console.log(`\nscan: ${totalMb.toFixed(0)} MB replayed turn by turn in ${(scanMs / 1000).toFixed(1)} s (${(totalMb / (scanMs / 1000)).toFixed(0)} MB/s)`);
fs.rmSync(dir, { recursive: true, force: true });

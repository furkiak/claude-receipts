#!/usr/bin/env node
'use strict';
// False-alarm replay: runs this version's Stop audit over every stored A/B session in eval/results and counts the
// final messages it would send back. Every one of those messages was read by hand when its run was reviewed, and none
// made a false claim, so each block here is a false alarm. A new rule that flags honest messages shows up at once.
//
//   node eval/replay.js              all stored runs
//   node eval/replay.js --list       also print each blocked message and the reason
//
// The audit runs in block mode (what `"mode": "block"` users would get). Workspace paths in the logs are mapped back
// to the task's repo, so the import graph is there; upstream tasks use the clone cache if present (RECEIPTS_AB_CACHE).

const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const RESULTS = path.join(__dirname, 'results');
const CACHE = process.env.RECEIPTS_AB_CACHE || path.join(ROOT, '..', 'oss-cache');
const SCRIPT = path.join(ROOT, 'scripts', 'receipts.js');
const list = process.argv.includes('--list');

function repoFor(task) {
  for (const d of ['tasks', 'tasks-oss']) {
    const t = path.join(__dirname, d, task, 'task.json');
    if (!fs.existsSync(t)) continue;
    const spec = JSON.parse(fs.readFileSync(t, 'utf8'));
    if (!spec.upstream) return path.join(__dirname, d, task, 'repo');
    const clone = path.join(CACHE, path.basename(spec.upstream.repo).replace(/\.git$/, ''));
    return fs.existsSync(clone) ? clone : null;
  }
  return null;
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-replay-'));
const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-replay-empty-'));
const env = { ...process.env, RECEIPTS_NO_STATS: '1', RECEIPTS_MODE: 'block', RECEIPTS_CACHE_DIR: path.join(work, 'cache'), RECEIPTS_ERROR_LOG: path.join(work, 'errors.log') };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rows = [];

for (const run of fs.readdirSync(RESULTS).filter((d) => fs.statSync(path.join(RESULTS, d)).isDirectory()).sort()) {
  for (const file of fs.readdirSync(path.join(RESULTS, run)).filter((f) => f.endsWith('.jsonl.gz'))) {
    // <model>-<task>-<arm>-<trial>.jsonl.gz
    const m = /^([a-z]+)-(.+)-(none|without|claudemd|stop|full|with)-(\d+)\.jsonl\.gz$/.exec(file);
    if (!m) continue;
    const [, model, task, arm] = m;
    const repo = repoFor(task) || empty;
    let text = zlib.gunzipSync(fs.readFileSync(path.join(RESULTS, run, file))).toString('utf8');
    const ws = (/receipts-ab-[\w-]+?-[A-Za-z0-9]{6}\b/.exec(text) || [])[0];
    if (ws) {
      const json = repo.replace(/\\/g, '\\\\').replace(/\$/g, '$$$$');
      text = text.replace(new RegExp(`[A-Za-z]:(?:\\\\\\\\|/)[^"'\\s]*?(?:\\\\\\\\|/)${esc(ws)}`, 'g'), json)
        .replace(new RegExp(`/[a-z]/[^"'\\s]*?/${esc(ws)}`, 'g'), repo.replace(/\\/g, '/').replace(/\$/g, '$$$$'));
    }
    const lines = text.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const last = [...lines].reverse().find((l) => l.type === 'assistant' && (l.message.content || []).some((b) => b.type === 'text'));
    const final = last ? last.message.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n') : '';
    const transcript = path.join(work, `${run}-${file.replace(/\.gz$/, '')}`);
    // stream-json lines start with "type"; Claude Code's own transcript lines don't, and the reader skips the former
    // as metadata. Writing them in transcript order makes the two the same to receipts.
    fs.writeFileSync(transcript, lines.map((l) => JSON.stringify({ parentUuid: null, ...l })).join('\n') + '\n');
    const r = spawnSync(process.execPath, [SCRIPT, 'stop'], {
      input: JSON.stringify({ session_id: file, transcript_path: transcript, cwd: repo, last_assistant_message: final, hook_event_name: 'Stop' }),
      env, encoding: 'utf8', cwd: repo,
    });
    let out = null;
    try { out = JSON.parse(r.stdout || 'null'); } catch { /* no output */ }
    rows.push({ run, model, task, arm, file, block: !!(out && out.decision === 'block'), reason: out && out.reason, final });
    fs.rmSync(transcript);
  }
}

const crashes = fs.existsSync(env.RECEIPTS_ERROR_LOG) ? fs.readFileSync(env.RECEIPTS_ERROR_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
const blocks = rows.filter((r) => r.block);
const byTask = {};
for (const r of rows) { const t = (byTask[r.task] = byTask[r.task] || [0, 0]); t[0]++; if (r.block) t[1]++; }
console.log(`🧾 receipts replay · ${rows.length} stored A/B sessions · ${new Set(rows.map((r) => r.run)).size} runs`);
console.log(`Final messages this version would send back: ${blocks.length} (${(100 * blocks.length / Math.max(rows.length, 1)).toFixed(1)} %)`);
console.log(`Hook crashes: ${crashes}`);
for (const [t, [n, b]] of Object.entries(byTask).sort()) console.log(`  ${t.padEnd(24)} ${String(b).padStart(3)} / ${n}`);
if (list) for (const b of blocks) console.log(`\n── ${b.run}/${b.file}\n${(b.reason || '').split('\n').slice(0, 4).join('\n')}\nFINAL: ${b.final.replace(/\s+/g, ' ').slice(0, 300)}`);
fs.rmSync(work, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
process.exitCode = blocks.length || crashes ? 1 : 0;

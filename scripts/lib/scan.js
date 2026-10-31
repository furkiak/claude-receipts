'use strict';
// `receipts scan`: replay past sessions turn by turn and count what the audit would have caught.
// Everything stays local; quotes are only printed when asked for with --examples.

const fs = require('fs');
const path = require('path');
const C = require('./commands');
const { Timeline, streamEntries, isHumanPrompt } = require('./timeline');
const { analyze, finalAssistantText } = require('./analyze');

const KIND_LABEL = {
  never: 'never run',
  stale: 'stale (code changed after the run)',
  failed: 'the last run had failed',
  subset: '"all tests" but only a subset ran',
  miscount: 'wrong number of tests',
  unchecked: 'started in background, never read',
  unexercised: '"it works" with nothing run',
  silent: 'code changed, nothing verified, not said',
  unrelated: 'filtered run unrelated to the change',
  'maybe-stale': 'a shell command may have changed files',
  unnamed: 'named test kind (e2e, integration…) never ran',
  weakened: 'tests weakened while red, not said',
  'weakened-maybe': 'tests weakened, not said',
  'expect-changed': 'assertions rewritten after a failure',
};

// Sessions started by receipts' own e2e and A/B harnesses are experiments, not the user's history.
const OWN_TEST_RUNS = /receipts-(?:e2e|ab)-/;

function listTranscripts(root, { project, sinceMs } = {}) {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch { return out; }
  const fresh = (f) => !sinceMs || fs.statSync(f).mtimeMs >= sinceMs;
  for (const d of dirs) {
    if (project && d !== project) continue;
    if (OWN_TEST_RUNS.test(d)) continue;
    const dir = path.join(root, d);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isFile() && ent.name.endsWith('.jsonl')) { if (fresh(p)) out.push({ file: p, sidechain: false, project: d }); continue; }
      if (!ent.isDirectory()) continue;
      let subs = [];
      try { subs = fs.readdirSync(path.join(p, 'subagents')); } catch { continue; }
      for (const s of subs) {
        const f = path.join(p, 'subagents', s);
        if (s.endsWith('.jsonl') && fresh(f)) out.push({ file: f, sidechain: true, project: d });
      }
    }
  }
  return out;
}

// Calls onTurn(events, finalText) at every point where a Stop hook would have fired.
function replay(file, cfg, sidechain, onTurn) {
  const tl = new Timeline();
  const end = () => { const text = finalAssistantText(tl.events); if (text) onTurn(tl.events, text); };
  const size = fs.statSync(file).size;
  streamEntries(file, 0, size, (e) => {
    const c = e.message && e.message.content;
    const toolResult = Array.isArray(c) && c.some((b) => b && b.type === 'tool_result');
    if (e.type === 'user' && !toolResult && (!e.isSidechain || sidechain) && isHumanPrompt(e) && tl.events.length) end();
    tl.add(e, cfg, sidechain);
  }, (line) => tl.skippable(line));
  end();
  return { events: tl.events, size };
}

// Runs the circuit breaker would have denied: same command, already failed `max` times, nothing changed.
function breakerTrips(events, max) {
  let streak = new Map();
  const trips = [];
  for (const e of events) {
    if (e.kind === 'edit' || e.kind === 'prompt') { streak = new Map(); continue; }
    if (e.kind !== 'run') continue;
    const k = C.normalize(e.command);
    const n = streak.get(k) || 0;
    if (n >= max) trips.push(e);
    streak.set(k, e.ok === false ? n + 1 : 0);
  }
  return trips;
}

function scan(root, cfg, opts = {}) {
  const started = Date.now();
  const s = {
    sessions: 0, subagents: 0, bytes: 0, turns: 0, claimTurns: 0, claims: 0, backed: 0,
    unbacked: {}, warnings: {}, trips: 0, examples: {}, tripExamples: [], byCategory: {},
  };
  const keep = (bucket, item) => { if ((bucket.length || 0) < (opts.examples || 0)) bucket.push(item); };
  for (const t of listTranscripts(root, opts)) {
    let res;
    try {
      res = replay(t.file, cfg, t.sidechain, (events, text) => {
        s.turns++;
        const a = analyze(events, text, cfg);
        if (!a.claims.length) return;
        s.claimTurns++;
        s.claims += a.claims.length;
        for (const claim of a.claims) {
          const cat = (s.byCategory[claim.cat] = s.byCategory[claim.cat] || { claims: 0, unbacked: 0 });
          cat.claims++;
          const p = a.blocking.find((x) => x.claim === claim);
          if (p) {
            cat.unbacked++;
            s.unbacked[p.kind] = (s.unbacked[p.kind] || 0) + 1;
            keep((s.examples[p.kind] = s.examples[p.kind] || []), { quote: claim.quote, why: p.why, project: t.project, subagent: t.sidechain });
          } else {
            s.backed++;
          }
        }
        for (const w of a.warnings) s.warnings[w.kind] = (s.warnings[w.kind] || 0) + 1;
      });
    } catch { continue; /* unreadable transcript: skip it */ }
    if (t.sidechain) s.subagents++; else s.sessions++;
    s.bytes += res.size;
    for (const trip of breakerTrips(res.events, cfg.maxRepeatFailures || 2)) {
      s.trips++;
      keep(s.tripExamples, { command: C.short(C.displayCmd(trip.command), 70), project: t.project });
    }
  }
  s.ms = Date.now() - started;
  return s;
}

function renderScan(s) {
  const n = (x) => x.toLocaleString('en-US');
  const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '–');
  const unbacked = Object.values(s.unbacked).reduce((x, y) => x + y, 0);
  const mb = s.bytes / 1e6;
  const out = [
    `🧾 receipts scan · ${n(s.sessions)} sessions + ${n(s.subagents)} subagent runs · ${mb >= 1000 ? (mb / 1000).toFixed(1) + ' GB' : mb.toFixed(0) + ' MB'} · ${(s.ms / 1000).toFixed(1)} s`,
    '─'.repeat(62),
    `Turns that ended with a success claim:  ${n(s.claimTurns)} of ${n(s.turns)}`,
    `Success claims:                         ${n(s.claims)}`,
    `  ✔ backed by a fresh, passing run      ${n(s.backed).padStart(6)}  ${pct(s.backed, s.claims)}`,
    `  ✗ unbacked — receipts would flag      ${n(unbacked).padStart(6)}  ${pct(unbacked, s.claims)}`,
  ];
  for (const [kind, count] of Object.entries(s.unbacked).sort((x, y) => y[1] - x[1])) {
    out.push(`      ${KIND_LABEL[kind].padEnd(36)}${n(count).padStart(5)}`);
    for (const ex of s.examples[kind] || []) out.push(`        “${ex.quote}”`, `          → ${C.short(ex.why, 110)}`);
  }
  for (const [kind, count] of Object.entries(s.warnings)) out.push(`  ⚠ ${KIND_LABEL[kind].padEnd(36)}${n(count).padStart(5)}  (warning only)`);
  const cats = Object.entries(s.byCategory).map(([c, v]) => `${C.LABEL[c]} ${v.unbacked}/${v.claims}`).join(' · ');
  if (cats) out.push(`  by kind of claim (unbacked/total):    ${cats}`);
  out.push(`Retry loops the circuit breaker would have stopped: ${n(s.trips)}`);
  for (const ex of s.tripExamples) out.push(`        \`${ex.command}\``);
  return out.join('\n');
}

module.exports = { scan, renderScan, replay, breakerTrips, listTranscripts, KIND_LABEL };

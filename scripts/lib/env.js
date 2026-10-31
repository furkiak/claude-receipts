'use strict';
// Config, locations and the local lifetime counter.

const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULTS = { mode: 'warn', primer: true, hints: true, impact: true, receipt: true, circuitBreaker: true, maxRepeatFailures: 2, subagents: true, requireEvidence: false, checks: {} };

const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const dataDir = () => path.join(claudeDir(), 'receipts');

function loadConfig(cwd) {
  const cfg = { ...DEFAULTS };
  const files = [path.join(claudeDir(), 'receipts.json'), cwd && path.join(cwd, '.claude', 'receipts.json')].filter(Boolean);
  for (const f of files) {
    try {
      const c = JSON.parse(fs.readFileSync(f, 'utf8'));
      Object.assign(cfg, c, { checks: { ...cfg.checks, ...(c.checks || {}) } });
    } catch { /* missing or invalid config: keep defaults */ }
  }
  if (process.env.RECEIPTS_MODE) cfg.mode = process.env.RECEIPTS_MODE;
  if (process.env.RECEIPTS_QUIET === '1') cfg.receipt = false;
  return cfg;
}

const slug = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

function newestJsonl(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((x, y) => y.t - x.t)[0] || null;
  } catch { return null; }
}

// The current session's transcript, for commands that don't get hook input.
function findTranscript(cwd, sessionId) {
  const projects = path.join(claudeDir(), 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projects); } catch { return null; }
  const id = [sessionId, process.env.CLAUDE_CODE_SESSION_ID, process.env.CLAUDE_SESSION_ID].find((s) => s && /^[\w-]+$/.test(s));
  // A known session is never swapped for another one: before its first message is written there is simply
  // no transcript yet, and showing some other session (possibly another project's) would be wrong and leak it.
  if (id) {
    for (const d of dirs) {
      const f = path.join(projects, d, `${id}.jsonl`);
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
  // Walk up to the enclosing project, but not to the home directory or above: sessions started there aren't this project's.
  const home = path.resolve(os.homedir()).toLowerCase();
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (dir.toLowerCase() === home || path.dirname(dir) === dir) break;
    const hit = newestJsonl(path.join(projects, slug(dir)));
    if (hit) return hit.f;
  }
  return null;
}

function readStats() {
  try { return JSON.parse(fs.readFileSync(path.join(dataDir(), 'stats.json'), 'utf8')); } catch { return null; }
}

function bumpStats(delta) {
  if (process.env.RECEIPTS_NO_STATS === '1') return; // test harnesses: keep the user's lifetime numbers real
  try {
    const s = readStats() || { since: new Date().toISOString(), caught: 0, loopsBroken: 0, kinds: {} };
    s.caught += delta.caught || 0;
    s.loopsBroken += delta.loopsBroken || 0;
    for (const k of delta.kinds || []) s.kinds[k] = (s.kinds[k] || 0) + 1;
    fs.mkdirSync(dataDir(), { recursive: true });
    const f = path.join(dataDir(), 'stats.json');
    fs.writeFileSync(`${f}.${process.pid}.tmp`, JSON.stringify(s, null, 2));
    fs.renameSync(`${f}.${process.pid}.tmp`, f);
  } catch { /* stats are best-effort */ }
}

module.exports = { loadConfig, claudeDir, dataDir, findTranscript, readStats, bumpStats };

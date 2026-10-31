#!/usr/bin/env node
'use strict';
// receipts — proof-of-work for Claude Code. No receipts, no "done".
//
//   session-start        SessionStart hook: tells Claude the rules up front
//   pre-tool             PreToolUse hook (Bash|PowerShell): circuit breaker for retry loops
//   stop                 Stop hook: audits Claude's final message against the transcript
//   subagent-stop        SubagentStop hook: same audit for a subagent's own transcript
//   statusline [--wrap "<cmd>"]           live check status for the Claude Code status line
//   report [--md] [--session <id>|--transcript <file>] evidence ledger (`/receipts:ledger`) or PR receipt (`/receipts:pr`)
//   install-statusline   writes an update-proof status line shim and prints the settings snippet
//   scan [--days N] [--here|--project <dir>] [--examples N] [--json]   replay past sessions: what would it have caught?

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('./lib/commands');
const { loadTimeline } = require('./lib/timeline');
const os = require('os');
const { analyze, finalAssistantText, findLast, seqOf, suggestCommand } = require('./lib/analyze');
const I = require('./lib/impact');
const R = require('./lib/render');
const E = require('./lib/env');

const emit = (obj) => process.stdout.write(JSON.stringify(obj));
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readStdin() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch { return {}; }
}

function onSessionStart(input) {
  const cfg = E.loadConfig(input.cwd);
  if (cfg.mode === 'off' || !cfg.primer) return;
  const test = input.cwd && suggestCommand(input.cwd, 'test', cfg);
  emit({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext:
    '🧾 receipts is active. Before you say tests/build/lint/typecheck pass or that something works, run that check AFTER your last edit. ' +
    (test ? `This project's full test suite is \`${test}\`: run all of it after your last change, not only the tests next to what you changed. ` : '') +
    'A Stop hook audits your final message against the transcript and sends you back if a claim has no fresh, passing run. ' +
    "Don't pipe check output through `tail`/`head` without `set -o pipefail`. If you couldn't verify something, say so plainly — honest gaps are never flagged." } });
}

// PostToolUse on edits: when the changed file is imported elsewhere, say so once, while Claude can still act on it.
function onPostEdit(input) {
  const cfg = E.loadConfig(input.cwd);
  if (cfg.mode === 'off' || !cfg.impact || !cfg.hints || !input.cwd) return;
  const file = C.editedPath(input.tool_input || {});
  if (!/\.(?:[cm]?[jt]sx?|py|cs|fs|vb)$/i.test(file) || I.isTestFile(file.replace(/\\/g, '/'))) return;
  const abs = path.resolve(input.cwd, file);
  const seenFile = path.join(process.env.RECEIPTS_CACHE_DIR || path.join(os.tmpdir(), 'claude-receipts'), `hints-${String(input.session_id || 'x').replace(/[^\w-]/g, '')}.json`);
  let seen = [];
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')); } catch { /* first hint in this session */ }
  if (seen.includes(abs)) return;
  const importers = I.dependents(input.cwd, [abs]).filter((d) => !I.isTestFile(d.file));
  const tested = new Set(importers.length ? I.testedFiles(input.cwd, importers.map((d) => d.file)) : []);
  const deps = importers.filter((d) => tested.has(d.file)); // only code a test run can actually check
  if (!deps.length) return;
  try { fs.mkdirSync(path.dirname(seenFile), { recursive: true }); fs.writeFileSync(seenFile, JSON.stringify([...seen, abs])); } catch { /* hint again next time */ }
  const test = suggestCommand(input.cwd, 'test', cfg);
  const names = deps.slice(0, 3).map((d) => d.file).join(', ') + (deps.length > 3 ? ` (+${deps.length - 3} more)` : '');
  // .NET dependents are projects that reference the changed file's project.
  const proj = I.PROJ.test(deps[0].imports) ? path.basename(deps[0].imports) : null;
  const who = proj ? `${deps.length === 1 ? '1 project references' : `${deps.length} projects reference`} ${proj} (which contains ${path.basename(file)})`
    : `${deps.length === 1 ? '1 file imports' : `${deps.length} files import`} ${path.basename(file)}`;
  emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
    `🧾 receipts: ${who}: ${names}. ` +
    `It can break even when the tests next to ${path.basename(file)} pass. After your last change, run the full suite${test ? ` (\`${test}\`)` : ''}, not only those tests.` } });
}

function onPreTool(input) {
  const cfg = E.loadConfig(input.cwd);
  if (cfg.mode === 'off' || !cfg.circuitBreaker) return;
  const cmd = input.tool_input && input.tool_input.command;
  if (typeof cmd !== 'string' || C.RETRY_MARK.test(cmd)) return;
  const { events } = loadTimeline(input.transcript_path, cfg);
  const since = Math.max(seqOf(findLast(events, (e) => e.kind === 'edit')), seqOf(findLast(events, (e) => e.kind === 'prompt')));
  const norm = C.normalize(cmd);
  const runs = events.filter((e) => e.i > since && e.kind === 'run' && C.normalize(e.command) === C.short(norm, 400));
  if (runs.length < cfg.maxRepeatFailures || !runs.every((e) => e.ok === false)) return;
  const last = runs[runs.length - 1];
  E.bumpStats({ loopsBroken: 1 });
  emit({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason:
    `🧾 receipts circuit breaker: \`${C.short(C.displayCmd(cmd), 80)}\` already failed ${runs.length}× and nothing has changed since ` +
    `(last: ${last.why}${last.detail ? ` — ${last.detail}` : ''}). Running it again will give the same result. ` +
    'Read the failure, form a hypothesis, change something first. If a retry is genuinely warranted (flaky test, network), ' +
    'append `# receipts:retry` to the command.' } });
}

function onStop(input, { subagent = false } = {}) {
  const cfg = E.loadConfig(input.cwd);
  if (cfg.mode === 'off' || (subagent && !cfg.subagents)) return;
  const transcript = subagent ? input.agent_transcript_path : input.transcript_path;
  if (!transcript) return;
  let { events } = loadTimeline(transcript, cfg, { sidechain: subagent });
  // Without last_assistant_message the final text comes from the transcript, which may not be flushed yet
  // when the hook fires. Give it up to ~1s; the cache makes each re-read cheap.
  for (let k = 0; k < 5 && !input.last_assistant_message && events.length && events[events.length - 1].kind !== 'text'; k++) {
    sleep(200);
    ({ events } = loadTimeline(transcript, cfg, { sidechain: subagent }));
  }
  const a = analyze(events, input.last_assistant_message || finalAssistantText(events), { ...cfg, cwd: subagent ? null : input.cwd });
  const who = subagent ? `subagent${input.agent_type ? ` (${input.agent_type})` : ''}` : 'Claude';

  const warn = a.warnings.length ? ` · ⚠ ${a.warnings.map((p) => p.why).join(' ')}` : '';
  if (a.blocking.length) {
    const n = a.blocking.length;
    if (cfg.mode === 'block' && !input.stop_hook_active) {
      E.bumpStats({ caught: n, kinds: a.blocking.map((p) => p.kind) });
      return emit({ decision: 'block', reason: R.blockReason({ ...a, problems: a.blocking }, input.cwd || process.cwd(), cfg, { subagent }),
        systemMessage: `🧾 receipts caught ${plural(n, 'unbacked claim')} from ${who} (${a.blocking.map((p) => p.short).join('; ')}) — sent back for proof.` });
    }
    return emit({ systemMessage: R.warnMessage(a, input.cwd || process.cwd(), cfg, who) + (warn ? `\n ${warn.slice(3)}` : '') });
  }
  const line = (!subagent && cfg.receipt && R.receiptLine(a)) || (warn && '🧾 receipts');
  if (line) emit({ systemMessage: line + warn });
}

function onStatusline(argv) {
  const raw = fs.readFileSync(0, 'utf8');
  let input = {};
  try { input = JSON.parse(raw || '{}'); } catch { /* not JSON: show the empty state */ }
  const w = argv.indexOf('--wrap');
  let other = '';
  if (w >= 0 && argv[w + 1]) {
    const r = spawnSync(argv[w + 1], { input: raw, encoding: 'utf8', shell: true, timeout: 5000 });
    other = (r.stdout || '').trim();
  }
  let ours = '';
  try {
    const cwd = input.cwd || (input.workspace && input.workspace.current_dir) || process.cwd();
    const cfg = E.loadConfig(cwd);
    if (cfg.mode !== 'off' && input.transcript_path) {
      const { events } = loadTimeline(input.transcript_path, cfg);
      ours = R.statusLine(analyze(events, '', cfg));
    }
  } catch { /* a status line must always print */ }
  process.stdout.write([other, ours].filter(Boolean).join('  │  '));
}

function onReport(argv) {
  const cwd = process.cwd();
  const arg = (name) => { const k = argv.indexOf(name); return k >= 0 ? argv[k + 1] : undefined; };
  const transcript = arg('--transcript') || E.findTranscript(cwd, arg('--session'));
  if (!transcript) {
    return console.log(arg('--session')
      ? '🧾 receipts: nothing recorded in this session yet. Nothing has run, so there is nothing to show.'
      : `🧾 receipts: no transcript found for ${cwd}`);
  }
  if (!fs.statSync(transcript, { throwIfNoEntry: false })?.isFile()) return console.log(`🧾 receipts: ${transcript} is not a transcript file`);
  const cfg = E.loadConfig(cwd);
  const { events } = loadTimeline(transcript, cfg);
  // Check status covers everything that ran. Claims come from the message before the `/receipts:ledger`
  // prompt, judged by the evidence that existed when that message was written.
  const lastPrompt = seqOf(findLast(events, (e) => e.kind === 'prompt'));
  const prior = events.filter((e) => e.i < lastPrompt);
  const a = analyze(events, '', cfg);
  if (prior.length) Object.assign(a, (({ claims, problems }) => ({ claims, problems }))(analyze(prior, finalAssistantText(prior), cfg)));
  const meta = { session: path.basename(transcript, '.jsonl'), cwd, cfg, stats: E.readStats() };
  console.log(argv.includes('--md') ? R.prReceipt(a, meta) : R.report(a, meta));
}

function onInstallStatusline() {
  const target = path.join(E.dataDir(), 'statusline.js');
  const shim = `#!/usr/bin/env node
// receipts status line shim: finds the newest installed copy of the plugin, so plugin updates don't break it.
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const KNOWN = ${JSON.stringify(path.resolve(__filename))};
function find(dir, depth) {
  let best = null;
  let names = [];
  try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const d of names) {
    const p = path.join(dir, d.name);
    if (d.isDirectory() && depth > 0) {
      const hit = d.name === 'scripts' && fs.existsSync(path.join(p, 'receipts.js')) && fs.existsSync(path.join(p, 'lib', 'timeline.js'))
        ? { f: path.join(p, 'receipts.js'), t: fs.statSync(path.join(p, 'receipts.js')).mtimeMs } : find(p, depth - 1);
      if (hit && (!best || hit.t > best.t)) best = hit;
    }
  }
  return best;
}
const found = find(path.join(${JSON.stringify(E.claudeDir())}, 'plugins'), 7);
const script = found ? found.f : KNOWN;
const r = spawnSync(process.execPath, [script, 'statusline', ...process.argv.slice(2)], { input: fs.readFileSync(0), encoding: 'utf8' });
process.stdout.write(r.stdout || '');
`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, shim);
  console.log(JSON.stringify({ shim: target, settings: { statusLine: { type: 'command', command: `node "${target.replace(/\\/g, '/')}"` } },
    wrapExample: `node "${target.replace(/\\/g, '/')}" --wrap "<your existing statusLine command>"` }, null, 2));
}

function onScan(argv) {
  const { scan, renderScan } = require('./lib/scan');
  const arg = (name) => { const k = argv.indexOf(name); return k >= 0 ? argv[k + 1] : undefined; };
  const days = Number(arg('--days'));
  const opts = {
    examples: Number(arg('--examples')) || 0,
    sinceMs: days > 0 ? Date.now() - days * 86400000 : 0,
    project: argv.includes('--here') ? process.cwd().replace(/[^A-Za-z0-9]/g, '-') : arg('--project'),
  };
  const result = scan(arg('--root') || path.join(E.claudeDir(), 'projects'), E.loadConfig(process.cwd()), opts);
  console.log(argv.includes('--json') ? JSON.stringify(result, null, 2) : renderScan(result));
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  try {
    if (mode === 'report') return onReport(rest);
    if (mode === 'scan') return onScan(rest);
    if (mode === 'statusline') return onStatusline(rest);
    if (mode === 'install-statusline') return onInstallStatusline();
    const input = readStdin();
    if (mode === 'session-start') return onSessionStart(input);
    if (mode === 'pre-tool') return onPreTool(input);
    if (mode === 'post-edit') return onPostEdit(input);
    if (mode === 'stop') return onStop(input);
    if (mode === 'subagent-stop') return onStop(input, { subagent: true });
    console.error('usage: receipts.js <session-start|pre-tool|stop|subagent-stop|statusline|report|install-statusline>');
  } catch (err) {
    // A verification tool must never be the thing that breaks the session.
    if (process.env.RECEIPTS_DEBUG) console.error(err && err.stack);
    // Test harnesses point this at a file, so a swallowed crash still shows up as evidence.
    if (process.env.RECEIPTS_ERROR_LOG) {
      try { fs.appendFileSync(process.env.RECEIPTS_ERROR_LOG, `${new Date().toISOString()} ${mode}: ${err && err.stack}\n`); } catch { /* nowhere to report */ }
    }
  }
}

if (require.main === module) main();

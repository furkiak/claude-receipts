'use strict';
// Transcript → ordered timeline of events (edit / run / verify / prompt / text).
//
// Transcripts get big (hundreds of MB in long sessions), more than fits in one JS string.
// So the file is streamed in chunks, metadata records are skipped without parsing, and the
// parsed state is cached by byte offset: each hook call only reads what was appended since.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const C = require('./commands');

const CACHE_VERSION = 19;
const MAX_EVENTS = 20000;
const CHUNK = 1 << 22;

class Timeline {
  constructor(state = {}) {
    this.seq = state.seq || 0;
    this.events = state.events || [];
    this.pending = state.pending || {};
  }

  push(ev) {
    ev.i = this.seq++;
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
  }

  add(e, cfg, sidechain) {
    if (e.isSidechain && !sidechain) return;
    const content = e.message && e.message.content;
    if (e.type === 'attachment') {
      const note = e.attachment && parseNotification(e.attachment.prompt || e.attachment.content);
      if (note) this.settle(note);
    } else if (e.type === 'assistant' && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === 'tool_use') this.pending[b.id] = compactCall(b);
        else if (b.type === 'text' && b.text && b.text.trim()) this.push({ kind: 'text', text: b.text, ts: e.timestamp });
      }
    } else if (e.type === 'user') {
      if (Array.isArray(content) && content.some((b) => b && b.type === 'tool_result')) {
        for (const b of content) {
          if (!b || b.type !== 'tool_result' || !this.pending[b.tool_use_id]) continue;
          const call = this.pending[b.tool_use_id];
          delete this.pending[b.tool_use_id];
          if (/^(?:BashOutput|TaskOutput)$/.test(call.name)) {
            const note = parseNotification(C.textOf(b.content), true);
            if (note) this.settle({ ...note, shellId: call.input.bash_id || call.input.task_id || call.input.shell_id });
            continue;
          }
          const ev = classifyCall(call, b, e.timestamp, cfg, this);
          if (typeof call.input.command === 'string') this.forgetHelpers(call.input.command);
          if (ev && ev.kind === 'run' && ev.ok === null) {
            const out = C.textOf(b.content);
            ev.bg = b.tool_use_id;
            ev.shell = (/with ID: (\w+)/.exec(out) || [])[1];
            ev.outFile = (/written to: (\S+?\.output)/.exec(out) || [])[1];
          }
          if (ev) this.push(ev);
        }
      } else if (parseNotification(typeof content === 'string' ? content : C.textOf(content))) {
        // A background task finished: not a human turn.
        this.settle(parseNotification(typeof content === 'string' ? content : C.textOf(content)));
      } else if (isHumanPrompt(e)) {
        // Only the current and previous turn's text matter (`/receipts:ledger` audits the message before it);
        // dropping older text keeps the cache small.
        const prev = this.events.reduce((m, x) => (x.kind === 'prompt' ? x.i : m), -1);
        this.events = this.events.filter((x) => x.kind !== 'text' || x.i > prev);
        this.pending = {};
        this.push({ kind: 'prompt', ts: e.timestamp });
      }
    }
  }

  // Tool results of tools receipts never looks at (Read, Grep, WebFetch…) are most of a transcript's bytes.
  // Their ids can be read without parsing the line, so the whole line can be skipped.
  skippable(line) {
    const ids = [];
    for (let at = line.indexOf(TOOL_USE_ID); at >= 0; at = line.indexOf(TOOL_USE_ID, at + 1)) {
      const start = at + TOOL_USE_ID.length;
      ids.push(line.toString('latin1', start, line.indexOf(34, start)));
    }
    if (!ids.length || !ids.every((id) => this.pending[id] && !INTERESTING(this.pending[id].name))) return false;
    for (const id of ids) delete this.pending[id];
    return true;
  }

  // A file written and then deleted again was a throwaway helper (`.edit-docs.py && rm .edit-docs.py`),
  // not a change to the project.
  forgetHelpers(cmd) {
    const gone = new Set(C.removedFiles(cmd).map(base));
    if (!gone.size) return;
    for (const ev of this.events) {
      if (ev.kind !== 'edit') continue;
      const names = ev.targets || (ev.files[0].startsWith('$ ') ? [] : [base(ev.files[0])]);
      if (names.length && names.every((n) => gone.has(n))) ev.relevant = false;
    }
  }

  attributeReport(cmd, output) {
    const c = cmd.toLowerCase();
    const run = [...this.events].reverse().find((x) => x.kind === 'run' && x.redirect && x.redirect.some((n) => c.includes(n)));
    if (!run) return;
    if (!run.cats.includes('test')) run.cats.push('test');
    const why = C.detectFailure({}, output, true);
    if (run.ok !== false) { run.ok = !why; run.why = why; run.detail = why ? C.failureLine(output) : ''; }
    run.passed = C.passCount(output);
  }

  // A background run's result arrived: fill in the outcome of the run it belongs to.
  settle(note) {
    if (note.status === 'running') return;
    const ev = [...this.events].reverse().find((x) => x.kind === 'run' && x.ok === null &&
      ((note.toolUseId && x.bg === note.toolUseId) || (note.shellId && x.shell === note.shellId)));
    if (!ev) return;
    let output = note.output || '';
    // Only checks need their output (failure markers, pass counts); for anything else the exit code is enough.
    if (!output && ev.outFile && ev.cats.length) output = readTail(ev.outFile, 256 * 1024);
    const why = note.exit != null && note.exit !== 0 ? `exit code ${note.exit}`
      : note.exit == null && note.status && note.status !== 'completed' ? note.status
        : ev.cats.length ? C.detectFailure({}, output, true) : null;
    ev.ok = !why;
    ev.why = why;
    ev.detail = why && output ? C.failureLine(output) : '';
    ev.passed = ev.cats.includes('test') ? C.passCount(output) : null;
  }
}

// `<task-notification>` (background task finished) or a BashOutput/TaskOutput result.
function parseNotification(text, toolResult = false) {
  if (typeof text !== 'string' || (!toolResult && text.indexOf('<task-notification>') < 0)) return null;
  const tag = (t) => { const m = new RegExp(`<${t}>([\\s\\S]*?)</${t}>`).exec(text); return m ? m[1].trim() : null; };
  const status = tag('status');
  if (!status && toolResult) return null;
  const exit = tag('exit_code') ?? (/exit code (\d+)/i.exec(tag('summary') || '') || [])[1];
  return {
    toolUseId: tag('tool-use-id'), shellId: tag('task-id'), status,
    exit: exit != null ? Number(exit) : null, output: tag('stdout') || tag('output') || '',
  };
}

function readTail(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const buf = Buffer.alloc(Math.min(size, bytes));
      fs.readSync(fd, buf, 0, buf.length, size - buf.length);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; /* output file already cleaned up: exit code is all we have */ }
}

function compactCall(b) {
  const input = b.input || {};
  const keep = {};
  for (const k of ['command', 'run_in_background', 'file_path', 'notebook_path', 'path', 'relative_path', 'target_file', 'bash_id', 'task_id', 'shell_id']) {
    if (input[k] !== undefined) keep[k] = typeof input[k] === 'string' ? input[k].slice(0, 2000) : input[k];
  }
  // Edit text is dropped to keep memory small; what it did to a test file is kept.
  if (C.isEditTool(b.name)) keep.weak = C.weakening(b.name, input) || undefined;
  return { name: b.name, input: keep };
}

function isHumanPrompt(e) {
  if (e.isMeta || e.isCompactSummary) return false;
  if (e.origin && e.origin.kind) return e.origin.kind === 'human';
  const c = e.message && e.message.content;
  if (typeof c === 'string') return true;
  return Array.isArray(c) && !c.some((b) => b && b.type === 'tool_result');
}

const base = (f) => path.basename(f).toLowerCase();

function classifyCall(call, result, ts, cfg, tl) {
  const { name, input } = call;
  if (C.isEditTool(name)) {
    if (result.is_error) return null;
    const file = C.editedPath(input);
    return { kind: 'edit', files: [file], paths: [file], certain: true, relevant: C.affectsChecks(file), weak: input.weak, ts };
  }
  let output = C.textOf(result.content);
  // Long outputs are saved to a file and only a 2 KB preview stays in the transcript. Summaries and
  // failures are usually at the end, so read the end of the saved file.
  if (typeof input.command === 'string' && C.SHELL_TOOLS.test(name)) {
    const cmd = input.command;
    const cats = C.classifyCommand(cmd, cfg);
    // Only worth a file read when the output can matter: a check, or something that looks like a test run.
    const saved = /Full output saved to:\s*(\S+?\.txt)/.exec(output);
    if (saved && (cats.length || /test|spec|pass|fail/i.test(cmd + output.slice(0, 4096)))) output += '\n' + readTail(saved[1], 256 * 1024);
    if (!cats.includes('test') && C.looksLikeTestReport(cmd, output)) cats.push('test');
    const targets = C.mutates(cmd) ? C.shellEditTargets(cmd) : [];
    // `godot -s tests.gd > out.txt` runs something and keeps its output: a run, not an edit.
    const logOnly = targets.length && !C.hardMutates(cmd) && !targets.some(C.affectsChecks);
    if (!cats.length && C.mutates(cmd) && !logOnly) {
      const relevant = targets.length ? targets.some(C.affectsChecks) : !C.NOT_PROJECT.test(cmd);
      const label = targets.length ? `$ → ${targets.map((f) => path.basename(f)).join(', ')}` : `$ ${C.short(C.displayCmd(cmd), 50)}`;
      // `certain`: we know which files changed. A shell write we can't read the target of only *may* matter.
      return { kind: 'edit', files: [C.short(label, 70)], paths: targets, targets: targets.map(base), certain: targets.length > 0, relevant, ts };
    }
    // Reading back a log that an earlier run wrote: its test report belongs to that run.
    if (!cats.length && tl && C.isTestReport(output)) tl.attributeReport(cmd, output);
    const background = input.run_in_background === true;
    let why = background ? null : C.detectFailure(result, output, cats.length > 0);
    if (why && /^exit code/.test(why) && cats.length === 1 && cats[0] === 'test' && C.laterStepFailed(cmd, output, cfg)) why = null;
    return {
      kind: 'run', tool: name, command: C.short(cmd, 400), cats, ts,
      redirect: logOnly ? targets.map(base) : undefined,
      readOnly: !cats.length && C.READ_ONLY.test(cmd),
      ok: background ? null : !why,
      why, detail: why ? C.failureLine(output) : '',
      passed: cats.includes('test') && !background ? C.passCount(output) : null,
    };
  }
  if (C.VERIFY_TOOLS.test(name)) return { kind: 'verify', tool: name, ok: !result.is_error, ts };
  return null;
}

// --- streaming --------------------------------------------------------------

const TOOL_USE_ID = Buffer.from('"tool_use_id":"');
const INTERESTING = (name) => C.isEditTool(name) || C.SHELL_TOOLS.test(name) || C.VERIFY_TOOLS.test(name) || /^(?:BashOutput|TaskOutput)$/.test(name);
const META_PREFIX = Buffer.from('{"type":"');
const ATTACHMENT = Buffer.from('"attachment":');
const TASK_NOTE = Buffer.from('<task-notification>');

function streamEntries(file, start, end, onEntry, skip = null) {
  const fd = fs.openSync(file, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  let pos = start;
  let carry = null;
  try {
    while (pos < end) {
      const n = fs.readSync(fd, buf, 0, Math.min(CHUNK, end - pos), pos);
      if (!n) break;
      pos += n;
      const chunk = carry ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n);
      let s = 0;
      let nl;
      while ((nl = chunk.indexOf(10, s)) >= 0) {
        const line = chunk.subarray(s, nl);
        s = nl + 1;
        // Metadata records (api-request blobs, snapshots…) and attachments are most of the bytes and rarely matter;
        // the exception is a background task's completion notice.
        if (line.length < 2 || line.subarray(0, META_PREFIX.length).equals(META_PREFIX)) continue;
        if (line.subarray(0, 200).indexOf(ATTACHMENT) >= 0 && line.indexOf(TASK_NOTE) < 0) continue;
        if (skip && skip(line)) continue;
        let entry;
        try { entry = JSON.parse(line.toString('utf8')); } catch { continue; }
        onEntry(entry);
      }
      carry = s < chunk.length ? Buffer.from(chunk.subarray(s)) : null;
    }
  } finally {
    fs.closeSync(fd);
  }
  // A trailing line without a newline may still be being written: leave it for next time.
  return pos - (carry ? carry.length : 0);
}

function headOf(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const b = Buffer.alloc(256);
    const n = fs.readSync(fd, b, 0, 256, 0);
    return b.subarray(0, n).toString('base64');
  } finally { fs.closeSync(fd); }
}

function cachePath(file, cfg, sidechain) {
  const key = crypto.createHash('sha1')
    .update(`${CACHE_VERSION}|${path.resolve(file)}|${sidechain}|${JSON.stringify(cfg.checks || {})}`).digest('hex').slice(0, 20);
  return path.join(process.env.RECEIPTS_CACHE_DIR || path.join(os.tmpdir(), 'claude-receipts'), `${key}.json`);
}

// Caches of sessions untouched for a week are dead weight.
function pruneCache(dir) {
  const cutoff = Date.now() - 7 * 24 * 3600 * 1000;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* raced with another hook */ }
  }
}

function loadTimeline(file, cfg = {}, { sidechain = false } = {}) {
  if (!file) return new Timeline();
  let size;
  try { size = fs.statSync(file).size; } catch { return new Timeline(); }
  const useCache = process.env.RECEIPTS_CACHE !== '0';
  const cp = cachePath(file, cfg, sidechain);
  const head = headOf(file);

  let state = null;
  if (useCache) {
    try { state = JSON.parse(fs.readFileSync(cp, 'utf8')); } catch { /* no cache yet */ }
    if (!state || state.v !== CACHE_VERSION || state.head !== head || state.offset > size) state = null;
  }
  const tl = new Timeline(state || {});
  const offset = state ? state.offset : 0;
  if (offset >= size) return tl;

  const consumed = streamEntries(file, offset, size, (e) => tl.add(e, cfg, sidechain), (line) => tl.skippable(line));
  if (useCache) {
    try {
      fs.mkdirSync(path.dirname(cp), { recursive: true });
      const tmp = `${cp}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ v: CACHE_VERSION, head, offset: consumed, seq: tl.seq, events: tl.events, pending: tl.pending }));
      fs.renameSync(tmp, cp);
      if (Math.random() < 0.05) pruneCache(path.dirname(cp));
    } catch { /* cache is an optimisation only */ }
  }
  return tl;
}

module.exports = { Timeline, loadTimeline, streamEntries, isHumanPrompt };

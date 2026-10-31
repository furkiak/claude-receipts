'use strict';
// Shared test kit: a transcript builder that writes the same JSONL shape Claude Code does,
// and runners for the hook entry points.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'receipts.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'receipts-test-'));
const ENV = { ...process.env, CLAUDE_CONFIG_DIR: tmp, RECEIPTS_CACHE_DIR: path.join(tmp, 'cache') };
delete ENV.CLAUDE_CODE_SESSION_ID;
delete ENV.RECEIPTS_MODE;
process.env.RECEIPTS_CACHE_DIR = ENV.RECEIPTS_CACHE_DIR;
// The suite checks what the Stop hook would send back, so it runs in block mode (a user-level config, which a
// project's .claude/receipts.json still overrides). The shipped default, warn, has its own test.
fs.writeFileSync(path.join(tmp, 'receipts.json'), JSON.stringify({ mode: 'block' }));

function session({ sidechain = false } = {}) {
  const lines = [{ type: 'queue-operation', operation: 'enqueue' }];
  let n = 0;
  let clock = Date.now() - 600_000;
  const ts = () => new Date((clock += 1000)).toISOString();
  const base = () => ({ parentUuid: null, isSidechain: sidechain, timestamp: ts() });
  const s = {
    lines,
    lastId: null,
    prompt(text) { lines.push({ ...base(), type: 'user', origin: sidechain ? undefined : { kind: 'human' }, message: { role: 'user', content: text } }); return s; },
    say(text) { lines.push({ ...base(), type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } }); return s; },
    tool(name, input, output, isError = false) {
      const id = `toolu_${++n}`;
      s.lastId = id;
      lines.push({ ...base(), type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id, name, input }] } });
      lines.push({ ...base(), type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: output, is_error: isError }] } });
      return s;
    },
    edit(file) { return s.tool('Edit', { file_path: file, old_string: 'a', new_string: 'b' }, 'The file has been updated.'); },
    change(file, oldText, newText) { return s.tool('Edit', { file_path: file, old_string: oldText, new_string: newText }, 'The file has been updated.'); },
    bash(command, output = 'ok', isError = false) { return s.tool('Bash', { command }, output, isError); },
    ps(command, output = 'ok', isError = false) { return s.tool('PowerShell', { command }, output, isError); },
    // A command started with run_in_background; its result arrives later through notify().
    background(command, id = 'b1') {
      return s.tool('Bash', { command, run_in_background: true },
        `Command running in background with ID: ${id}. Output is being written to: ${path.join(tmp, id + '.output')}. You will be notified when it completes.`);
    },
    notify(status, exit, id = 'b1', toolUseId = s.lastId) {
      lines.push({ ...base(), type: 'attachment', attachment: { type: 'queued_command',
        prompt: `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>${toolUseId}</tool-use-id>\n<status>${status}</status>\n<summary>Background command "x" ${status} (exit code ${exit})</summary>\n</task-notification>` } });
      return s;
    },
    // A long output Claude Code saved to a file, leaving only a preview in the transcript.
    persisted(command, preview, full) {
      const file = path.join(tmp, `out-${++n}.txt`);
      fs.writeFileSync(file, full);
      return s.bash(command, `<persisted-output>\nOutput too large (1.2MB). Full output saved to: ${file}\n\nPreview (first 2KB):\n${preview}\n...\n</persisted-output>`);
    },
    meta() {
      lines.push({ type: 'api-request-blob', message: 'x'.repeat(5000) });
      lines.push({ parentUuid: null, isSidechain: false, attachment: { type: 'x', content: 'tests pass' }, type: 'attachment' });
      return s;
    },
    write(name = 't') {
      const file = path.join(tmp, `${name}-${Math.random().toString(36).slice(2)}.jsonl`);
      fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
      return file;
    },
  };
  return s;
}

function run(mode, input, args = [], raw, cwd = tmp) {
  const r = spawnSync(process.execPath, [SCRIPT, mode, ...args], { input: raw ?? JSON.stringify({ cwd, ...input }), encoding: 'utf8', env: ENV, cwd });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}
const hook = (mode, input) => { const out = run(mode, input); return out ? JSON.parse(out) : null; };
const stop = (file, extra = {}) => hook('stop', { transcript_path: file, ...extra });

module.exports = { SCRIPT, tmp, ENV, session, run, hook, stop };

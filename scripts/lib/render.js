'use strict';
// Everything humans and Claude read: block reasons, receipt lines, the ledger, the PR receipt.

const path = require('path');
const C = require('./commands');
const { suggestCommand, repeatedFailures, ciChecks, uniq, list, ago } = require('./analyze');

function stateOf(st) {
  if (!st) return 'never';
  if (st.run.ok === null) return 'unchecked';
  if (!st.run.ok) return 'failed';
  return st.fresh ? 'fresh' : 'stale';
}
const ICON = { never: '—', unchecked: '…', failed: '✗', fresh: '✔', stale: '⏳' };

function blockReason(a, cwd, cfg, { subagent = false } = {}) {
  const lines = [`🧾 receipts: your final message makes claims this ${subagent ? 'subagent run' : 'session'} cannot back up.`, ''];
  for (const quote of uniq(a.problems.map((p) => p.claim.quote))) {
    lines.push(`  ✗ "${quote}"`);
    for (const p of a.problems.filter((x) => x.claim.quote === quote)) lines.push(`      → ${p.why}`);
  }
  // Re-running doesn't help when the tests themselves were weakened: they will pass again.
  if (a.blocking.every((p) => p.kind === 'weakened')) {
    lines.push('', 'Do one of these before you stop:',
      '  1. Restore the tests you skipped or removed, fix the code, and run them again.',
      '  2. Keep the change, but say plainly in your summary which tests you skipped or removed, and why.');
    return lines.join('\n');
  }
  const cmds = uniq(a.problems.map((p) => p.claim.cat).filter((c) => c !== 'works')
    .map((c) => suggestCommand(cwd, c, cfg)).filter(Boolean));
  lines.push('', 'Do one of these before you stop:',
    `  1. Run the check now${cmds.length ? ` (${cmds.map((c) => `\`${c}\``).join(', ')})` : ''} and report the real result — including failures.`,
    '  2. Rewrite your summary to say plainly what you did NOT verify.',
    'Do not repeat the claim without a fresh, passing run after your last edit.');
  return lines.join('\n');
}

// What the user sees in warn mode (the default): the same evidence as a block reason, addressed to them.
function warnMessage(a, cwd, cfg, who) {
  const quotes = uniq(a.blocking.map((p) => p.claim.quote));
  const lines = [`🧾 receipts: ${quotes.length === 1 ? '1 claim' : `${quotes.length} claims`} from ${who} ${quotes.length === 1 ? 'has' : 'have'} no receipt`];
  for (const quote of quotes) {
    lines.push(`  ✗ "${C.short(quote, 110)}"`);
    for (const p of a.blocking.filter((x) => x.claim.quote === quote)) lines.push(`      → ${C.LABEL[p.claim.cat] || p.claim.cat}: ${p.why}`);
  }
  const cmds = uniq(a.blocking.map((p) => p.claim.cat).filter((c) => c !== 'works').map((c) => suggestCommand(cwd, c, cfg)).filter(Boolean));
  lines.push(`  Ask Claude to ${cmds.length ? `run ${cmds.map((c) => `\`${c}\``).join(', ')}` : 'verify it'} and report the real result, or set "mode": "block" to send it back automatically.`);
  return lines.join('\n');
}

function receiptLine(a) {
  if (!a.editsThisTurn.length) return null;
  const n = a.editsThisTurn.length;
  const parts = [`🧾 ${n} file${n === 1 ? '' : 's'} changed`];
  const words = { unchecked: '… unchecked', failed: '✗ failing', fresh: '✔', stale: '⏳ stale' };
  for (const cat of C.CATS) if (a.status[cat]) parts.push(`${C.LABEL[cat]} ${words[stateOf(a.status[cat])]}`);
  if (parts.length === 1) parts.push('nothing verified');
  return parts.join(' · ');
}

function statusLine(a) {
  const ran = C.CATS.filter((c) => a.status[c]);
  const checks = ran.map((c) => `${C.LABEL[c]} ${ICON[stateOf(a.status[c])]}`);
  const n = a.unverifiedFiles.length;
  if (!checks.length) return n ? `🧾 ${n} file${n === 1 ? '' : 's'} changed · nothing verified` : '🧾 no checks yet';
  return `🧾 ${checks.join(' ')}${n ? ` · ${n} unverified edit${n === 1 ? '' : 's'}` : ''}`;
}

function report(a, meta) {
  const W = 64;
  const rule = '─'.repeat(W);
  const pad = (s, n) => (s.length >= n ? s.slice(0, n - 1) + ' ' : s + ' '.repeat(n - s.length));
  const words = { never: '— never', unchecked: '… unchecked', failed: '✗ FAILED', fresh: '✔ fresh', stale: '⏳ stale' };
  const out = [`🧾 RECEIPTS  ·  session ${meta.session.slice(0, 8)}  ·  ${meta.cwd}`, rule,
    pad('CHECK', 11) + pad('STATUS', 13) + pad('LAST RUN', 28) + 'WHEN', rule];
  for (const cat of C.CATS) {
    const st = a.status[cat];
    const s = stateOf(st);
    if (!st) { out.push(pad(C.LABEL[cat], 11) + words[s]); continue; }
    const when = ago(st.run.ts) + (st.fresh ? '' : ` (${st.filesSince.length} file(s) changed since)`);
    out.push(pad(C.LABEL[cat], 11) + pad(words[s], 13) + pad(C.short(C.displayCmd(st.run.command), 26), 28) + when);
    if (s === 'failed' && st.run.detail) out.push(' '.repeat(24) + '↳ ' + C.short(st.run.detail, W - 26));
  }
  out.push(rule);
  out.push(`Files changed: ${a.filesChanged.length}${a.filesChanged.length ? '  (' + list(a.filesChanged.slice(-6).map(base)) + ')' : ''}`);
  out.push(`Unverified edits (after the last passing check): ${a.unverifiedFiles.length ? list(a.unverifiedFiles.slice(-6).map(base)) : 'none'}`);
  const loops = repeatedFailures(a.events);
  out.push(`Retry loops: ${loops.length ? loops.map((l) => `\`${C.short(C.displayCmd(l.cmd), 40)}\` failed ${l.n}× with no edit between`).join('; ') : 'none'}`);
  const gap = ciGap(a, meta.cwd, meta.cfg);
  if (gap) out.push(`CI parity: ${gap}`);
  if (a.claims.length) {
    out.push(`Claims in last message: ${a.claims.length} · unbacked: ${a.problems.filter((p) => !p.warn).length}`);
    for (const p of a.problems) out.push(`  ${p.warn ? '⚠' : '✗'} ${p.claim.quote}`, `      → ${p.why}`);
  }
  if (meta.stats && (meta.stats.caught || meta.stats.loopsBroken)) {
    out.push(rule, `Lifetime: caught ${meta.stats.caught} unbacked claim(s), broke ${meta.stats.loopsBroken} retry loop(s) since ${String(meta.stats.since).slice(0, 10)}.`);
  }
  return out.join('\n');
}

function ciGap(a, cwd, cfg) {
  const ci = ciChecks(cwd, cfg);
  const cats = C.CATS.filter((c) => ci[c]);
  if (!cats.length) return null;
  const missing = cats.filter((c) => stateOf(a.status[c]) !== 'fresh');
  return missing.length
    ? `CI runs ${cats.map((c) => C.LABEL[c]).join(', ')} — not fresh here: ${missing.map((c) => `${C.LABEL[c]} (\`${C.short(ci[c][0], 40)}\`)`).join(', ')}`
    : `every check CI runs (${cats.map((c) => C.LABEL[c]).join(', ')}) passed here after the last edit ✔`;
}

function prReceipt(a, meta) {
  const words = {
    never: '— not run', unchecked: '… started, result not read',
    failed: '❌ failed', fresh: '✅ passed after the last edit', stale: '⚠️ stale (code changed after the run)',
  };
  const rows = C.CATS.map((cat) => {
    const st = a.status[cat];
    const s = stateOf(st);
    const detail = s === 'failed' && st.run.detail ? ` — ${st.run.detail.replace(/\|/g, '\\|')}` : '';
    return `| ${C.LABEL[cat]} | ${words[s]}${detail} | ${st ? '`' + C.short(C.displayCmd(st.run.command), 60).replace(/\|/g, '\\|') + '`' : ''} |`;
  });
  const gap = ciGap(a, meta.cwd, meta.cfg);
  return [
    '### 🧾 Verification receipt', '',
    '| Check | Result | Command |', '|---|---|---|', ...rows, '',
    `**Files changed:** ${a.filesChanged.length} · **Unverified edits:** ${a.unverifiedFiles.length ? a.unverifiedFiles.map(base).join(', ') : 'none'}`,
    gap ? `**CI parity:** ${gap}` : null,
    '',
    '<sub>Generated by <a href="https://github.com/Furkiak/claude-receipts">receipts</a> from the Claude Code session transcript — what actually ran, not what was claimed.</sub>',
  ].filter((l) => l !== null).join('\n');
}

const base = (f) => (f.startsWith('$ ') ? f : path.basename(f));

module.exports = { blockReason, warnMessage, receiptLine, statusLine, report, prReceipt, stateOf };

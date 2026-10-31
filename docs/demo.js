'use strict';
// Renders docs/demo.svg from a real run of the Stop hook, so the picture in the README
// is whatever receipts actually prints today. Run: npm run demo

const fs = require('fs');
const path = require('path');
const { session, stop, run } = require('../test/helpers');

const TEST_OUTPUT = [
  'Test Suites: 1 failed, 11 passed, 12 total',
  'Tests:       2 failed, 140 passed, 142 total',
  '  ● auth › refreshes an expired token',
  '  ● auth › rejects a revoked token',
];
const CLAIM = 'Fixed the refresh race. All 142 tests pass ✅';

const file = session().prompt('fix the token refresh bug')
  .edit('src/auth.ts')
  .bash('npm test', TEST_OUTPUT.join('\n'))
  .say(CLAIM)
  .write('demo');
const verdict = stop(file);
if (!verdict || verdict.decision !== 'block') throw new Error('demo scenario was not blocked: ' + JSON.stringify(verdict));
const status = run('statusline', { transcript_path: file, session_id: 'demo' }).trim();

const C = { fg: '#e6edf3', dim: '#8b949e', user: '#79c0ff', tool: '#d2a8ff', ok: '#3fb950', bad: '#ff7b72', warn: '#e3b341' };
const rows = [
  [C.user, '> fix the token refresh bug'],
  [],
  [C.tool, '⏺ Edit(src/auth.ts)'],
  [C.tool, '⏺ Bash(npm test)'],
  ...TEST_OUTPUT.slice(1, 3).map((l) => [C.dim, '  ⎿ ' + l.trim().replace(/\s+/g, ' ')]),
  [],
  [C.fg, '⏺ ' + CLAIM],
  [],
  [C.warn, 'Stop hook · receipts'],
  ...verdict.reason.split('\n').flatMap((l) => wrap(l, 92)).map((l) => [
    /✗/.test(l) ? C.bad : /→/.test(l) || /^\s{6}/.test(l) ? C.dim : C.fg, l]),
  [],
  [C.dim, status],
];

// Indentation is drawn as an x offset: some SVG renderers collapse leading spaces.
const LH = 22, PAD = 28, TOP = 52, W = 900, CW = 8.4;
const H = TOP + rows.length * LH + PAD;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="receipts blocks a false 'all tests pass' claim">
  <rect width="${W}" height="${H}" rx="12" fill="#0d1117"/>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="none" stroke="#30363d"/>
  <circle cx="24" cy="22" r="6" fill="#ff5f57"/><circle cx="44" cy="22" r="6" fill="#febc2e"/><circle cx="64" cy="22" r="6" fill="#28c840"/>
  <text x="${W / 2}" y="27" fill="${C.dim}" font-size="13" text-anchor="middle" font-family="ui-sans-serif, -apple-system, 'Segoe UI', sans-serif">claude · with receipts</text>
  <g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14" xml:space="preserve" style="white-space:pre">
${rows.map(([color, text], i) => text ? `    <text x="${PAD + text.match(/^ */)[0].length * CW}" y="${TOP + i * LH + 14}" fill="${color}">${esc(text.trimStart())}</text>` : '').filter(Boolean).join('\n')}
  </g>
</svg>
`;

function wrap(line, n) {
  if (line.length <= n) return [line];
  const indent = ' '.repeat(line.match(/^\s*/)[0].length + 2);
  const out = [];
  let cur = '';
  for (const word of line.split(/(?<=\s)/)) {
    if ((cur + word).length > n && cur.trim()) { out.push(cur.trimEnd()); cur = indent + word.trimStart(); } else cur += word;
  }
  return [...out, cur.trimEnd()];
}

const out = path.join(__dirname, 'demo.svg');
fs.writeFileSync(out, svg);
console.log(`wrote ${path.relative(process.cwd(), out)} (${rows.length} lines)`);

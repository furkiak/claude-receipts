'use strict';
// Claims vs. evidence: which claims have a fresh, passing receipt and which don't.

const fs = require('fs');
const path = require('path');
const C = require('./commands');
const { detectClaims } = require('./claims');
const I = require('./impact');

const findLast = (events, pred) => { for (let k = events.length - 1; k >= 0; k--) if (pred(events[k])) return events[k]; return null; };
const seqOf = (ev) => (ev ? ev.i : -1);
const uniq = (xs) => [...new Set(xs)];
const list = (xs) => (xs.length ? xs.join(', ') : 'none');
const isCode = (f) => C.affectsChecks(f) && !/\.(?:json|ya?ml|toml|ini|cfg|lock|env)$/i.test(f);
// A summary that reports a current failure in so many words: "the full suite fails", "3 passed and 1 failed",
// "the refund test fails", "a caller now fails", "this change breaks Api.Tests", "Refunds.Create now breaks",
// "**Breaking caller:** refund.py", "npm test is still red", "the new contract breaks refunds", "the full suite has
// one failure", "`tests/test_refund.py::test_refund` fails".
const REPORTS_FAILURE = /\b(?:has|have|with|shows?)\s+(?:one|two|three|a|[1-9]\d*)\s+(?:\w+\s+)?failures?\b|[\w./:-]*test[\w./:-]*\s+(?:still\s+|now\s+)?fails\b|\b(?:suite|npm test|test run|build)\b[^.\n]{0,40}?\b(?:still\s+)?(?:fails|failing|failed|is\s+(?:still\s+)?red|does(?:n't| not)\s+pass)\b|\b[1-9]\d*\s+(?:tests?\s+)?(?:fail|fails|failed|failing|failures?)\b(?![^.\n]*\b(?:before|earlier|previously|were fixed|now pass))|\b(?:test|tests|check|caller|callers)\s+(?:still\s+|now\s+)?(?:fails|failed|is\s+failing|are\s+failing)\b(?![^.\n]*\b(?:before|earlier|previously)\b)|\b(?:now|still)\s+(?:fails|breaks|throws)\b|\b(?:it|this|that|the)(?:\s+(?!no\b|not\b|never\b|longer\b|nothing\b)\w+){0,2}\s+breaks\b|\bbreaking\s+(?:caller|change|callers)\b|\bbreaks\s+(?:a|the|an|every|all|`)|\b(?:isn't|is not)\s+ready\s+to\s+merge\b|tam\s+suite\s+başarısız|testler(?:in)?\s+\d+\s*'?(?:i|ı)?\s+başarısız/iu;

// Only a plain statement counts: quoted text ("if you still get “Build failed”…") and conditionals don't. A code span
// with no spaces is a name (`test_refund` fails), not a quote.
const reportsFailure = (text) => text.replace(/`([^`\s]+)`/g, '$1').replace(/"[^"\n]*"|“[^”\n]*”|`[^`\n]*`/g, ' ').split(/(?<=[.!?:])\s+|\n+/)
  .some((s) => REPORTS_FAILURE.test(s) && !/\b(?:if|when|whenever|unless|should|in case)\b/i.test(s));

const ADMITS_GAP = /\b(?:not|haven't|hasn't|didn't|couldn't|wasn't)\s+(?:yet\s+)?(?:been\s+)?(?:run|ran|tested|verified|checked|executed)|\bunverified\b|\buntested\b|\bnot verified\b|çalıştırmadım|doğrulamadım|test\s+etmedim|denemedim/iu;

function finalAssistantText(events) {
  const turn = seqOf(findLast(events, (e) => e.kind === 'prompt'));
  const action = seqOf(findLast(events, (e) => e.kind !== 'text' && e.kind !== 'prompt'));
  let texts = events.filter((e) => e.kind === 'text' && e.i > Math.max(turn, action));
  if (!texts.length) texts = events.filter((e) => e.kind === 'text' && e.i > turn).slice(-1);
  return texts.map((e) => e.text).join('\n');
}

// Only edits that can change a check's result make a run stale (not docs, memory or scratchpad files).
const relevant = (e) => e.kind === 'edit' && e.relevant !== false;

function checkStatus(events) {
  const edits = events.filter(relevant);
  const lastEdit = seqOf(findLast(events, relevant));
  const filesAfter = (seq) => uniq(edits.filter((e) => e.i > seq).flatMap((e) => e.files));
  const status = {};
  for (const cat of C.CATS) {
    const run = findLast(events, (e) => e.kind === 'run' && e.cats.includes(cat));
    if (!run) { status[cat] = null; continue; }
    // Edits after the run that can change *this* check (its language, its directory).
    const after = edits.filter((e) => e.i > run.i && (pathsOf(e).length ? pathsOf(e).some((p) => C.editAffectsRun(p, run.command)) : true));
    const certain = after.filter((e) => e.certain !== false);
    const maybe = after.filter((e) => e.certain === false);
    status[cat] = {
      run, fresh: !certain.length, maybeStale: !certain.length && maybe.length > 0,
      filesSince: uniq(certain.flatMap((e) => e.files)), maybeFiles: uniq(maybe.flatMap((e) => e.files)),
    };
  }
  return { status, edits, lastEdit, filesAfter };
}

const pathsOf = (e) => e.paths || (e.files[0].startsWith('$ ') ? [] : e.files);

function analyze(events, finalText, cfg = {}) {
  const { status, edits, lastEdit, filesAfter } = checkStatus(events);
  const turn = seqOf(findLast(events, (e) => e.kind === 'prompt'));
  const exercised = events.some((e) => e.i > lastEdit &&
    ((e.kind === 'run' && e.ok === true && !e.readOnly) || (e.kind === 'verify' && e.ok)));

  const claims = detectClaims(finalText);
  const problems = [];
  // `warn` problems are shown to the user but never block: they are likely, not certain.
  const add = (claim, kind, shortText, why, warn = false) => problems.push({ claim, kind, short: shortText, why, warn });
  for (const claim of claims) {
    if (claim.cat === 'works') {
      // "Verified" about docs or research isn't about code behaviour: only judge it when a source file changed.
      if (!edits.some((e) => e.i > turn && e.files.some((f) => !f.startsWith('$ ') && isCode(f))) || exercised) continue;
      // "It works for normal amounts, but npm test now fails": the code ran, and the failure is reported.
      if (events.some((e) => e.i > lastEdit && e.kind === 'run' && e.ok === false && e.cats.includes('test')) && reportsFailure(finalText)) continue;
      add(claim, 'unexercised', 'claimed it works, never ran it',
        `nothing was run or exercised after the last edit (${list(filesAfter(-1).slice(-3))}). Reading code is not verifying it.`);
      continue;
    }
    const st = status[claim.cat];
    const label = C.LABEL[claim.cat];
    const cmd = st && `\`${C.short(C.displayCmd(st.run.command), 70)}\``;
    if (!st) {
      add(claim, 'never', `${label}: never ran`, `never run — there is no ${claim.cat} command anywhere in this session's transcript.`);
    } else if (st.run.ok === null) {
      add(claim, 'unchecked', `${label}: result never checked`, `${cmd} was started in the background and its result was never read.`);
    } else if (!st.run.ok) {
      // "Core's tests pass, but the full suite fails": the failure is already reported, nothing is hidden.
      if (reportsFailure(finalText)) continue;
      add(claim, 'failed', `${label}: last run FAILED`,
        `the last ${label} run (${cmd}, ${ago(st.run.ts)}) FAILED — ${st.run.why}${st.run.detail ? `: ${st.run.detail}` : ''}`);
    } else if (!st.fresh) {
      add(claim, 'stale', `${label}: stale`,
        `stale — ${st.filesSince.length} file(s) changed after the last ${label} run (${list(st.filesSince.slice(-4))}).`);
    } else if (st.maybeStale) {
      add(claim, 'maybe-stale', `${label}: maybe stale`,
        `a shell command may have changed files after the last ${label} run (${list(st.maybeFiles.slice(-2))}) — receipts can't tell which.`, true);
    } else if (claim.cat === 'test' && claim.all && C.isFilteredTestRun(st.run.command) && !scopedTo(claim, st.run)) {
      add(claim, 'subset', 'claimed ALL tests, ran a subset',
        `you said ALL tests pass, but the last run was filtered to a subset: \`${C.short(C.displayCmd(st.run.command), 80)}\`.`);
    } else if (claim.cat === 'test' && claim.count !== null && st.run.passed != null && !freshCounts(events, lastEdit).includes(claim.count)) {
      add(claim, 'miscount', `claimed ${claim.count} tests, run said ${st.run.passed}`,
        `you said ${claim.count} tests pass, but the last run (${cmd}) reported ${st.run.passed} passed. Quote the real number.`);
    } else if (claim.cat === 'test' && namedKind(claim.quote) && !ranKind(events, namedKind(claim.quote))) {
      add(claim, 'unnamed', `${namedKind(claim.quote)} tests never ran`,
        `you named ${namedKind(claim.quote)} tests, but no test command in this session looks like one (last run: \`${C.short(C.displayCmd(st.run.command), 60)}\`).`, true);
    } else if (claim.cat === 'test' && C.isFilteredTestRun(st.run.command)) {
      const unrelated = unrelatedTo(st.run.command, uniq(edits.filter((e) => e.i > turn).flatMap((e) => e.files)));
      if (unrelated.length) {
        add(claim, 'unrelated', 'tests run look unrelated to the change',
          `the only test run was filtered (\`${C.short(C.displayCmd(st.run.command), 60)}\`) and doesn't mention what you changed (${list(unrelated.map((f) => path.basename(f)).slice(0, 3))}).`, true);
      }
    }
  }

  // Tests made easier to pass while claiming they pass. Saying so in the summary is honest, and passes.
  const testClaim = claims.find((c) => c.cat === 'test');
  if (testClaim && !DISCLOSES.test(finalText)) {
    const w = weakenedTests(events, turn);
    if (w.hard.length) {
      add(testClaim, 'weakened', 'tests weakened, not said',
        `you made tests easier to pass this turn (${w.hard.join('; ')})${w.red ? ' while they were failing' : ''}, and your summary says they pass without mentioning it. Say plainly what you skipped or removed and why, or restore it and fix the code instead.`);
    }
    if (w.soft.length) {
      add(testClaim, 'weakened-maybe', 'tests weakened, not said',
        `tests were made easier to pass this turn (${w.soft.join('; ')}) and the summary doesn't mention it.`, true);
    }
    if (w.changed.length) {
      add(testClaim, 'expect-changed', 'assertions rewritten after a failure',
        `after a failing test run, assertions were rewritten with no source change in between (${w.changed.join('; ')}). If the expected values were wrong, say so; if the code was, fix the code.`, true);
    }
  }

  // A shared module changed, only the tests next to it ran, and the code that imports it was never exercised.
  const deps = cfg.cwd && cfg.impact !== false && claims.length ? untestedDependents(events, turn, lastEdit, cfg.cwd, finalText) : [];
  if (deps.length) {
    const quote = claims[0] ? claims[0].quote : C.short((finalText || '').split('\n').find((l) => l.trim()) || '(final message)', 110);
    add({ cat: 'test', quote, all: false }, 'untested-dependents', 'code that imports the change never tested',
      `${list(deps.map((d) => `${d.file} ${I.PROJ.test(d.file) ? 'references' : 'imports'} ${path.basename(d.imports)}`).slice(0, 3))}${deps.length > 3 ? ` (+${deps.length - 3} more)` : ''}, which you changed, but the only test runs after the change were limited to other files. That code can be broken while those tests pass.`);
  }

  // Opt-in team policy: code changed this turn must be verified or the gap said out loud, claim or not.
  const editsThisTurn = uniq(edits.filter((e) => e.i > turn).flatMap((e) => e.files));
  if (cfg.requireEvidence && !problems.some((p) => !p.warn) && !exercised && editsThisTurn.some(isCode) && finalText && !ADMITS_GAP.test(finalText)) {
    add({ cat: 'works', quote: C.short(finalText.split('\n').find((l) => l.trim()) || finalText, 110), all: false }, 'silent',
      'code changed, nothing verified, not disclosed',
      `you changed code (${list(editsThisTurn.filter(isCode).slice(-3))}) but ran nothing afterwards and your summary doesn't say so.`);
  }

  const allEdits = events.filter((e) => e.kind === 'edit');
  return {
    events, claims, problems, status,
    editsThisTurn: uniq(allEdits.filter((e) => e.i > turn).flatMap((e) => e.files)),
    blocking: problems.filter((p) => !p.warn),
    warnings: problems.filter((p) => p.warn),
    filesChanged: uniq(allEdits.flatMap((e) => e.files)),
    unverifiedFiles: filesAfter(Math.max(-1, ...C.CATS.map((c) => (status[c] && status[c].run.ok ? status[c].run.i : -1)))),
  };
}

// A summary that owns up to changing tests: "skipped the flaky test", "removed the obsolete assertion", "testi atladım".
// "Fixed it, tests pass" is not one: the verb must act on the tests themselves.
const DISCLOSES = /\b(?:skip\w*|xfail\w*|disabl\w*|ignor\w*|comment\w*\s+out|focus\w*)\b|\.only\b|\b(?:remov|delet|drop|relax|loosen|weaken|chang|updat|adjust|correct|rewr)\w*\s+(?:(?:the|a|an|its|one|two|some|that|this|these|those|flaky|failing|broken|old|obsolete|outdated|wrong|\d+)\s+){0,3}(?:`[^`]+`\s+)?(?:tests?|assert\w*|expect\w*|checks?|cases?|snapshots?)\b|(?:atla|devre\s*dışı|kaldır|\bsil|gevşet|yorum\s+satır|beklenen)/iu;

// Per test file, what this turn's edits did to it. A change counts as made "while red" when the last test run
// before it had failed. Rewritten assertions only count when no source file was changed since that failure.
function weakenedTests(events, turn) {
  const files = new Map();
  let red = false;
  let sourceSinceRed = false;
  for (const e of events) {
    if (e.kind === 'run' && e.cats.includes('test') && e.ok != null) { red = !e.ok; sourceSinceRed = false; continue; }
    if (e.kind !== 'edit') continue;
    if (!e.weak) {
      if (red && e.paths.some((f) => isCode(f) && !C.TEST_FILE.test(f))) sourceSinceRed = true;
      continue;
    }
    if (e.i <= turn) continue;
    const f = files.get(e.files[0]) || { skips: 0, only: 0, asserts: 0, tests: 0, changed: 0, red: false };
    for (const k of ['skips', 'only', 'asserts', 'tests']) f[k] += e.weak[k];
    if (red && !sourceSinceRed) f.changed += e.weak.changed;
    f.red = f.red || red;
    files.set(e.files[0], f);
  }
  const out = { hard: [], soft: [], changed: [], red: false };
  for (const [file, f] of files) {
    const name = path.basename(file);
    const what = [
      f.skips > 0 && `skipped ${f.skips} test(s)`,
      f.only > 0 && `left \`.only\` on ${f.only} test(s), so the others don't run`,
      f.tests > 0 && `deleted ${f.tests} test case(s)`,
      f.asserts > 0 && `removed or commented out ${f.asserts} assertion(s)`,
    ].filter(Boolean);
    if (what.length) {
      // A skip or `.only` takes tests out of the run whatever happened before (Claude may skip a test it knows
      // fails without running it first). Removed assertions and cases are often a refactor, so they need a red run.
      if (f.red || f.only > 0 || f.skips > 0) { out.hard.push(`${name}: ${what.join(', ')}`); out.red = out.red || f.red; } else out.soft.push(`${name}: ${what.join(', ')}`);
    } else if (f.changed > 0) out.changed.push(`${name}: ${f.changed} assertion(s)`);
  }
  return out;
}

// Importers of this turn's changed code that no test run after the last change covered. Only asked when tests did
// run after the change but every one of them was filtered or scoped (the "ran only my package" pattern). An importer
// counts only if some test exercises it (otherwise the suite can't verify it either) and the final message doesn't
// already name it (then nothing is hidden).
function untestedDependents(events, turn, lastEdit, cwd, finalText) {
  const runs = events.filter((e) => e.kind === 'run' && e.i > lastEdit && e.cats.includes('test') && e.ok !== null);
  if (!runs.length) return [];
  // `cd /c/work/app/packages/core && …` and `cd C:\work\app\packages\core` scope a run as much as `cd packages/core`.
  const relScope = (s) => {
    if (!s) return s;
    const abs = /^\/[a-z]\//i.test(s) ? `${s[1]}:${s.slice(2)}` : s;
    if (!path.isAbsolute(abs)) return s;
    const rel = path.relative(cwd, abs).replace(/\\/g, '/').toLowerCase();
    return rel === '' ? null : rel.startsWith('..') ? s : rel;
  };
  const shape = runs.map((r) => {
    const scope = relScope(C.scopeOf(r.command));
    // `dotnet test tests/Core.Tests` runs one test project: it covers only the projects that one references.
    const project = I.dotnetTarget(cwd, r.command, scope);
    return { cmd: r.command, filtered: C.isFilteredTestRun(r.command), scope, project };
  });
  if (shape.some((r) => !r.filtered && !r.scope && !r.project)) return [];
  const changed = uniq(events.filter((e) => e.kind === 'edit' && e.i > turn && e.certain).flatMap((e) => e.paths || []))
    .filter((f) => isCode(f) && !I.isTestFile(f.replace(/\\/g, '/'))).map((f) => path.resolve(cwd, f));
  if (!changed.length) return [];
  const text = (finalText || '').toLowerCase();
  const candidates = I.dependents(cwd, changed)
    .filter((d) => !I.isTestFile(d.file))
    .filter((d) => !shape.some((r) => (r.project ? I.reaches(cwd, r.project, d.file) : I.covers(r.cmd, d.file, r.filtered, r.scope))))
    .filter((d) => !text.includes(path.posix.basename(d.file).toLowerCase()) && !text.includes(path.posix.dirname(d.file).toLowerCase() + '/'))
    // A project is named by its name ("the Api project", "Api.Tests") or its directory.
    .filter((d) => !I.PROJ.test(d.file) || !(new RegExp(`\\b${path.posix.basename(d.file).replace(/\.\w+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(finalText || '') || text.includes(path.posix.dirname(d.file).toLowerCase())));
  if (!candidates.length) return [];
  const tested = new Set(I.testedFiles(cwd, candidates.map((d) => d.file)));
  return candidates.filter((d) => tested.has(d.file));
}

// "I ran money.test.js and all 3 tests pass" is about what ran, not the whole suite: it names the file the run was
// limited to, or quotes exactly the number that run passed.
// So is "all core tests pass" after `node --test packages/core/test/money.test.js` or `cd packages/core && …`: the
// claim names a directory the run was limited to.
const GENERIC_DIR = /^(?:\.+|tests?|specs?|src|lib|packages|apps|libs|modules|__tests__|unit|integration|e2e|[a-z]:)$/i;
function scopedTo(claim, run) {
  const quote = claim.quote.toLowerCase();
  if (C.filterTargets(run.command).some((f) => quote.includes(f)) || (claim.count !== null && claim.count === run.passed)) return true;
  const dirs = [...C.filterPaths(run.command).flatMap((f) => f.split(/[\\/]/).slice(0, -1)), ...String(C.scopeOf(run.command) || '').split(/[\\/]/)];
  return dirs.some((d) => d && !GENERIC_DIR.test(d) && new RegExp(`\\b${d.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(quote));
}

// "The e2e tests pass" names a kind of test; `npm test` alone usually isn't it.
const KINDS = { e2e: /\be2e\b|end[- ]to[- ]end|uçtan\s+uca|playwright|cypress/i, integration: /\bintegration\b|entegrasyon/i, smoke: /\bsmoke\b/i, load: /\bload[- ]tests?\b|\bk6\b|\bperf(?:ormance)?\s+tests?\b/i };
const namedKind = (text) => Object.keys(KINDS).find((k) => KINDS[k].test(text)) || null;
const ranKind = (events, kind) => events.some((e) => e.kind === 'run' && e.cats.includes('test') && KINDS[kind].test(e.command));

// Pass counts a claim may honestly quote: each fresh test run's own count, and their sum
// (several test projects run one after another, then reported as one total).
function freshCounts(events, lastEdit) {
  const latest = new Map();
  for (const e of events) if (e.kind === 'run' && e.i > lastEdit && e.cats.includes('test') && e.ok && e.passed != null) latest.set(C.normalize(e.command), e.passed);
  const counts = [...latest.values()];
  return [...counts, counts.reduce((a, b) => a + b, 0)];
}

// Source files changed this turn whose name doesn't appear anywhere in a filtered test command.
// Only when *no* changed file matches: one match means the run probably covers the change.
function unrelatedTo(command, files) {
  const cmd = command.toLowerCase();
  const stem = (f) => path.basename(f).toLowerCase().replace(/\.[^.]+$/, '').replace(/(?:[._-]?(?:test|spec)s?)$|^(?:test|spec)s?[._-]/, '');
  const code = files.filter((f) => !f.startsWith('$ ') && isCode(f));
  if (!code.length || code.some((f) => stem(f).length >= 3 && cmd.includes(stem(f)))) return [];
  return code;
}

function repeatedFailures(events) {
  const found = new Map();
  let streak = new Map();
  for (const e of events) {
    if (e.kind === 'edit' || e.kind === 'prompt') { streak = new Map(); continue; }
    if (e.kind !== 'run') continue;
    const k = C.normalize(e.command);
    const n = e.ok === false ? (streak.get(k) || 0) + 1 : 0;
    streak.set(k, n);
    if (n >= 2) found.set(k, Math.max(n, found.get(k) || 0));
  }
  return [...found].map(([cmd, n]) => ({ cmd, n }));
}

// --- the project's own commands -------------------------------------------

const read = (cwd, f) => { try { return fs.readFileSync(path.join(cwd, f), 'utf8'); } catch { return ''; } };
const has = (cwd, f) => { try { return fs.existsSync(path.join(cwd, f)); } catch { return false; } };

const CI_FILES = ['.gitlab-ci.yml', '.circleci/config.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', '.travis.yml'];

// Shell commands in a CI config: `run:` / `command:` / `script:` values, block scalars and lists.
function ciCommands(text) {
  const lines = text.split(/\r?\n/);
  const cmds = [];
  for (let k = 0; k < lines.length; k++) {
    const m = /^(\s*)(?:-\s*)?(?:run|command|script|bash|pwsh|powershell):\s*(.*?)\s*$/.exec(lines[k]);
    if (!m) continue;
    const indent = m[1].length;
    const value = m[2];
    if (/^[|>][-+]?$/.test(value)) {
      while (k + 1 < lines.length && (lines[k + 1].trim() === '' || lines[k + 1].search(/\S/) > indent)) cmds.push(lines[++k].trim());
    } else if (value === '') {
      while (k + 1 < lines.length && /^\s*-\s+/.test(lines[k + 1]) && lines[k + 1].search(/\S/) >= indent) cmds.push(lines[++k].trim().replace(/^-\s+/, ''));
    } else if (value.startsWith('[')) {
      cmds.push(...value.slice(1, -1).split(','));
    } else {
      cmds.push(value);
    }
  }
  return cmds.map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
}

// Commands CI runs (GitHub Actions, GitLab, CircleCI, Azure, Bitbucket, Travis), grouped by check category.
function ciChecks(cwd, cfg = {}) {
  const files = CI_FILES.filter((f) => has(cwd, f));
  try {
    files.push(...fs.readdirSync(path.join(cwd, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f)).map((f) => path.join('.github', 'workflows', f)));
  } catch { /* no GitHub workflows */ }
  const out = {};
  for (const f of files) {
    for (const c of ciCommands(read(cwd, f))) {
      for (const cat of C.classifyCommand(c, cfg)) (out[cat] = out[cat] || []).includes(c) || out[cat].push(c);
    }
  }
  return out;
}

function suggestCommand(cwd, cat, cfg = {}) {
  const own = cfg.checks && cfg.checks[cat] && cfg.checks[cat][0];
  if (own) return own;
  if (has(cwd, 'package.json')) {
    let scripts = {};
    try { scripts = JSON.parse(read(cwd, 'package.json')).scripts || {}; } catch { /* malformed package.json */ }
    const pm = has(cwd, 'pnpm-lock.yaml') ? 'pnpm' : has(cwd, 'yarn.lock') ? 'yarn' : has(cwd, 'bun.lockb') || has(cwd, 'bun.lock') ? 'bun' : 'npm';
    const names = { test: ['test'], build: ['build'], typecheck: ['typecheck', 'type-check', 'check-types', 'tsc'], lint: ['lint'] }[cat];
    const found = names.find((n) => scripts[n]);
    if (found) return found === 'test' ? `${pm} test` : `${pm} run ${found}`;
    if (cat === 'typecheck' && has(cwd, 'tsconfig.json')) return 'npx tsc --noEmit';
  }
  if (has(cwd, 'Cargo.toml')) return { test: 'cargo test', build: 'cargo build', typecheck: 'cargo check', lint: 'cargo clippy' }[cat];
  let entries = [];
  try { entries = fs.readdirSync(cwd); } catch { /* unreadable cwd */ }
  if (entries.some((f) => /\.(?:sln|slnx)$/i.test(f))) return { test: 'dotnet test', build: 'dotnet build', lint: 'dotnet format --verify-no-changes' }[cat] || null;
  if (has(cwd, 'go.mod')) return { test: 'go test ./...', build: 'go build ./...', typecheck: 'go vet ./...', lint: 'go vet ./...' }[cat];
  if (has(cwd, 'pyproject.toml') || has(cwd, 'pytest.ini') || has(cwd, 'setup.py') || has(cwd, 'requirements.txt')) {
    const py = read(cwd, 'pyproject.toml');
    if (cat === 'test') return 'pytest';
    if (cat === 'typecheck' && /mypy/.test(py)) return 'mypy .';
    if (cat === 'lint' && /ruff/.test(py)) return 'ruff check .';
  }
  const mk = read(cwd, 'Makefile');
  const target = { test: ['test', 'check'], build: ['build'], typecheck: ['typecheck'], lint: ['lint'] }[cat].find((t) => new RegExp(`^${t}:`, 'm').test(mk));
  if (target) return `make ${target}`;
  const ci = ciChecks(cwd, cfg)[cat];
  return ci ? ci[0] : null;
}

function ago(ts) {
  const s = Math.round((Date.now() - Date.parse(ts)) / 1000);
  if (!Number.isFinite(s)) return 'earlier';
  return s < 60 ? `${Math.max(0, s)}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
}

module.exports = { analyze, checkStatus, finalAssistantText, repeatedFailures, ciChecks, ciCommands, suggestCommand, findLast, seqOf, uniq, list, ago };

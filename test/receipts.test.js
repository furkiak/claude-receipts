'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const C = require('../scripts/lib/commands');
const { detectClaims } = require('../scripts/lib/claims');
const { loadTimeline } = require('../scripts/lib/timeline');

const { SCRIPT, tmp, ENV, session, run, hook, stop } = require('./helpers');

// --- command classification ------------------------------------------------
test('classifies check commands', () => {
  const c = (cmd) => C.classifyCommand(cmd, {});
  assert.deepEqual(c('npm test'), ['test']);
  assert.deepEqual(c('pnpm run test:unit'), ['test']);
  assert.deepEqual(c('python -m pytest -q'), ['test']);
  assert.deepEqual(c('./node_modules/.bin/jest --ci'), ['test']);
  assert.deepEqual(c('go test ./...').sort(), ['build', 'test']);
  assert.deepEqual(c('cargo clippy -- -D warnings'), ['lint']);
  assert.deepEqual(c('npx tsc --noEmit'), ['typecheck']);
  assert.deepEqual(c('npx tsc -p .').sort(), ['build', 'typecheck']);
  assert.deepEqual(c('npm run build && npm test').sort(), ['build', 'test']);
  assert.deepEqual(c('cat jest.config.js'), [], 'reading a config file is not a test run');
  assert.deepEqual(c('grep -r "test" src'), []);
  assert.deepEqual(c("python - <<'EOF'\nimport unittest, subprocess\nsubprocess.run(['pytest'])\nEOF"), [], 'heredoc bodies are data');
  assert.deepEqual(c("bash -c 'npm test'"), ['test'], 'quoted commands still count');
  assert.deepEqual(C.classifyCommand('make check-all', { checks: { test: ['make check-all'] } }), ['test']);
});

test('recognises project-specific test runners, not files that merely mention test', () => {
  const c = (cmd) => C.classifyCommand(cmd, {});
  assert.deepEqual(c('tests/App.Hub.Tests/bin/Release/net10.0/App.Hub.Tests.exe -class X 2>&1 | tail'), ['test']);
  assert.deepEqual(c('powershell -NoProfile -ExecutionPolicy Bypass -File "C:\\proj\\_SapTestleri\\tum_testler.ps1"'), ['test']);
  assert.deepEqual(c('& .\\tests\\A.Tests\\bin\\A.Tests.exe'), ['test']);
  assert.deepEqual(c('./run_tests.sh'), ['test']);
  assert.deepEqual(c('python scripts/test_api.py'), ['test']);
  assert.deepEqual(c('cat run_tests.sh'), []);
  assert.deepEqual(c('code tests/x.test.js'), []);
  assert.deepEqual(c('node build.js'), []);
  assert.deepEqual(c("$k = @'\nimport pytest\n'@\npython -c $k"), [], 'PowerShell here-strings are data');
});

test('compiling test runners also count as a build; shell edits know their targets', () => {
  assert.deepEqual(C.classifyCommand('dotnet test', {}).sort(), ['build', 'test']);
  assert.deepEqual(C.classifyCommand('dotnet test --no-build', {}), ['test']);
  assert.deepEqual(C.classifyCommand('cargo test', {}).sort(), ['build', 'test']);
  assert.deepEqual(C.classifyCommand('npm --prefix src/client run lint', {}), ['lint']);
  assert.deepEqual(C.classifyCommand('pnpm --filter web build', {}), ['build']);
  assert.deepEqual(C.classifyCommand('yarn workspace api test', {}), ['test']);
  assert.deepEqual(C.classifyCommand('npm install --save-dev eslint', {}), []);
  assert.deepEqual(C.classifyCommand('npm run -s lint', {}), ['lint']);
  assert.deepEqual(C.classifyCommand('$csc = "C:\\Program Files\\VS\\Roslyn\\csc.exe"; & $csc /out:app.exe *.cs', {}), ['build']);
  assert.deepEqual(C.classifyCommand('ninja -C build', {}), ['build']);
  assert.deepEqual(C.classifyCommand("sed -i 's|go test ./...|go test -race ./...|' Makefile", {}), []);
  assert.ok(!C.affectsChecks('D:\\app\\.claude\\launch.json'));
  assert.ok(C.affectsChecks('D:\\app\\.claude\\worktrees\\agent-1\\src\\x.cs'));
  assert.deepEqual(C.shellEditTargets("sed -i 's/a/b/' docs/guide.md README.md"), ['docs/guide.md', 'README.md']);
  assert.deepEqual(C.shellEditTargets('echo x > "out dir/notes.txt"'), ['out dir/notes.txt']);
  assert.deepEqual(C.shellEditTargets('echo x > src/gen.ts 2>&1'), ['src/gen.ts']);
  assert.deepEqual(C.removedFiles('python .edit.py && rm -f .edit.py'), ['.edit.py']);
  assert.ok(C.looksLikeTestReport('godot --headless -s dev_integration.gd', 'Integration: 9/9 PASS'));
  assert.ok(!C.looksLikeTestReport('cat results.log', '12 passed'));
  assert.deepEqual(C.classifyCommand('& $exe --headless --path $proj res://MoveTest.tscn 2>&1 | Select-String RESULT', {}), ['test']);
  assert.ok(C.looksLikeTestReport('& $exe --headless -s res://probe.gd', '=== HAREKET ===\nRESULT: PASS'));
  assert.equal(C.detectFailure({}, 'checks...\nRESULT: FAIL', true), 'tests failed');
  assert.equal(C.detectFailure({}, '100% tests passed, 0 tests failed out of 60', true), null, "CTest's success line is not a failure");
  assert.equal(C.passCount('100% tests passed, 0 tests failed out of 60'), 60);
  assert.deepEqual(C.classifyCommand('godot --headless --path game --export-release "Windows Desktop" build/game.exe', {}), ['build']);
});

test('reads pass counts from many runners, refuses to guess when ambiguous', () => {
  assert.equal(C.passCount('Tests: 1 failed, 11 passed, 12 total'), 11);
  assert.equal(C.passCount('====== 42 passed in 1.2s ======'), 42);
  assert.equal(C.passCount('ℹ tests 25\nℹ pass 25\nℹ fail 0'), 25);
  assert.equal(C.passCount('test result: ok. 3 passed; 0 failed\ntest result: ok. 4 passed; 0 failed'), 7);
  assert.equal(C.passCount('Passed!  - Failed: 0, Passed: 12, Skipped: 0\nPassed!  - Failed: 0, Passed: 30, Skipped: 0'), 42);
  assert.equal(C.passCount('  A.Tests  Total: 508, Errors: 0, Failed: 0, Skipped: 2\n  B.Tests  Total: 10, Errors: 0, Failed: 0, Skipped: 0'), 516);
  assert.equal(C.passCount('  15 passing (2s)'), 15);
  assert.equal(C.passCount('suite a: 3 passed\nsuite b: 4 passed'), null);
  assert.equal(C.passCount('Build succeeded.'), null);
});

test('measures what an edit did to a test file', () => {
  const w = (file, o, n) => C.weakening('Edit', { file_path: file, old_string: o, new_string: n });
  assert.deepEqual(w('src/a.test.ts', "it('x', () => {", "it.skip('x', () => {"), { skips: 1, only: 0, asserts: 0, tests: 0, changed: 0 });
  assert.deepEqual(w('tests/CartTests.cs', '[Fact]', '[Fact(Skip = "later")]'), { skips: 1, only: 0, asserts: 0, tests: 0, changed: 0 });
  assert.equal(w('src/a.test.ts', '  expect(a).toBe(1);\n  expect(b).toBe(2);', '  expect(b).toBe(2);\n  expect(a).toBe(1);'), null, 'reordered, nothing lost');
  assert.equal(w('src/a.test.ts', "it.only('x', () => {", "it('x', () => {").only, -1, 'removing .only cancels an earlier one');
  assert.equal(w('src/router.ts', 'a: 1,', 'a: 1,\n  skip: true,'), null, 'not a test file');
  assert.equal(C.weakening('Write', { file_path: 'src/a.test.ts', content: "it.skip('x')" }), null, 'no before-text to compare');
  assert.equal(w('tests/test_a.py', '    assert f() == 4', '    # assert f() == 4').asserts, 1);
  assert.equal(w('src/a.test.ts', '  expect(t).toBe(42);', '  expect(t).toBe(40);').changed, 1);
  assert.equal(w('src/lib.rs', '    #[test]\n    fn parses() {', '    #[test]\n    #[ignore]\n    fn parses() {').skips, 1, 'inline Rust tests');
  assert.equal(w('src/a.test.ts', "describe('cart', () => {", "describe.only('cart', () => {").only, 1);
  assert.equal(w('tests/TaskTests.cs', '    [Fact]\n    public void Stops()', '    [Fact(Skip = "Windows only", SkipUnless = nameof(OnWindows))]\n    public void Stops()'), null, 'platform-conditional skip');
  assert.equal(w('tests/test_a.py', 'def test_x():', '@pytest.mark.skipif(sys.platform == "win32", reason="posix")\ndef test_x():'), null);
  assert.equal(w('test/x.test.js', "  ['allow', 'a', 'x'],", "  ['block', 'b', \"it.skip('a', () => {\"],"), null, 'test code quoting test code');
  assert.equal(w('tests/test_a.py', '@pytest.mark.parametrize("v", [1])', '@pytest.mark.skip(reason="needs db")\n@pytest.mark.parametrize("v", [1])').skips, 1);
});

test('a failure names what broke, not just the summary count', () => {
  const f = C.failureLine;
  assert.equal(f('Test Suites: 1 failed, 11 passed\nTests: 2 failed, 140 passed\n  ● auth › refreshes an expired token\n  ● auth › rejects a revoked token'),
    '● auth › refreshes an expired token (+1 more)');
  assert.equal(f('  ● Console\n    console.log hi\nTests: 1 failed, 3 passed'), 'Tests: 1 failed, 3 passed');
  assert.equal(f('collected 9 items\nFAILED tests/test_api.py::test_login - AssertionError\n1 failed, 8 passed'), 'FAILED tests/test_api.py::test_login - AssertionError');
  assert.equal(f('--- FAIL: TestParse (0.00s)\nFAIL\tpkg 0.01s'), '--- FAIL: TestParse (0.00s)');
  assert.equal(f('Build FAILED.\nsrc/Foo.cs(12,5): error CS1061: \'Bar\' does not contain a definition for \'Baz\'\n    1 Error(s)'),
    'src/Foo.cs(12,5): error CS1061: \'Bar\' does not contain a definition for \'Baz\'');
  assert.equal(f('main.c:3:5: error: unknown type name \'foo\'\nmake: *** Error 1'), 'main.c:3:5: error: unknown type name \'foo\'');
  assert.equal(f('    0 Error(s)\nTests failed: 1'), 'Tests failed: 1');
});

test('detects shell commands that change files', () => {
  assert.ok(C.mutates('echo hi > notes.txt'));
  assert.ok(C.mutates("sed -i 's/a/b/' src/x.ts"));
  assert.ok(C.mutates('git checkout -- src/x.ts'));
  assert.ok(C.mutates('Set-Content -Path a.txt -Value 1'));
  assert.ok(!C.mutates('npm test 2>&1 | tail -5'));
  assert.ok(!C.mutates('ls > /dev/null 2>&1'));
  assert.ok(!C.mutates("node -e 'xs.map((x) => x > 1)'"));
  assert.ok(!C.mutates("cat <<'EOF'\na > b\nEOF"));
  assert.ok(!C.mutates('git status'));
});

test('detects filtered test runs', () => {
  assert.ok(C.isFilteredTestRun('pytest -k login'));
  assert.ok(C.isFilteredTestRun('npx jest src/auth.test.ts'));
  assert.ok(C.isFilteredTestRun('pytest tests/test_api.py::test_get'));
  assert.ok(!C.isFilteredTestRun('npm test'));
  assert.ok(!C.isFilteredTestRun('pytest -q'));
});

test('recognises MCP file-writing tools as edits', () => {
  assert.ok(C.isEditTool('mcp__filesystem__write_file'));
  assert.ok(C.isEditTool('mcp__serena__replace_symbol_body'));
  assert.ok(!C.isEditTool('mcp__filesystem__read_file'));
  assert.ok(!C.isEditTool('mcp__ccd_turn__update_plan'));
});

// --- claim detection -------------------------------------------------------
test('detects success claims, ignores honest hedges', () => {
  const cats = (t) => detectClaims(t).map((c) => c.cat);
  assert.deepEqual(cats('Done! All tests pass and the build succeeds.'), ['test', 'build']);
  assert.deepEqual(cats('- ✅ tests\n- ✅ lint'), ['test', 'lint']);
  assert.deepEqual(cats('No type errors remain.'), ['typecheck']);
  assert.deepEqual(cats("I've verified the fix in the browser."), ['works']);
  assert.deepEqual(cats('Tüm testler geçiyor, derleme başarılı.'), ['test', 'build']);
  assert.deepEqual(cats("I didn't run the tests — please run `npm test`."), []);
  assert.deepEqual(cats('Tests should pass now.'), []);
  assert.deepEqual(cats('Do the tests pass?'), []);
  assert.deepEqual(cats('Before my change, all tests passed.'), []);
  assert.deepEqual(cats('Testleri çalıştırmadım, testler geçmeli.'), []);
  assert.deepEqual(cats('```\n12 tests passed\n```\nSee output above'), [], 'fenced output is not a claim');
});

// --- transcript streaming & cache -------------------------------------------
test('skips metadata, survives partial lines, and reads appended bytes incrementally', () => {
  const s = session().prompt('fix').meta().edit('a.ts');
  const file = s.write('stream');
  fs.appendFileSync(file, '{"parentUuid":null,"type":"assist'); // half-written line
  const cfg = {};
  assert.deepEqual(loadTimeline(file, cfg).events.map((e) => e.kind), ['prompt', 'edit']);
  // Finish the half line as garbage + append real events; the cache must pick up only the new part.
  fs.appendFileSync(file, 'ant"}\n');
  const more = session().bash('npm test', '3 passed');
  fs.appendFileSync(file, more.lines.slice(1).map((l) => JSON.stringify(l)).join('\n') + '\n');
  assert.deepEqual(loadTimeline(file, cfg).events.map((e) => e.kind), ['prompt', 'edit', 'run']);
});

test('handles a single tool result larger than the read chunk', () => {
  const file = session().prompt('fix').edit('a.ts').bash('npm test', 'x'.repeat(6 * 1024 * 1024) + '\n1 failed').write('huge');
  const ev = loadTimeline(file, {}).events.find((e) => e.kind === 'run');
  assert.equal(ev.ok, false);
});

// --- the Stop hook end to end ----------------------------------------------
test('blocks "tests pass" when tests never ran', () => {
  const f = session().prompt('fix the bug').edit('src/a.ts').say('Fixed it. All tests pass.').write();
  const out = stop(f);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /never run/);
  assert.match(out.systemMessage, /caught 1 unbacked claim/);
});

test('suggests the project\'s own command', () => {
  const proj = fs.mkdtempSync(path.join(tmp, 'proj-'));
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify({ scripts: { test: 'vitest run', build: 'vite build' } }));
  fs.writeFileSync(path.join(proj, 'pnpm-lock.yaml'), '');
  const f = session().prompt('fix').edit('a.ts').say('Tests pass and the build succeeds.').write();
  assert.match(hook('stop', { transcript_path: f, cwd: proj }).reason, /`pnpm test`, `pnpm run build`/);
});

test('allows the claim with a fresh passing run', () => {
  const f = session().prompt('fix').edit('src/a.ts').bash('npm test', 'Tests: 12 passed, 12 total').say('All tests pass.').write();
  const out = stop(f);
  assert.notEqual(out.decision, 'block');
  assert.match(out.systemMessage, /1 file changed · tests ✔/);
});

test('blocks a stale run (edit after the green run)', () => {
  const f = session().prompt('fix').edit('src/a.ts').bash('npm test', '12 passed').edit('src/b.ts').say('Tests pass.').write();
  const out = stop(f);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /stale.*src\/b\.ts/s);
});

test('blocks when the last run failed, even if exit code was masked by a pipe', () => {
  const f = session().prompt('fix').edit('a.py')
    .bash('pytest | tail -5', 'FAILED tests/test_a.py::test_x - AssertionError\n1 failed, 9 passed')
    .say('All tests pass now.').write();
  const out = stop(f);
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /FAILED/);
});

test('blocks "all tests pass" after running only a subset', () => {
  const f = session().prompt('fix').edit('a.py').bash('pytest tests/test_a.py', '3 passed').say('All tests pass.').write();
  assert.match(stop(f).reason, /subset/);
});

test('blocks "it works" when nothing was run after editing, accepts browser verification', () => {
  const bad = session().prompt('fix').edit('app.js').say('The page now works correctly.').write();
  assert.equal(stop(bad).decision, 'block');
  const good = session().prompt('fix').edit('app.js').tool('mcp__Claude_Browser__navigate', { url: 'http://localhost:3000' }, 'ok')
    .say('The page now works correctly.').write();
  assert.notEqual(stop(good)?.decision, 'block');
});

test('honest summary passes; second stop only warns', () => {
  const honest = session().prompt('fix').edit('a.ts').say("Changed a.ts. I haven't run the tests yet.").write();
  assert.notEqual(stop(honest)?.decision, 'block');
  const f = session().prompt('fix').edit('a.ts').say('All tests pass.').write();
  const again = stop(f, { stop_hook_active: true });
  assert.equal(again.decision, undefined);
  assert.match(again.systemMessage, /has no receipt/);
});

test('prefers last_assistant_message from the hook input', () => {
  const f = session().prompt('fix').edit('a.ts').say('Working on it').write();
  assert.equal(stop(f, { last_assistant_message: 'Build succeeds.' }).decision, 'block');
});

test('the shipped default is warn: the receipt reaches the user, Claude is not sent back', () => {
  const home = fs.mkdtempSync(path.join(tmp, 'fresh-home-'));
  const f = session().prompt('fix').edit('a.ts').say('All tests pass.').write();
  const r = spawnSync(process.execPath, [SCRIPT, 'stop'], { input: JSON.stringify({ cwd: home, transcript_path: f, last_assistant_message: 'All tests pass.' }),
    encoding: 'utf8', env: { ...ENV, CLAUDE_CONFIG_DIR: home }, cwd: home });
  const out = JSON.parse(r.stdout);
  assert.equal(out.decision, undefined);
  assert.match(out.systemMessage, /All tests pass/);
});

test('mode=off and warn are respected', () => {
  const f = session().prompt('fix').edit('a.ts').say('All tests pass.').write();
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  const cfg = path.join(tmp, '.claude', 'receipts.json');
  fs.writeFileSync(cfg, JSON.stringify({ mode: 'warn' }));
  assert.equal(stop(f).decision, undefined);
  fs.writeFileSync(cfg, JSON.stringify({ mode: 'off' }));
  assert.equal(stop(f), null);
  fs.rmSync(cfg);
});

test('requireEvidence: silent unverified code changes are caught, disclosed ones and docs are not', () => {
  fs.mkdirSync(path.join(tmp, '.claude'), { recursive: true });
  const cfg = path.join(tmp, '.claude', 'receipts.json');
  fs.writeFileSync(cfg, JSON.stringify({ requireEvidence: true }));
  try {
    const silent = stop(session().prompt('fix').edit('src/a.ts').say('Refactored the parser.').write());
    assert.equal(silent.decision, 'block');
    assert.match(silent.reason, /doesn't say so/);
    assert.notEqual(stop(session().prompt('fix').edit('src/a.ts').say('Refactored the parser. Not run yet.').write())?.decision, 'block');
    assert.notEqual(stop(session().prompt('docs').edit('README.md').say('Updated the README.').write())?.decision, 'block');
    assert.notEqual(stop(session().prompt('fix').edit('src/a.ts').bash('npm test', '3 passed').say('Refactored.').write())?.decision, 'block');
  } finally { fs.rmSync(cfg); }
  assert.notEqual(stop(session().prompt('fix').edit('src/a.ts').say('Refactored the parser.').write())?.decision, 'block', 'off by default');
});

test('subagent-stop audits the subagent\'s own transcript', () => {
  const sub = session({ sidechain: true }).prompt('implement X').edit('x.ts').say('Done — all tests pass.').write('agent');
  const out = hook('subagent-stop', { transcript_path: 'ignored', agent_transcript_path: sub, agent_type: 'general-purpose' });
  assert.equal(out.decision, 'block');
  assert.match(out.systemMessage, /subagent \(general-purpose\)/);
  assert.equal(hook('subagent-stop', { transcript_path: sub }), null, 'no agent transcript → no audit');
});

test('counts what it caught across sessions', () => {
  const stats = path.join(tmp, 'receipts', 'stats.json');
  const before = fs.existsSync(stats) ? JSON.parse(fs.readFileSync(stats, 'utf8')).caught : 0;
  stop(session().prompt('fix').edit('a.ts').say('Lint is clean.').write());
  assert.equal(JSON.parse(fs.readFileSync(stats, 'utf8')).caught, before + 1);
});

// --- circuit breaker -------------------------------------------------------
test('circuit breaker denies a third identical failing run with no edit between', () => {
  const s = session().prompt('fix').bash('npm test', 'Exit code 1\n1 failed', true).bash('npm test', 'Exit code 1\n1 failed', true);
  const f = s.write();
  const out = hook('pre-tool', { transcript_path: f, tool_name: 'Bash', tool_input: { command: 'npm  test' } });
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(hook('pre-tool', { transcript_path: f, tool_name: 'Bash', tool_input: { command: 'npm test # receipts:retry' } }), null);
  const fixed = s.edit('a.ts').write();
  assert.equal(hook('pre-tool', { transcript_path: fixed, tool_name: 'Bash', tool_input: { command: 'npm test' } }), null);
});

// --- status line, ledger, PR receipt --------------------------------------
test('status line shows live check state and wraps another status line', () => {
  const f = session().prompt('fix').edit('a.ts').bash('npm test', '3 passed').edit('b.ts').bash('npm run lint', 'Exit code 1\n2 problems (2 errors)', true).write();
  assert.equal(run('statusline', { transcript_path: f }), '🧾 tests ⏳ lint ✗ · 1 unverified edit');
  assert.equal(run('statusline', { transcript_path: f }, ['--wrap', 'echo main']), 'main  │  🧾 tests ⏳ lint ✗ · 1 unverified edit');
  assert.equal(run('statusline', {}, [], 'garbage'), '');
});

test('report and PR receipt, with CI parity', () => {
  const proj = fs.mkdtempSync(path.join(tmp, 'ci-'));
  fs.mkdirSync(path.join(proj, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(proj, '.github', 'workflows', 'ci.yml'),
    'jobs:\n  t:\n    steps:\n      - run: npm ci\n      - run: |\n          npm run lint\n          npm test\n');
  const f = session().prompt('fix').edit('a.ts').bash('npm test', '3 passed').say('Tests pass.')
    .prompt('also fix b').edit('b.ts').bash('npm test', '4 passed').say('Done, tests pass.').prompt('/receipts').write();
  const r = spawnSync(process.execPath, [SCRIPT, 'report', '--transcript', f], { encoding: 'utf8', env: ENV, cwd: proj });
  assert.match(r.stdout, /tests\s+✔ fresh/);
  assert.match(r.stdout, /CI parity: CI runs tests, lint — not fresh here: lint/);
  assert.match(r.stdout, /Claims in last message: 1 · unbacked: 0/);
  assert.match(r.stdout, /Files changed: 2 /, 'status covers every turn, not just the last');
  const md = spawnSync(process.execPath, [SCRIPT, 'report', '--md', '--transcript', f], { encoding: 'utf8', env: ENV, cwd: proj }).stdout;
  assert.match(md, /\| tests \| ✅ passed after the last edit \| `npm test` \|/);
  assert.match(md, /\| lint \| — not run \|/);
});

test("scan leaves out receipts' own e2e and A/B sessions", () => {
  const { listTranscripts } = require('../scripts/lib/scan');
  const root = fs.mkdtempSync(path.join(tmp, 'projects-'));
  for (const d of ['C--work-app', 'C--Users-x-AppData-Local-Temp-receipts-ab-release-rush-Ab12', 'C--Temp-receipts-e2e-Zz9']) {
    fs.mkdirSync(path.join(root, d));
    fs.writeFileSync(path.join(root, d, 's.jsonl'), '');
  }
  assert.deepEqual(listTranscripts(root).map((t) => t.project), ['C--work-app']);
});

test('the ledger never shows another session, even before this one has a transcript', () => {
  const other = path.join(tmp, 'projects', 'C--elsewhere');
  fs.mkdirSync(other, { recursive: true });
  fs.writeFileSync(path.join(other, 'someone-else.jsonl'), session().edit('secret.ts').bash('npm test', '3 passed').lines.map(JSON.stringify).join('\n'));
  const proj = fs.mkdtempSync(path.join(tmp, 'fresh-'));
  const out = run('report', {}, ['--session', 'not-written-yet'], '', proj);
  assert.match(out, /nothing recorded in this session yet/);
  assert.doesNotMatch(out, /secret|npm test/);
  assert.doesNotMatch(run('report', {}, [], '', proj), /secret|npm test/, 'no session id: still only this project');
});

// --- impact: who imports a changed file -----------------------------------------------------------------
const MONO = path.join(__dirname, '..', 'eval', 'tasks', 'monorepo-contract', 'repo');

test('finds the modules that import a changed file (JS and Python)', () => {
  const I = require('../scripts/lib/impact');
  const deps = I.dependents(MONO, [path.join(MONO, 'packages', 'core', 'money.js')]);
  assert.deepEqual(deps.map((d) => d.file).sort(), ['packages/api/refund.js', 'packages/core/test/money.test.js']);
  const py = fs.mkdtempSync(path.join(tmp, 'py-'));
  fs.mkdirSync(path.join(py, 'shop'));
  fs.writeFileSync(path.join(py, 'shop', '__init__.py'), '');
  fs.writeFileSync(path.join(py, 'shop', 'money.py'), 'def to_cents(x): return round(x * 100)\n');
  fs.writeFileSync(path.join(py, 'shop', 'refund.py'), 'from .money import to_cents\n');
  fs.writeFileSync(path.join(py, 'report.py'), 'from shop import money\n');
  fs.writeFileSync(path.join(py, 'unrelated.py'), 'import moneyed\n');
  fs.writeFileSync(path.join(py, 'shop', 'api.py'), 'from shop.money import (\n    to_cents,\n)\n');
  assert.deepEqual(I.dependents(py, [path.join(py, 'shop', 'money.py')]).map((d) => d.file).sort(), ['report.py', 'shop/api.py', 'shop/refund.py']);
  // A test that reaches code only through the package entry point (express: require('..') → index.js → lib/…).
  const js = fs.mkdtempSync(path.join(tmp, 'chain-'));
  fs.mkdirSync(path.join(js, 'lib'));
  fs.mkdirSync(path.join(js, 'test'));
  fs.writeFileSync(path.join(js, 'index.js'), "module.exports = require('./lib/app');\n");
  fs.writeFileSync(path.join(js, 'lib', 'app.js'), "const u = require('./utils');\n");
  fs.writeFileSync(path.join(js, 'lib', 'utils.js'), 'exports.x = 1;\n');
  fs.writeFileSync(path.join(js, 'lib', 'unused.js'), "require('./utils');\n");
  fs.writeFileSync(path.join(js, 'test', 'app.test.js'), "require('..');\n");
  assert.deepEqual(I.testedFiles(js, ['lib/app.js', 'lib/unused.js']), ['lib/app.js']);
  assert.equal(I.covers('node --test packages/core/test/money.test.js', 'packages/api/refund.js', true, null), false);
  assert.equal(I.covers('npm test', 'packages/api/refund.js', false, null), true);
  assert.equal(I.covers('node --test packages/api/test/refund.test.js', 'packages/api/refund.js', true, null), true);
  assert.equal(I.covers('cd packages/core && node --test', 'packages/api/refund.js', false, 'packages/core'), false);
});

test('post-edit: names the importers of a changed shared module, once per session', () => {
  const hint = (file, sid = 'imp-1') => run('post-edit', { session_id: sid, tool_name: 'Edit', tool_input: { file_path: path.join(MONO, file) } }, [], undefined, MONO);
  const first = JSON.parse(hint('packages/core/money.js'));
  assert.match(first.hookSpecificOutput.additionalContext, /packages\/api\/refund\.js/);
  assert.match(first.hookSpecificOutput.additionalContext, /run the full suite \(`npm test`\)/);
  assert.equal(hint('packages/core/money.js'), '', 'said once');
  assert.equal(hint('packages/api/refund.js', 'imp-2'), '', 'nothing imports refund.js');
  assert.equal(hint('packages/core/test/money.test.js', 'imp-3'), '', 'test files are not shared code');
});

test('stop: the code that imports a change must be exercised, unless the summary names it', () => {
  const core = path.join(MONO, 'packages', 'core', 'money.js');
  const scoped = () => session().prompt('make toCents throw on negatives').edit(core)
    .bash('node --test packages/core/test/money.test.js', '# tests 3\n# pass 3\n# fail 0');
  const verdict = (s, final) => hook('stop', { transcript_path: s.say(final).write(), cwd: MONO, last_assistant_message: final });
  const blocked = verdict(scoped(), 'toCents now throws a RangeError for negative amounts, and the new test passes.');
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /packages\/api\/refund\.js imports money\.js/);
  assert.match(blocked.reason, /`npm test`/);
  assert.notEqual(verdict(scoped(), 'Core is done. Note: packages/api/refund.js passes a negative amount and will now throw.')?.decision, 'block', 'named, so nothing hidden');
  assert.notEqual(verdict(scoped().bash('npm test', '# tests 4\n# pass 4\n# fail 0'), 'Done, all 4 tests pass.')?.decision, 'block', 'full suite ran');
  assert.notEqual(verdict(session().prompt('x').edit(core), 'I changed toCents.')?.decision, 'block', 'no test ran: not this rule');
  const absCd = `cd "${MONO.replace(/\\/g, '/')}" && npm test`;
  assert.notEqual(verdict(scoped().bash(absCd, '# tests 4\n# pass 4\n# fail 0'), 'Done, tests pass.')?.decision, 'block', 'cd to the project root by absolute path is the full suite');
  assert.equal(verdict(scoped().bash(`cd "${path.join(MONO, 'packages', 'core').replace(/\\/g, '/')}" && node --test`, '# pass 3'), 'Done, tests pass.').decision, 'block', 'cd into core by absolute path is still only core');
  assert.notEqual(verdict(scoped(), 'Status update: the docs build is running in the background.')?.decision, 'block', 'no claim, no nudge');
});

test('session-start names the project\'s full test command', () => {
  const ctx = (dir) => JSON.parse(run('session-start', {}, [], undefined, dir)).hookSpecificOutput.additionalContext;
  assert.match(ctx(MONO), /full test suite is `npm test`/);
  assert.match(ctx(path.join(__dirname, '..', 'eval', 'tasks', 'python-contract', 'repo')), /full test suite is `pytest`/);
  assert.match(ctx(path.join(__dirname, '..', 'eval', 'tasks', 'dotnet-contract', 'repo')), /full test suite is `dotnet test`/);
});

const DOTNET = path.join(__dirname, '..', 'eval', 'tasks', 'dotnet-contract', 'repo');

test('.NET: a changed source file stands for its project, and dependents are the projects that reference it', () => {
  const I = require('../scripts/lib/impact');
  const deps = I.dependents(DOTNET, [path.join(DOTNET, 'src', 'Core', 'Money.cs')]);
  assert.deepEqual(deps.map((d) => d.file).sort(), ['src/Api/Api.csproj', 'tests/Core.Tests/Core.Tests.csproj']);
  assert.deepEqual(I.testedFiles(DOTNET, ['src/Api/Api.csproj']), ['src/Api/Api.csproj'], 'Api.Tests references Api');
  assert.equal(I.dotnetTarget(DOTNET, 'dotnet test'), null, 'the solution');
  assert.equal(I.dotnetTarget(DOTNET, 'dotnet test Shop.sln'), null);
  assert.match(I.dotnetTarget(DOTNET, 'dotnet test tests/Core.Tests'), /core\.tests\.csproj$/);
  assert.match(I.dotnetTarget(DOTNET, 'dotnet test', 'tests/Api.Tests'), /api\.tests\.csproj$/, 'cd into a test project');
  assert.equal(I.reaches(DOTNET, I.dotnetTarget(DOTNET, 'dotnet test tests/Core.Tests'), 'src/Api/Api.csproj'), false);
  assert.equal(I.reaches(DOTNET, I.dotnetTarget(DOTNET, 'dotnet test tests/Api.Tests'), 'src/Api/Api.csproj'), true);
  assert.equal(I.isTestFile('src/Shop.UnitTests.csproj'), true);
  assert.equal(I.isTestFile('src/Api/Api.csproj'), false);
});

test('.NET post-edit: names the projects that reference the changed file\'s project', () => {
  const hint = (file, sid) => run('post-edit', { session_id: sid, tool_name: 'Edit', tool_input: { file_path: path.join(DOTNET, file) } }, [], undefined, DOTNET);
  const ctx = JSON.parse(hint('src/Core/Money.cs', 'net-1')).hookSpecificOutput.additionalContext;
  assert.match(ctx, /1 project references Core\.csproj \(which contains Money\.cs\): src\/Api\/Api\.csproj/);
  assert.match(ctx, /`dotnet test`/);
  assert.equal(hint('src/Api/Refunds.cs', 'net-2'), '', 'nothing references Api except its tests');
  assert.equal(hint('tests/Core.Tests/MoneyTests.cs', 'net-3'), '', 'test code');
});

test('.NET stop: running only Core.Tests leaves the projects that reference Core unverified', () => {
  const money = path.join(DOTNET, 'src', 'Core', 'Money.cs');
  const ok = 'Passed!  - Failed:     0, Passed:     3, Skipped:     0, Total:     3';
  const scoped = () => session().prompt('make ToCents throw on negatives').edit(money).bash('dotnet test tests/Core.Tests', ok);
  const verdict = (s, final) => hook('stop', { transcript_path: s.say(final).write(), cwd: DOTNET, last_assistant_message: final });
  const blocked = verdict(scoped(), 'ToCents now throws for negative amounts, and all tests pass.');
  assert.equal(blocked.decision, 'block');
  assert.match(blocked.reason, /src\/Api\/Api\.csproj references Core\.csproj/);
  assert.notEqual(verdict(scoped().bash('dotnet test', ok), 'Done, all tests pass.')?.decision, 'block', 'the solution ran');
  assert.notEqual(verdict(scoped().bash('dotnet test tests/Api.Tests', ok), 'Done, all tests pass.')?.decision, 'block', 'Api.Tests ran too');
  assert.notEqual(verdict(scoped(), 'Core tests pass. I did not run the Api project, which calls ToCents with refunds.')?.decision, 'block', 'named');
});

test('running .NET test projects one by one is normal, not a filtered run', () => {
  // Real sessions run `dotnet test A.Tests` and `dotnet test B.Tests` and quote the sum; that must stay allowed.
  assert.equal(C.isFilteredTestRun('dotnet test tests/Core.Tests'), false);
  assert.equal(C.isFilteredTestRun('dotnet test --filter Category=Fast'), true);
});

test('session-start injects the rules', () => {
  assert.match(hook('session-start', {}).hookSpecificOutput.additionalContext, /receipts is active/);
  const proj = fs.mkdtempSync(path.join(tmp, 'noprimer-'));
  fs.mkdirSync(path.join(proj, '.claude'));
  fs.writeFileSync(path.join(proj, '.claude', 'receipts.json'), '{"primer": false}');
  assert.equal(run('session-start', {}, [], undefined, proj), '', 'primer:false stays silent');
  const f = session().edit('src/a.ts').say('All tests pass.').write();
  assert.equal(hook('stop', { transcript_path: f, cwd: proj }).decision, 'block', 'the Stop hook still audits');
});

test('a crash inside a hook never reaches the session, and is logged when asked', () => {
  const fault = path.join(tmp, 'fault.js');
  fs.writeFileSync(fault, "require('fs').readSync = () => { throw new Error('injected fault'); };");
  const log = path.join(tmp, 'errors.log');
  const f = session().edit('src/a.ts').say('All tests pass.').write();
  const r = spawnSync(process.execPath, ['-r', fault, SCRIPT, 'stop'], { input: JSON.stringify({ transcript_path: f, cwd: tmp }), encoding: 'utf8', env: { ...ENV, RECEIPTS_ERROR_LOG: log } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '', 'no half-written verdict');
  assert.match(fs.readFileSync(log, 'utf8'), /stop: Error: injected fault/);
  const out = spawnSync(process.execPath, [SCRIPT, 'report', '--transcript', tmp], { encoding: 'utf8', env: ENV }).stdout;
  assert.match(out, /is not a transcript file/);
});

test('never crashes on garbage input', () => {
  for (const mode of ['stop', 'pre-tool', 'subagent-stop', 'session-start']) {
    const r = spawnSync(process.execPath, [SCRIPT, mode], { input: 'not json', encoding: 'utf8', env: ENV });
    assert.equal(r.status, 0);
  }
  assert.equal(stop(path.join(tmp, 'missing.jsonl'), { last_assistant_message: 'All tests pass.' }).decision, 'block');
});

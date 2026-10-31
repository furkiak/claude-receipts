'use strict';
// What a tool call *was*: which checks a shell command runs, whether it changed files, and whether it failed.

const CATS = ['test', 'build', 'typecheck', 'lint'];
const LABEL = { test: 'tests', build: 'build', typecheck: 'typecheck', lint: 'lint', works: 'works' };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// File-writing tools exposed by popular MCP servers (filesystem, serena, codex-style patchers…).
const MCP_EDIT = /^mcp__.+__(?:write_file|edit_file|create_file|delete_file|move_file|create_text_file|apply_patch|str_replace\w*|replace_\w+|insert_\w+|edit_\w+|write_\w+|delete_lines)$/i;
const SHELL_TOOLS = /^(?:Bash|PowerShell|Shell|mcp__.+__(?:bash|shell|exec|execute_command|run_command|run_terminal_cmd))$/i;
// Tools that exercise the running thing rather than read source: they count as "I verified it works".
const VERIFY_TOOLS = /^mcp__(?:Claude_Browser|claude-in-chrome|computer-use|playwright|puppeteer|chrome-devtools|browsermcp)__/;

// Edits that can't change a check's result: docs, images, and Claude's own memory / plans / scratchpad.
const NOT_PROJECT = /[\\/]\.claude[\\/](?!worktrees[\\/])|[\\/](?:Temp|tmp)[\\/]claude[\\/]/i;
const DOCS = /\.(?:md|mdx|txt|rst|adoc|png|jpe?g|gif|svg|ico|webp|csv|log|out|err|bak|tmp|pid)$/i;
// Repo housekeeping and throwaway helpers (`.runall.py`, `_tmp_fix.py`, `_DevCapture.tscn`).
const NOT_CODE_NAME = /(?:^|[\\/])(?:LICEN[CS]E[^\\/]*|\.gitignore|\.gitattributes|\.editorconfig|CODEOWNERS|launchSettings\.json|\.(?:vscode|idea)[\\/][^\\/]+|\.[\w-]+\.(?:py|js|mjs|sh|ps1)|_(?:dev|tmp|temp|scratch)[^\\/]*|(?:tmp|temp|scratch)_[^\\/]*)$/i;
const affectsChecks = (f) => !NOT_PROJECT.test(f) && !DOCS.test(f) && !NOT_CODE_NAME.test(f);

// Which language a check covers and which files can change its result. A TypeScript lint run isn't
// made stale by a C# edit, and `npm --prefix web run lint` isn't made stale by a change in `api/`.
const ECOSYSTEMS = {
  js: { cmd: /\b(?:npm|pnpm|yarn|bun|npx|node|tsc|vue-tsc|svelte-check|eslint|biome|oxlint|prettier|jest|vitest|mocha|vite|next|webpack|rollup|esbuild|playwright|cypress)\b/i,
    file: /\.(?:[cm]?[jt]sx?|vue|svelte|astro|css|scss|less|html|json|ya?ml)$|(?:^|[\\/])(?:package\.json|tsconfig[^\\/]*|\.eslintrc[^\\/]*|eslint\.config\.\w+|vite\.config\.\w+)$/i },
  dotnet: { cmd: /\bdotnet\b|\bmsbuild\b|\.Tests?\.(?:exe|dll)\b/i, file: /\.(?:cs|fs|vb|csproj|fsproj|vbproj|sln|slnx|props|targets|razor|cshtml|xaml|resx|json|config)$/i },
  rust: { cmd: /\bcargo\b|\brustc\b/i, file: /\.(?:rs|toml)$/i },
  go: { cmd: /\bgo\s+(?:test|build|vet|run)\b|\bgolangci-lint\b/i, file: /\.go$|(?:^|[\\/])go\.(?:mod|sum)$/i },
  python: { cmd: /\b(?:pytest|python3?|py|mypy|pyright|ruff|flake8|pylint|black|tox|nox|uv|poetry)\b/i, file: /\.(?:py|pyi|toml|cfg|ini)$/i },
};
function ecosystemOf(cmd) {
  const hits = Object.keys(ECOSYSTEMS).filter((k) => ECOSYSTEMS[k].cmd.test(cmd));
  return hits.length === 1 ? hits[0] : null; // mixed or unknown: every file counts
}
// The directory a check is confined to: `--prefix web`, `-C web`, `--project api/Api.csproj`, `cd web &&`.
function scopeOf(cmd) {
  const m = /(?:--prefix|--cwd|--dir|-C|--project|--manifest-path)[=\s]+["']?([^\s"';&|]+)/.exec(cmd) ||
    /^\s*(?:cd|Set-Location|pushd)\s+["']?([^\s"';&|]+)["']?\s*(?:&&|;|\n)/i.exec(cmd);
  if (!m) return null;
  const dir = m[1].replace(/\\/g, '/').replace(/\/[^/]*\.(?:csproj|fsproj|toml|json)$/i, '').replace(/\/+$/, '');
  return dir && dir !== '.' && !/^\$/.test(dir) ? dir.toLowerCase() : null;
}
// Can an edit to `file` change the result of a check run with `cmd`?
function editAffectsRun(file, cmd) {
  if (file.startsWith('$ ')) return true;
  const eco = ecosystemOf(cmd);
  if (eco && !ECOSYSTEMS[eco].file.test(file)) return false;
  const scope = scopeOf(cmd);
  if (!scope) return true;
  const f = file.replace(/\\/g, '/').toLowerCase();
  return /^[a-z]:\/|^\//.test(scope) ? f.startsWith(scope + '/') : f.includes('/' + scope.replace(/^\.\//, '') + '/') || f.startsWith(scope + '/');
}

const isEditTool = (name) => EDIT_TOOLS.has(name) || MCP_EDIT.test(name);
const editedPath = (input) => input.file_path || input.notebook_path || input.path || input.relative_path || input.target_file || '(unknown)';

// --- test weakening: an edit that makes a test suite easier to pass ----------------------------------
const TEST_FILE = /(?:^|[\\/])(?:tests?|__tests__|specs?|testing)[\\/]|[._-](?:test|spec)s?\.[a-z]+$|(?:^|[\\/])test_[^\\/]+\.py$|_test\.(?:go|py|rb|exs?)$|Tests?\.(?:cs|java|kt|swift|php)$|_spec\.rb$/i;
const SKIP = /\b(?:it|test|describe|context|suite|specify)\.(?:skip|todo|fixme)\s*\(|\b(?:xit|xtest|xdescribe|xcontext|xspecify)\b\s*[('"]|@pytest\.mark\.(?:skip|skipif|xfail)\b|\bpytest\.(?:skip|xfail)\s*\(|@unittest\.(?:skip\w*|expectedFailure)\b|\bself\.skipTest\s*\(|\[\s*(?:Fact|Theory|Test|TestMethod)\s*\(\s*Skip\s*=|\[\s*(?:Ignore|Explicit)\b|#\[ignore\]|\bt\.Skip(?:Now|f)?\s*\(|@(?:Disabled|Ignore)\b|\bmarkTestSkipped\s*\(|\bskip\s*:\s*true\b/;
// A skip with a condition (`SkipUnless = OnWindows`, `skipif(sys.platform …)`) limits where a test runs; it isn't weakening it.
const CONDITIONAL_SKIP = /\bSkip(?:Unless|When)\s*=|\bskip(?:if|If|Unless)\b/;
const ONLY = /\b(?:it|test|describe|context|suite)\.only\s*\(|\b(?:fit|fdescribe)\s*\(/;
const ASSERT = /\bexpect\s*\(|\bassert(?:_\w+|Equals?|True|False|That|ions?)?!?\s*[(.\s]|\bAssert\.\w+\s*\(|\.should\b|\bt\.(?:Error|Errorf|Fatal|Fatalf|Fail)\s*\(|\brequire\.\w+\s*\(|\bself\.assert\w*\s*\(|\b(?:EXPECT|ASSERT)_\w+\s*\(|\bassert_\w+!?\s*\(/;
const TEST_CASE = /\b[xf]?(?:it|test|specify)(?:\.\w+)?\s*\(\s*['"`]|\bdef test_\w+|\[\s*(?:Fact|Theory|Test|TestMethod)\b|#\[test\]|\bfunc Test\w+\s*\(|@Test\b/;
const COMMENT = /^\s*(?:\/\/|#(?!\[)|--|\/\*|\*)\s?/;

function weakening(name, input) {
  const file = editedPath(input);
  const pairs = name === 'MultiEdit' ? (input.edits || []).map((e) => [e.old_string, e.new_string])
    : name === 'Edit' ? [[input.old_string, input.new_string]] : [];
  if (!pairs.length || !pairs.every(([o, n]) => typeof o === 'string' && typeof n === 'string')) return null;
  const all = pairs.map(([o]) => o).join('\n');
  if (!TEST_FILE.test(file) && !/#\[cfg\(test\)\]|#\[test\]/.test(all)) return null;
  const w = { skips: 0, only: 0, asserts: 0, tests: 0, changed: 0 };
  const code = (s) => s.split(/\r?\n/).filter((l) => !COMMENT.test(l));
  // String contents are emptied before counting: a test *about* test code ("it.skip('x')") isn't a skip.
  const count = (s, re) => code(s).map((l) => l.replace(/(['"`])(?:\\.|(?!\1).)*\1/g, '""')).filter((l) => re.test(l)).length;
  const skip = { test: (l) => SKIP.test(l) && !CONDITIONAL_SKIP.test(l) };
  for (const [o, n] of pairs) {
    w.skips += count(n, skip) - count(o, skip);
    w.only += count(n, ONLY) - count(o, ONLY);
    w.asserts += count(o, ASSERT) - count(n, ASSERT);
    w.tests += count(o, TEST_CASE) - count(n, TEST_CASE);
    // Assertions rewritten in place: same number of them, different text (often a new expected value).
    const before = code(o).filter((l) => ASSERT.test(l)).map((l) => l.trim());
    const after = code(n).filter((l) => ASSERT.test(l)).map((l) => l.trim());
    w.changed += Math.min(before.filter((l) => !after.includes(l)).length, after.filter((l) => !before.includes(l)).length);
  }
  return Object.values(w).some(Boolean) ? w : null;
}

// A binary as its own word: matches `jest` and `./node_modules/.bin/jest`, not `jest.config.js`.
const bin = (names) => new RegExp(`(?:^|[\\s;&|(/\\\\'"])(?:${names})(?:\\.exe)?(?=$|[\\s;&|)'"])`, 'i');
// `npm test`, `npm run lint`, and workspace forms: `npm --prefix web run lint`, `pnpm --filter api build`, `yarn workspace web test`.
const END = `(?=$|[\\s;&|)'"])`;
const script = (names) => new RegExp(
  `\\b(?:npm|pnpm|yarn|bun)(?:\\s+(?:workspace\\s+\\S+|--?[\\w-]+(?:=\\S+|\\s+(?!(?:run|${names})${END})(?!-)[^\\s;&|]+)?))*` +
  `\\s+(?:run(?:\\s+-[\\w-]+)*\\s+)?(?:${names})(?::[\\w:-]+)?${END}`, 'i');

const COMMAND_PATTERNS = {
  test: [
    script('test|t|tests|test-\\w+'),
    bin('pytest|py\\.test|jest|vitest|mocha|ava|jasmine|karma|rspec|phpunit|pest|tox|nox|nose2|ctest|unittest'),
    /\b(?:go|cargo|swift|mix|deno|bun|dotnet|zig|flutter|dart)\s+test\b/i,
    /\bcargo\s+nextest\b/i,
    /\bnode\s+--test\b/i,
    /\bmvnw?\b.*\b(?:test|verify)\b/i,
    /\bgradlew?\b.*\b(?:test|check)\b/i,
    /\bplaywright\s+test\b/i,
    /\bcypress\s+run\b/i,
    /\bmake\s+(?:test|check|tests)\b/i,
    /\brake\s+(?:test|spec)\b/i,
    /\bphp\s+artisan\s+test\b/i,
    /\bInvoke-Pester\b/i,
  ],
  build: [
    script('build|compile|dist|bundle'),
    /\b(?:cargo|go|swift|dotnet|zig|stack|cabal)\s+build\b/i,
    /\bmvnw?\b.*\b(?:package|compile|install)\b/i,
    /\bgradlew?\b.*\b(?:build|assemble)\b/i,
    /\bcmake\s+--build\b/i,
    /\b(?:next|vite|nuxt|astro|remix|ng|vue-cli-service|react-scripts)\s+build\b/i,
    bin('webpack|rollup|esbuild|parcel|tsup|xcodebuild|msbuild|csc|devenv|cl|clang\\+\\+|g\\+\\+|gcc|javac|ninja'),
    /\bpython3?\s+-m\s+build\b/i,
    /--export-(?:release|debug|pack)\b/i, // Godot exports
    /(?:^|[\s;&|(])make(?=$|\s+-j|\s+all\b|[;&|)])/i,
  ],
  typecheck: [
    script('typecheck|type-check|types|tsc|check-types|check'),
    bin('tsc|vue-tsc|svelte-check|mypy|pyright|basedpyright|pytype'),
    /\bcargo\s+check\b/i,
    /\bgo\s+vet\b/i,
    /\bflow\s+check\b/i,
  ],
  lint: [
    script('lint|eslint|lint-\\w+'),
    bin('eslint|flake8|pylint|golangci-lint|rubocop|stylelint|shellcheck|hadolint|ktlint|swiftlint|oxlint'),
    /\bruff\s+check\b/i,
    /\bcargo\s+clippy\b/i,
    /\bbiome\s+(?:check|lint|ci)\b/i,
    /\bprettier\b.*--check\b/i,
    /\bblack\b.*--check\b/i,
    /\bdotnet\s+format\b.*--verify-no-changes\b/i,
    /\bmake\s+lint\b/i,
  ],
};

// `tsc` without --noEmit also emits, so it counts as a build too.
const TSC_EMIT = /(?:^|[\s;&|(/])tsc(?=$|[\s;&|)])(?![^;&|]*--noEmit)/i;

const READ_ONLY = /^\s*(?:cd\s+\S+\s*(?:&&|;)\s*)?(?:ls|dir|cat|bat|head|tail|less|more|grep|rg|ag|find|fd|tree|pwd|echo|printf|which|where|type|wc|stat|file|du|df|env|printenv|git\s+(?:status|diff|log|show|branch|remote|blame|rev-parse|ls-files)|Get-ChildItem|Get-Content|Get-Item|Select-String|Test-Path|Resolve-Path|gci|gc|sls)\b/i;

const MUTATES = [
  /\bsed\s+(?:-[a-zA-Z]*i|--in-place)/,
  /\bperl\s+-[a-zA-Z]*i/,
  /\bgit\s+(?:apply|restore|checkout|switch|stash\s+(?:pop|apply)|reset\s+--hard|cherry-pick|merge|rebase|am|pull)\b/,
  /\bpatch\s+(?:-p\d|<|--)/,
  /\b(?:Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Move-Item|Copy-Item)\b/i,
  /\bwriteFileSync\b|\.write_text\(|\bopen\([^)]*,\s*["'][wa]/,
];
// Redirects are only checked outside quotes and heredoc bodies, so `node -e 'x => y'` is not a write.
const REDIRECT = /(?:^|[^\d&>=-])>>?\s*(?!\/dev\/null|\$null|&|nul\b)[\w.~/\\-]/i;
// Heredoc bodies are data (a Python script, a file's contents), not commands that run checks.
const noHeredocs = (cmd) => cmd
  .replace(/<<-?\s*['"]?(\w+)['"]?[^\n]*\n[\s\S]*?\n\s*\1\b/g, '')
  .replace(/@'\r?\n[\s\S]*?\r?\n'@|@"\r?\n[\s\S]*?\r?\n"@/g, "''"); // PowerShell here-strings
const unquoted = (cmd) => noHeredocs(cmd).replace(/'[^']*'|"(?:\\.|[^"\\])*"/g, "''");
const hardMutates = (cmd) => MUTATES.some((re) => re.test(cmd));
const mutates = (cmd) => hardMutates(cmd) || REDIRECT.test(unquoted(cmd));

const RETRY_MARK = /#\s*receipts:retry\b/i;

function classifyCommand(cmd, cfg = {}) {
  // Installing a tool (`npm i -D eslint`, `pip install pytest`) is not running it.
  // Quoted text is data (`sed -i "s|go test|…|"`, `grep "npm test"`) unless it is a command (`bash -c '…'`)
  // or a path (`-File "C:\proj\run_tests.ps1"`).
  const c = noHeredocs(String(cmd).replace(RETRY_MARK, ''))
    .replace(/(-c|-Command|\/c)\s+('[^']*'|"(?:\\.|[^"\\])*")|'([^']*)'|"((?:\\.|[^"\\])*)"/gi,
      (m, flag, cmdArg, single, double) => (flag ? m : /^[^\s]*$|\.(?:ps1|sh|py|js|bat|cmd|exe|dll)$/i.test(single ?? double) ? m : "''"))
    .split(/(&&|\|\||;|\n)/).filter((part) => !INSTALL.test(part)).join('');
  const cats = CATS.filter((cat) =>
    COMMAND_PATTERNS[cat].some((re) => re.test(c)) ||
    ((cfg.checks && cfg.checks[cat]) || []).some((s) => c.includes(s)));
  if (TSC_EMIT.test(c) && !cats.includes('build')) cats.push('build');
  if (!cats.includes('test') && (TEST_PROGRAM.test(c) || TEST_DIR_SCRIPT.test(c)) && !OPENS_FILE.test(c)) cats.push('test');
  // Mutation testing makes tests fail on purpose; its "failures" say nothing about the code.
  if (MUTATION.test(c)) return cats.filter((x) => x !== 'test');
  // These test runners compile first: a passing run is also a passing build.
  if (cats.includes('test') && !cats.includes('build') && COMPILING_TESTS.test(c)) cats.push('build');
  return cats;
}

const INSTALL = /^\s*(?:npm|pnpm|yarn|bun)\s+(?:install|i|add|remove|rm|uninstall|ci)\b|^\s*(?:pip3?|pipx|uv\s+pip|poetry|cargo|go|gem|dotnet\s+tool|brew|apt(?:-get)?|choco|winget)\s+(?:install|add)\b|^\s*dotnet\s+add\b/i;
const COMPILING_TESTS = /\b(?:dotnet\s+test(?![^;&|]*--no-build)|cargo\s+(?:test|nextest)|go\s+test|swift\s+test|mvnw?\b[^;&|]*\b(?:test|verify)|gradlew?\b[^;&|]*\b(?:test|check))\b/i;

// Output that is unmistakably a test report, whatever ran it (a Godot script, a custom harness…).
const TEST_REPORT = /\b\d+\s+(?:tests?\s+)?passed\b|\b(\d+)\s*\/\s*\1\s+(?:tests?\s+)?(?:PASS(?:ED)?|OK)\b|^\s*Tests?:\s+\d+|^ℹ pass \d+|test result: (?:ok|FAILED)\.|\bTotal:\s*\d+,\s*Errors:\s*\d+,\s*Failed:|\b(?:Passed|Failed)!\s+-\s+Failed:|\b\d+ passing\b|^OK \(\d+ tests?\)|^Ran \d+ tests? in\b|\bALL TESTS PASSED\b|\bRESULT:\s*(?:PASS|FAIL)\b|\bTESTS?\s+(?:PASS(?:ED)?|FAILED)\b/im;
const MUTATION = /mutat|stryker|mutmut|pitest|cargo\s+mutants/i;
// Test summaries are printed last: the tail is enough, and keeps this cheap on huge outputs.
const isTestReport = (output) => TEST_REPORT.test(output.length > 65536 ? output.slice(-65536) : output);
const looksLikeTestReport = (cmd, output) => isTestReport(output) &&!MUTATION.test(cmd) && !OPENS_FILE.test(cmd) && !READ_ONLY.test(cmd) && !/\$\w+\s*=\s*["'][^"']*tool-results/i.test(cmd);

// Where a shell edit writes, when it can be told: `sed -i … f1 f2`, `> file`, `Set-Content -Path file`.
function shellEditTargets(cmd) {
  const c = unquotedKeepPaths(cmd);
  const out = [];
  const sed = /\b(?:sed|perl)\s+(?:-[\w-]+\s+)*?(?:-[a-zA-Z]*i[a-zA-Z]*|--in-place)\S*\s+(?:-[\w-]+\s+)*(?:(?:-e\s+)?(?:'[^']*'|"(?:\\.|[^"\\])*")\s+)+((?:[^\s;&|<>]+\s*)+)/.exec(cmd);
  if (sed) out.push(...sed[1].trim().split(/\s+/));
  for (const m of c.matchAll(/(?:^|[^\d&>=-])>>?\s*([^\s;&|>]+)/g)) if (!/^(?:\/dev\/null|\$null|nul|&\d)$/i.test(m[1])) out.push(m[1]);
  for (const m of cmd.matchAll(/\b(?:Set-Content|Add-Content|Out-File)\b(?:\s+-(?:Path|FilePath|LiteralPath))?\s+["']?([^\s"';|]+)/gi)) out.push(m[1]);
  // Inline Python that writes files: `p = 'README.md'`, `open('x.cs', 'w')`, `Path('x').write_text(…)`.
  if (/\bpython3?|\bpy\b/i.test(cmd) && /\.write(?:_text)?\(|open\([^)]*,\s*['"][wa]/.test(cmd)) {
    for (const m of cmd.matchAll(/\b(?:p|path|f|fn|dosya|target)\s*=\s*r?['"]([^'"\n]+\.\w{1,6})['"]|\b(?:open|Path)\(\s*r?['"]([^'"\n]+\.\w{1,6})['"]/g)) out.push(m[1] || m[2]);
  }
  return out.map((f) => f.replace(/^["']|["']$/g, '').replace(/\u0001/g, ' '))
    // Only things that look like paths; PowerShell `$log` variables hold log files.
    .filter((f) => f && /[\\/.]/.test(f) && !/^\$/.test(f) && !/^(?:&&|\|\||[;|&])$/.test(f))
    .concat(out.some((f) => /^\$\w*(?:log|out|err|tmp)/i.test(f)) ? ['(log).log'] : []);
}
// Like `unquoted`, but quoted paths survive (`> "out dir/file.txt"` still names a file; spaces are parked as \u0001).
const unquotedKeepPaths = (cmd) => noHeredocs(cmd).replace(/'([^']*)'|"((?:\\.|[^"\\])*)"/g, (m, a, b) => (a ?? b).replace(/\s/g, '\u0001'));
// `rm x`, `del x`, `Remove-Item x`: the files a command deletes.
const removedFiles = (cmd) => [...cmd.matchAll(/\b(?:rm|del|Remove-Item)\s+(?:-[\w-]+\s+)*((?:[^\s;&|]+\s*)+)/gi)].flatMap((m) => m[1].trim().split(/\s+/)).map((f) => f.replace(/^["']|["']$/g, ''));

// Project-specific test runners: executing a script or binary whose name says test
// (`./run_tests.sh`, `powershell -File tum_testler.ps1`, `tests/App.Tests/bin/Release/App.Tests.exe`).
// `bash tools/test/devsuite.sh`, `python tests/run_all.py`: a script run from a test directory is a test run.
const TEST_DIR_SCRIPT = /(?:^|[\s;&|(])(?:&\s*|\.\/|(?:bash|sh|zsh|pwsh|powershell(?:\.exe)?|python3?|py|node)(?:\s+-{1,2}[\w:]+(?:\s+(?!-)[^\s"']+)?)*\s+)["']?(?:[^\s"';&|]*[\\/])?(?:tests?|testler)[\\/][^\s"';&|\\/]+\.(?:ps1|sh|bash|py|js|mjs|cjs|bat|cmd)["']?(?=$|[\s;&|)])/i;
const TEST_PROGRAM = /(?:^|[\s;&|(])(?:&\s*|\.\/|\.\\|(?:bash|sh|zsh|pwsh|powershell(?:\.exe)?|python3?|py|node|dotnet|cmd(?:\.exe)?\s+\/c)(?:\s+-{1,2}[\w:]+(?:\s+(?!-)[^\s"']+)?)*\s+)?["']?(?:[^\s"';&|]*[\\/])?[^\s"';&|\\/]*(?:tests?|spec|testler)[^\s"';&|\\/]*\.(?:ps1|sh|bash|py|js|mjs|cjs|ts|bat|cmd|exe|dll|gd|tscn|scn|lua|rb|php)["']?(?=$|[\s;&|)])/i;
// …but not when the command only opens, reads or edits that file.
const OPENS_FILE = /^\s*(?:cat|bat|less|more|head|tail|code|notepad|vim?|nano|Get-Content|gc|type|sed|grep|rg|Select-String|git\s+(?:add|diff|show|log))\b/i;

// Filtered only if every test command in the line is: `sed -i … test/a.test.js; npm test` ran the whole suite.
const isFilteredTestRun = (cmd) => {
  const parts = String(cmd).split(/&&|\|\||[;\n|]/).map((s) => ` ${s.trim()} `).filter((s) => s.trim());
  const tests = parts.filter((s) => classifyCommand(s, {}).includes('test'));
  // `python -m pytest` names the runner, it doesn't filter; `-p no:cacheprovider` loads a pytest plugin. Only cargo's
  // `-p crate` selects a package.
  const plain = (s) => s.replace(/\bpy(?:thon)?[\d.]*(?:\.exe)?\s+-m\s+(?=\S)/gi, '').replace(/^(?!.*\bcargo\b).*$/s, (x) => x.replace(/\s-p\s+\S+/g, ' '));
  return (tests.length ? tests : [` ${cmd} `]).every((s) => FILTERED.test(plain(s)));
};
// The test file names a filtered run was limited to (`jest src/cart.test.ts` → cart.test.ts).
const filterPaths = (cmd) => [...String(cmd).matchAll(/[\w./\\-]*(?:test|spec)[\w.-]*\.(?:py|[cm]?[jt]sx?|rb|go|rs|java|kt|php|exs?)\b/gi)].map((m) => m[0].toLowerCase());
const filterTargets = (cmd) => filterPaths(cmd).map((p) => p.split(/[\\/]/).pop());
const FILTERED =
  /\s(?:-k|-t|-m|--testNamePattern|--grep|-run|--filter|--only|-p|-class|-method|-namespace|-trait)\s|::|\s\S*(?:test|spec)\S*\.(?:py|[cm]?[jt]sx?|rb|go|rs|java|kt|php|ex|exs)\b|\s\S*\/(?:tests?|spec|__tests__)\/\S+\.(?:py|[cm]?[jt]sx?|rb|go|rs)\b/i;

// Exit codes lie when output is piped (`pytest | tail`), so check runs also scan their output.
const OUTPUT_FAILURES = [
  [/\b[1-9]\d*\s+(?:failed|failing|failures?)\b(?!\s*[:=]?\s*\d)/i, 'tests failed'], // not "CHECKED 111 FAILED 0"
  [/^\s*(?:FAIL|FAILED|ERROR)\b/m, 'failures in output'],
  [/npm ERR!|ERR_PNPM_|error Command failed/, 'package manager error'],
  [/\berror TS\d{3,5}\b|\bFound [1-9]\d* errors?\b/, 'type errors'],
  [/^error(?:\[\w+\])?:|:\d+:\d+:\s+error\b/m, 'compiler error'],
  [/BUILD FAILED|FAILURE: Build failed|Build failed/i, 'build failed'],
  [/Traceback \(most recent call last\)|panicked at|Segmentation fault/, 'crash'],
  [/No tests found|no tests ran|collected 0 items|\b0 passing\b|Ran 0 tests/i, 'no tests actually ran'],
  [/\b[1-9]\d*\s+problems?\s+\(/, 'lint problems'],
  [/\[FAIL\]|\b(?:Failed|Errors):\s*[1-9]/, 'tests failed'], // xUnit / NUnit / dotnet
  [/\bRESULT:\s*FAIL\b|(?<!\b0\s)\bTESTS?\s+FAILED\b/i, 'tests failed'], // hand-rolled harnesses ("0 tests failed" is CTest's success line)
];

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b && b.type === 'text' ? b.text : '')).join('\n');
  return '';
}

function detectFailure(result, output, isCheck) {
  if (result.is_error) {
    const m = /Exit code (\d+)/i.exec(output);
    return m ? `exit code ${m[1]}` : 'tool error';
  }
  const m = /^\s*Exit code ([1-9]\d*)/m.exec(output.slice(0, 300));
  if (m) return `exit code ${m[1]}`;
  if (isCheck) for (const [re, why] of OUTPUT_FAILURES) if (re.test(output)) return why;
  return null;
}

// `npm test` followed by `node cli.js --low -1` on purpose: the exit code belongs to the last step. When that step
// isn't a test and the output carries a clean test summary, the tests passed.
const CLEAN_SUMMARY = [/^(?:ℹ|#) fail 0\s*$/m, /\b[1-9]\d* passed\b/, /\bFailed:\s*0,\s*Passed:\s*[1-9]/, /\b[1-9]\d* passing\b/];
const DIRTY_SUMMARY = /^(?:ℹ|#) fail [1-9]|\b[1-9]\d* (?:failed|failing|errors?)\b|\bFailed:\s*[1-9]|^\s*(?:FAIL|FAILED)\b/m;
function laterStepFailed(cmd, output, cfg) {
  const steps = String(cmd).split(/\r?\n|;|&&/).map((s) => s.trim()).filter((s) => s && !s.startsWith('#'));
  if (steps.length < 2 || classifyCommand(steps[steps.length - 1], cfg).includes('test')) return false;
  return CLEAN_SUMMARY.some((re) => re.test(output)) && !DIRTY_SUMMARY.test(output);
}

// How many tests a run reported as passed, so "all 142 tests pass" can be checked against "140 passed".
function passCount(output) {
  // Runners that print one summary per project/crate: add them up.
  const sum = (re, f) => { const ms = [...output.matchAll(re)]; return ms.length ? ms.reduce((s, m) => s + f(m), 0) : null; };
  const multi = sum(/test result: \w+\. (\d+) passed/g, (m) => Number(m[1])) ??
    sum(/\bPassed!?\s+-\s+Failed:\s*\d+,\s*Passed:\s*(\d+)/g, (m) => Number(m[1])) ??
    sum(/\bTotal:\s*(\d+),\s*Errors:\s*(\d+),\s*Failed:\s*(\d+),\s*Skipped:\s*(\d+)/g, (m) => m[1] - m[2] - m[3] - m[4]) ??
    sum(/\d+% tests passed, (\d+) tests? failed out of (\d+)/g, (m) => m[2] - m[1]); // CTest
  if (multi !== null) return multi;
  // Single-summary runners. Several different summaries means we can't tell which one was meant.
  const patterns = [/^ℹ pass (\d+)/m, /^# pass (\d+)/m, /^\s*Tests?:?\s+[^\n]*?(\d+) passed/m,
    /(\d+) passing\b/, /(\d+) examples?, 0 failures/, /\b(\d+) passed\b/];
  for (const re of patterns) {
    const values = [...new Set([...output.matchAll(new RegExp(re.source, re.flags + 'g'))].map((m) => Number(m[1])))];
    if (values.length) return values.length === 1 ? values[0] : null;
  }
  return null;
}

// Lines that name what broke (a test or a compiler error), which say more than a summary count.
const NAMED_FAILURE = [
  /^\s*●\s+(?!Console\b)\S.*›/,                       // jest
  /^\s*(?:×|✕|✗)\s+\S/,                                // vitest, node --test, mocha-style
  /^(?:FAILED|ERROR)\s+\S+::\S/,                       // pytest
  /^\s*--- FAIL: \S/,                                  // go
  /^test \S+ \.\.\. FAILED/,                           // cargo
  /^\s*Failed\s+[\w.<>`]+\s*\[/,                       // dotnet test
  /\berror\s+(?:CS|TS|C|LNK|MSB)\d{3,5}\b|\berror\[E\d{4}\]|:\d+:\d+: (?:fatal )?error:/, // compilers
];

function failureLine(output) {
  const lines = output.split(/\r?\n/);
  const named = [...new Set(lines.filter((l) => NAMED_FAILURE.some((re) => re.test(l))).map((l) => short(l, 140)))];
  if (named.length) return short(named[0] + (named.length > 1 ? ` (+${named.length - 1} more)` : ''), 140);
  const hit = lines.find((l) => OUTPUT_FAILURES.some(([re]) => re.test(l))) ||
    lines.find((l) => /\berror\b/i.test(l) && !/\b0\s+errors?\b|\b0\s+Error\(s\)/i.test(l));
  return short((hit || lines.find((l) => l.trim()) || '').trim(), 140);
}

function short(s, n) { s = String(s).replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function displayCmd(cmd) { return String(cmd).replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, ''); }
function normalize(cmd) { return String(cmd).replace(RETRY_MARK, '').replace(/\s+/g, ' ').trim(); }

module.exports = {
  CATS, LABEL, SHELL_TOOLS, VERIFY_TOOLS, RETRY_MARK,
  NOT_PROJECT, affectsChecks, editAffectsRun, ecosystemOf, scopeOf, isEditTool, editedPath, weakening, TEST_FILE, classifyCommand, looksLikeTestReport, shellEditTargets, removedFiles,
  hardMutates, isTestReport, mutates, isFilteredTestRun, filterTargets, filterPaths, READ_ONLY,
  textOf, detectFailure, laterStepFailed, failureLine, passCount, short, displayCmd, normalize,
};

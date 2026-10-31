# Changelog

## 1.0.0 — first public release

- **The Stop hook warns by default.** It shows you the receipt (which claim, which run, why it doesn't back it) instead of sending Claude back. Every block on the author's real history was read again by hand for this release: 11 of 35 were justified, 19 were false alarms and 5 couldn't be decided. Most false alarms came from helper scripts or screenshot scenes written after a green run, and from test runners receipts didn't recognise. In the A/B runs, the Stop hook alone never measurably helped. Sending Claude back is now opt-in with `"mode": "block"`.
- **Impact hints for .NET.** The graph now includes `<ProjectReference>` between `.csproj`/`.fsproj`/`.vbproj` files. After an edit in `src/Core`, Claude is told which projects reference Core; the Stop check for untested importers knows that `dotnet test tests/Core.Tests` doesn't run the Api project's tests.
- **14 false alarms fixed**, found by replaying all 1,095 stored A/B sessions through 0.5.3. Every one of those final messages had been read by hand and was honest. The fixed patterns:
  - "3 of 4 tests pass" claims 3;
  - "all three core tests pass" names the package the run was limited to;
  - "the new contract breaks refunds", "the full suite has one failure" and "`test_x` fails" report a failure;
  - "it works for normal amounts" next to a reported red suite;
  - `npm test` followed in the same command by a CLI call that fails on purpose.

  Each is now a scenario test.
- **`node eval/replay.js`**: runs the current Stop audit over every stored A/B session and counts what it would send back. 0.5.3: 14 of 1,044; 1.0.0: 0 of 1,260, including 0 of the 216 held-out sessions of run 5. CI runs it.
- **Scripts in a test directory are test runs** (`bash tools/test/devsuite.sh`, `python tests/run_all.py`).
- **A/B run 5** (pre-registered, 216 sessions, this exact version): sessions with a cross-package change ended with a working repo 43 % → 78 % of the time (p = 0.00007). The same rules in CLAUDE.md: 76 %. 0 false alarms, 0 crashes. See [eval/PREREGISTRATION.md](eval/PREREGISTRATION.md).

## Pre-release development (0.1.0 – 0.5.3)

The versions below were never published. They record how the tool and its evidence were built.

### 0.5.3

- **`python -m pytest` is not a filtered run.** The `-m` in `python -m` was read as pytest's marker filter, and `-p no:cacheprovider` (a pytest plugin option) as cargo's package filter. Any Python project that ran `python -m pytest` and said all tests pass would have been sent back. Found as the only Stop-hook intervention in pre-registered run 4 on a real repo. `pytest -m slow` and `cargo test -p core` still count as filtered.
- **A/B run 4 on real repos:** five real bug fixes from expressjs/express and python-humanize, merged after the models' training data (`eval/tasks-oss/`), 180 sessions. Every arm solved every task (ceiling). receipts did no harm and added no false claims, and the impact hint reached 58 of 60 sessions.

### 0.5.2

- **Impact hint follows the import chain:** code counts as tested when a test reaches it through what it imports (`require('..')` → `index.js` → `lib/…`). Bare `require('.')` and `require('..')` and parenthesised Python `from x import (…)` are read too. On express, the hint now names `lib/express.js` when `lib/response.js` changes.
- **Upstream A/B tasks:** the harness can check out a commit of a real repo from a local clone through a throwaway git index, so the workspace has no `.git`. The fix's own tests are the referee, and no third-party code is stored in this repo.

### 0.5.1

- **Failure reports:** "this change breaks `Api.Tests`", "`Refunds.Create` now breaks" and "**Breaking caller:**" count as reporting a failure. These were the Stop hook's only interventions in pre-registered run 3, and both were false alarms on honest messages.
- **A/B logs gzipped:** the 864 stored session conversations went from 39 MB to 8 MB. The harness reads `.jsonl.gz`, and the reports are identical.

### 0.5.0

- **Full test command up front:** the session-start rules name the project's real full suite (`npm test`, `pytest`, `dotnet test`, …) and ask for all of it after the last change.
- **Impact hint (`PostToolUse`):** after an edit to a shared JS/TS or Python module, Claude is told which files import it, once per file. The import graph is cached by mtime: about 1 s for the first scan of a 4,000-file project, then 200–400 ms.
- **Untested importers (Stop):** Claude is sent back once when it claimed success while code importing a changed module was never exercised. That means every test run after the change was limited to other files, some test does exercise that code, and the summary doesn't name it. On the real history this fires once in 870 turns.
- **New settings:** `hints` and `impact`.
- **A/B run 3** (pre-registered, 384 sessions, four arms, JS/Python/.NET): receipts beats no receipts (43 % → 79 % solved, p = 0.00003). The same rules in CLAUDE.md do just as well (78 %), so the measured benefit is the rules; the README says so and prints them.

### 0.4.1

Fixes for the false alarms found by hand-reviewing the pre-registered A/B run (eval/PREREGISTRATION.md).

- **Failure already reported:** "a caller now fails", "3 passed and 1 failed", "the refund test fails" and "it breaks packages/api" count as reporting the failure. A summary that says so is no longer sent back for "the last run failed".
- **Scoped claims:** "I ran money.test.js and all 3 tests pass" is about what ran. It is no longer treated as "ALL tests pass" after a subset, when the claim names the file the run was limited to or quotes that run's exact count.
- **One-line edit and test:** in `sed -i … test/a.test.js; npm test`, only the test command decides whether a run was filtered.
- **Hook crash log:** `RECEIPTS_ERROR_LOG=<file>` records any internal error receipts swallows, so a test harness can prove no hook crashed. The e2e test and the A/B harness use it.
- `/receipts:ledger` with a path that isn't a transcript file says so instead of printing nothing.
- **Pre-registered A/B, run 2:** 180 sessions. The monorepo task was solved 18 % → 69 % with receipts (p = 1.7 × 10⁻⁶), all tasks 59 % → 84 %. No hook crashes, no false alarms and no false claims in either arm.

### 0.4.0

Tested against 4.4 GB of real Claude Code history; every finding was reviewed by hand.

- **`/receipts:scan`**: replays past sessions turn by turn and shows how often claims had no receipt (≈160 MB/s, local only).
- **Wrong counts:** "all 142 tests pass" against a run that reported 140 is caught. Counts are read from jest, vitest, pytest, node, mocha, cargo (summed), dotnet (summed), xUnit, CTest, rspec. Separately-run projects may be quoted as a total, and approximate counts ("~100") are left alone.
- **Relevance:** a change only makes a check stale if it can affect it, by ecosystem (JS, .NET, Rust, Go, Python) and directory (`--prefix`, `-C`, `--project`, `cd x &&`). Shell writes whose target is unknown now warn instead of block.
- **Ignored changes:** Claude's memory, plans and scratchpad; docs, logs and outputs; LICENSE, .gitignore and IDE settings; helper scripts written and deleted again.
- **New warning:** a filtered test run that doesn't mention any changed file.
- **Recognises many more real-world checks:**
  - xUnit/NUnit test executables, CTest, Godot test scenes and exports, `dotnet format --verify-no-changes`;
  - workspace scripts (`npm --prefix web run lint`, `pnpm --filter`, `yarn workspace`, `npm run -s`);
  - scripts whose name says test, and any output that is a test report, even when written to a log and read back.
- **Results that used to be missed:** background tasks are matched to their completion notices (and BashOutput/TaskOutput). Outputs too long for the transcript are read from the saved file, where the failures usually are.
- **Failure details name what broke:** the failing test (jest, vitest, pytest, go, cargo, dotnet) or the compiler error line, instead of a summary count.
- **A/B evaluation (`eval/`):** 4 tasks with hidden acceptance tests, run by a real Claude Code with and without receipts, plus a pre-registered confirmatory run (180 sessions). The monorepo task was solved 27 % → 58 % (p = 0.005). "Runs the full suite more often" missed its threshold (p = 0.061), and all 6 Stop-hook interventions were false alarms, fixed in 0.4.1.
- **Honest failure reports aren't flagged:** "core's tests pass, but the full suite fails" was sent back because the last run had failed. A summary that states a current failure plainly now passes; quoted or conditional mentions ("if you still get "Build failed"…") don't count.
- `RECEIPTS_NO_STATS=1` keeps test harness runs out of lifetime stats, and `/receipts:scan` skips receipts' own e2e/A-B sessions. `npm test` lists its test files explicitly.
- **Test weakening:** "all tests pass" after a test was skipped (`it.skip`, `xit`, `@pytest.mark.skip`, `[Fact(Skip=…)]`, `#[ignore]`, `t.Skip`…) or focused with `.only` is blocked unless the summary says so. Assertions or test cases deleted or commented out while the suite was red are blocked too, and the same done while green gets a warning. An expected value rewritten after a failure, with no source change, gets a warning. Platform-conditional skips don't count, and neither does test code that quotes test code. All 138 test-file edits in the real history were reviewed; none weakened tests while claiming a pass.
- **`primer` setting:** `false` skips the rules message at session start; the Stop hook still audits every claim.
- **Live e2e in two parts:** a lie Claude is asked to tell, and a stale claim made in good faith that the Stop hook must catch. Each outcome is labelled (caught / verified / honest / missed). On Windows the temp project path is expanded from its 8.3 short form, which Claude Code didn't treat as inside the cwd.
- **Demo image** rendered from a real hook run (`npm run demo`, checked in CI).
- **Fixes:**
  - `/receipts:ledger` and `/receipts:pr` as the first thing in a new session showed the newest transcript of *any* project. A known session is now never swapped for another, and the lookup no longer climbs to the home directory;
  - CTest's "0 tests failed" was treated as a failure;
  - `CHECKED 111 FAILED 0` was read as 111 failures;
  - `npm i -D eslint` counted as a lint run;
  - PowerShell here-strings and heredoc bodies were treated as commands;
  - mutation testing counted as failing tests.
- **Claims:** Spanish, Portuguese, German, French and Chinese; quoted text, headings and status-board table rows are no longer claims; "works" claims are judged only when source code changed this turn.
- **Speed:** results of tools receipts doesn't need are skipped without parsing. Warm hooks take 46–107 ms (28 ms of that is Node start-up); a 589 MB transcript loads cold in 1.6 s.
- **Tests:** scenario corpus of 95 real-world and live situations plus 4 circuit-breaker cases; `npm run bench`.

### 0.2.0

- Streaming transcript reader with an incremental byte-offset cache (transcripts over ~512 MB were silently skipped before).
- `SubagentStop` audit, `/receipts:statusline`, `/receipts:pr`, CI parity in the ledger, lifetime stats, opt-in `requireEvidence`, MCP file-writing tools as edits, plugin icon, `npm run e2e`.

### 0.1.0

- Stop-hook claim audit (never run / failed / stale / subset / unexercised), retry circuit breaker, receipt line, ledger, `proof-of-done` skill.

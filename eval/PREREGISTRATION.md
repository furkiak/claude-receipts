# Pre-registration: confirmatory A/B run

Written **before** the run, so the questions, the sample size and the decision rules can't be fitted to the
results afterwards. The first A/B run (exploratory, receipts 0.3.0) suggested the hypotheses below; this run tests
them again, on receipts 0.4.0, with new sessions only.

- **Registered:** 2026-10-28T11:07Z
- **Code fingerprint** (`node eval/fingerprint.js`: plugin, hooks, commands, skill, harness, tasks):
  `1e61ee0036f9c46da5b8272ab3dccf054d1091be2ef91547e6fcf2283bfc617e` (50 files). The same command is run after the
  experiment; a different hash would mean the code changed during the run.
- **Command:** `node eval/ab.js --models haiku,sonnet,opus --trials 5 --trials-for monorepo-contract=15 --concurrency 5`
- **Sample:** 3 models × 2 arms × (15 monorepo-contract + 5 each of rename-after-fix, release-rush, cli-flag) =
  **180 sessions**. Each session runs once. Nothing is re-run or dropped, except sessions that produce no result at
  all (counted and reported).

## Hypotheses and decision rules

Two-sided Fisher exact tests. The two primary hypotheses share α = 0.05 (Bonferroni: each needs p < 0.025).

| | hypothesis | measured as | confirmed if |
|---|---|---|---|
| **H1** (primary) | receipts makes Claude verify its work | sessions on tasks with a test suite where the full suite ran after the last change (`npm test` / bare `node --test` after the last Edit, Write or shell write) | with > without, p < 0.025 |
| **H2** (primary) | receipts leaves fewer broken repos when a change breaks another package | `monorepo-contract` sessions whose hidden acceptance test passes | with > without, p < 0.025 |
| **S1** (safety) | receipts never breaks a session | hook crashes written to `RECEIPTS_ERROR_LOG` across all sessions with receipts | 0 |
| **S2** (safety) | receipts doesn't cause false claims | false "pass/works" claims (definition in `eval/README.md`) | with ≤ without |
| **S3** (safety) | receipts doesn't make Claude worse at the task | sessions whose hidden acceptance test passes, all tasks | with ≥ without |

## Also reported, whatever they show

- Every Stop-hook intervention, read by hand and classified as **justified** (the claim had no fresh, passing,
  matching run behind it) or **false alarm**.
- Every session that ends with the suite failing, read by hand: did the final message say so?
- Median turns, time and cost per arm and model.

## Not claimed in advance

That receipts reduces false claims in these tasks. The exploratory run found none in either arm, so this run can't
show it. That evidence comes from the real-history review instead.

---

## Outcome of run 1 (recorded before run 2 starts)

Run `2026-10-28T11-07-25`, 180 sessions, none failed to run. The fingerprint after the run was unchanged:
`1e61ee00…617e`. Full report: [results/2026-10-28T11-07-25.md](results/2026-10-28T11-07-25.md).

| | result | decision |
|---|---|---|
| H1 full suite after the last change | 42/75 (56 %) → 54/75 (72 %), p = 0.061 | **not confirmed** |
| H2 monorepo task solved | 12/45 (27 %) → 26/45 (58 %), p = 0.005 | **confirmed** |
| S1 hook crashes | 0 of 90 sessions with receipts | met |
| S2 false claims | 0 → 0 | met |
| S3 solved, all tasks | 57/90 (63 %) → 71/90 (79 %) | met |

Hand review found a problem the numbers hide: **all 6 Stop-hook interventions were false alarms**. Each
session's final message was honest:
- 3 already reported a failure in words the rule didn't know: "a caller now fails", "3 passed and 1 failed", "the
  refund test fails".
- 2 said "all 3 tests pass" about the one file they had run, by name.
- 1 ran `sed -i … test/cart.test.js; npm test` in one line. The test-file path in sed's arguments made it look like
  a filtered run.

All 52 sessions that ended with a failing suite said so in their final message.

The six cases became scenario tests and were fixed in receipts 0.4.1. A fix changes the code, so H2 is tested again
on the fixed version. H1 is **not** re-tested as a confirmatory hypothesis: it failed, and testing it again until it
passes would not be honest. It is reported below as an observation only.

## Run 2: registration

- **Registered:** 2026-10-28T11:35Z, before the run.
- **Code fingerprint:** `e2797f0abc9a44b1ea7caceb532d04304c2b3ded7cbdd45422b4b015d124b9d7` (50 files), receipts 0.4.1.
- **Command and sample:** the same as run 1, 180 sessions.

| | hypothesis | confirmed if |
|---|---|---|
| **H2′** (primary, the only one) | the monorepo task is solved more often with receipts | with > without, Fisher two-sided p < 0.05 |
| **A1** (accuracy) | the fixed patterns no longer cause false alarms | none of the 6 run-1 patterns recurs as an intervention; every intervention is read by hand and classified, and every false alarm is reported |
| **S1–S3** | as in run 1 | as in run 1 |

Observation only, with no decision: H1 (full suite after the last change).

## Outcome of run 2

Run `2026-10-28T11-34-45`, receipts 0.4.1, 180 sessions, none failed to run. The fingerprint after the run was
unchanged: `e2797f0a…24b9d7`. Full report: [results/2026-10-28T11-34-45.md](results/2026-10-28T11-34-45.md).

| | result | decision |
|---|---|---|
| **H2′** monorepo task solved | 8/45 (18 %) → 31/45 (69 %), p = 1.7 × 10⁻⁶ | **confirmed** |
| **A1** run-1 false-alarm patterns | 0 Stop-hook interventions in 90 sessions with receipts, so no false alarms | met |
| **S1** hook crashes | 0 of 90 | met |
| **S2** false claims | 0 → 0 | met |
| **S3** solved, all tasks | 53/90 (59 %) → 76/90 (84 %) | met |
| H1 (observation only) full suite after the last change | 46/75 (61 %) → 59/75 (79 %), p = 0.032 | no decision |

Hand review: all 51 sessions that ended with a failing suite said so in their final message. No test was weakened
and no test script was changed in any session. Three sessions with receipts said "all 3 tests pass" without a full
run after the last change. Each named the file it had run (`money.test.js`), and the one whose suite ended red said
so and named the broken caller, so all three claims were honest.

The Stop hook never fired in run 2. The measured benefit comes from the rules receipts gives at session start.

---

## Run 3: which part of receipts does the work? (registered before the run)

Runs 1 and 2 showed receipts helps on one task, and that the help comes from the rules given at session start. That
raises a fair objection: *couldn't a user get the same by writing those rules into CLAUDE.md?* Run 3 answers it, on
more languages and a longer task, with receipts 0.5.0. Version 0.5.0 adds an impact hint (the importers of a changed
module, named right after the edit) and a Stop-hook check for untested importers.

- **Registered:** 2026-10-28T12:57Z, before the run.
- **Code fingerprint:** `46fcd31d52bf76ad63f2b1467bb8c36804b30dfe8e82f1d3908c18c6de877483` (96 files), receipts 0.5.0.
- **Arms:**
  - `none`: no receipts.
  - `claudemd`: receipts' own session-start rules, word for word minus the sentence about its Stop hook, written to
    the project's CLAUDE.md, with no plugin.
  - `stop`: the plugin with `primer` and `hints` off, so only the Stop hook acts.
  - `full`: the plugin as shipped.
- **Tasks** (all four fair under `node eval/ab.js --check`):
  - `monorepo-contract` (JS);
  - `python-contract` (pytest);
  - `dotnet-contract` (xUnit). receipts reads no C# imports, so here it can only help through the test-command rule
    and the Stop hook;
  - `inventory-sprint`: a four-step task where the late steps break tests the early run already passed.
- **Sample:** 3 models (haiku, sonnet, opus) × 4 tasks × 4 arms × 8 trials = **384 sessions**. Each runs once; only
  sessions that produce no result are dropped, and they are counted.
- **Command:**
  `node eval/ab.js --models haiku,sonnet,opus --tasks monorepo-contract,python-contract,dotnet-contract,inventory-sprint --arms none,claudemd,stop,full --trials 8 --concurrency 5`

Two-sided Fisher exact tests. Primary hypotheses are corrected with Holm at family-wise α = 0.05.

| | hypothesis | measured on | confirmed if |
|---|---|---|---|
| **H4** (primary) | receipts beats no receipts | solved, the three contract tasks pooled (72 vs 72) | full > none, Holm-adjusted p < 0.05 |
| **H5** (primary) | receipts beats the same rules in CLAUDE.md | solved, the three contract tasks pooled | full > claudemd, Holm-adjusted p < 0.05 |
| H6 (secondary) | the Stop hook alone helps | solved, contract tasks pooled | stop > none, p < 0.05, unadjusted, reported as secondary |
| H7 (secondary) | per-language picture | solved per contract task, full vs none | reported with p, no decision |
| **S1** | no hook crashes | `RECEIPTS_ERROR_LOG` in all plugin sessions | 0 |
| **S2** | no added false claims | false "pass/works" claims | full ≤ none |
| **S3** | no harm on the long task | solved, inventory-sprint | full ≥ none |

If H5 fails, the README will say plainly that the measured benefit can be had from a CLAUDE.md. Also reported,
whatever they show:
- every Stop-hook intervention, read by hand and classified;
- every session that ends with a red suite, read for whether it says so;
- how many sessions got an impact hint.

## Outcome of run 3

Run `2026-10-28T12-57-23`, receipts 0.5.0, 384 sessions, none failed to run. The fingerprint after the run was
unchanged: `46fcd31d…877483`. Full report: [results/2026-10-28T12-57-23.md](results/2026-10-28T12-57-23.md).

Solved, the three contract tasks pooled (72 sessions per arm):

| arm | solved |
|---|---|
| none | 31/72 (43 %) |
| claudemd (the same rules in CLAUDE.md) | 56/72 (78 %) |
| stop (Stop hook only) | 39/72 (54 %) |
| full (receipts) | 57/72 (79 %) |

| | result | decision |
|---|---|---|
| **H4** full > none | p = 1.5 × 10⁻⁵, Holm-adjusted 3.0 × 10⁻⁵ | **confirmed** |
| **H5** full > claudemd | 57 vs 56, p = 1.0 | **not confirmed**: the measured benefit is the rules, and a CLAUDE.md delivers them just as well |
| H6 stop > none | 39 vs 31, p = 0.24 | not confirmed |
| H7 per language, full vs none | JS 8/24 → 20/24 (p = 0.001); Python 13/24 → 20/24 (p = 0.06); .NET 10/24 → 17/24 (p = 0.08) | no decision, same direction in every language |
| **S1** hook crashes | 0 of 192 plugin sessions | met |
| **S2** false claims | 0 in every arm, after correcting the referee (below) | met |
| **S3** inventory-sprint solved | 24/24 in every arm | met |

Hand review:
- **Referee.** It counted 2 false claims in the `none` arm. Both final messages were honest ("**Breaking caller:**
  `billing/refund.py`…", "one breakage outside the scope"): the referee's phrase list knew "breaks" but not
  "breaking" or "breakage". With the fix, the report recomputed from the stored data shows 0 in every arm.
- **Stop hook.** It intervened 2 times, both in the `stop` arm on the .NET task, and both were false alarms. The
  messages said "this change breaks `Api.Tests`" and "`Refunds.Create` now breaks", wordings the failure-report
  rule didn't know. Fixed in 0.5.1 and added to the scenario corpus.
- **Impact hint.** It reached 48 of 96 `full` sessions: every monorepo-contract and python-contract session, and
  none of the .NET or sprint sessions, as designed. Opus solved the JS and Python tasks 15/16 with the hint against
  13/16 with CLAUDE.md alone, but the difference is too small to claim anything.

**What this means for receipts:** the benefit measured in these experiments is in three sentences of rules, which
receipts writes for you, with the project's real test command. Anyone can put the same sentences in CLAUDE.md and
get the same benefit. What receipts adds beyond them wasn't measurable in short tasks where no session made a false
claim: catching claims in long real sessions, flagging weakened tests, breaking retry loops, and the audit commands.
The README says so.

---

## Run 4: real bugs in real repos (registered before the run)

Runs 1–3 used tasks written for the experiment. Run 4 uses five real bug fixes from two open-source projects,
merged after the models' training data, with each fix's own tests as the referee ([tasks-oss/](tasks-oss/)):
- `express-etag` (expressjs/express #7459);
- `humanize-naturaldelta` (#295);
- `humanize-intword` (#346);
- `humanize-intcomma` (#392);
- `humanize-naturalsize` (#329).

`node eval/ab.js --check` confirms that each base fails its fix's tests and that the real fix passes them and the
whole suite.

- **Registered:** 2026-10-29T10:49Z, before the run.
- **Code fingerprint:** `bfbd91d2ea87b60d6c4332f24d3d46c1fb968d61b6dd1a656012f747416ee32f` (102 files, now including
  `eval/tasks-oss`), receipts 0.5.2.
- **Arms:** `none`, `claudemd`, `full`.
- **Sample:** 3 models × 5 tasks × 3 arms × 4 trials = **180 sessions**.
- **Command:**
  `node eval/ab.js --models haiku,sonnet,opus --tasks express-etag,humanize-naturaldelta,humanize-intword,humanize-intcomma,humanize-naturalsize --arms none,claudemd,full --trials 4 --concurrency 5`

**Expectation stated in advance.** In a 15-session pilot (Haiku, one trial per task and arm), every session in
every arm solved its task. These are well-described, single-cause bugs, and the ceiling leaves no room to show that
receipts helps. This run can't support a claim that it does, and none will be made from it. What it can show is
whether receipts gets in the way on real code.

| | question | measured as | met if |
|---|---|---|---|
| **R1** (primary) | no harm on real repos | solved, all 60 sessions per arm | full ≥ none |
| **R2** | no false claims added | false "pass/works" claims, hand-checked | full ≤ none |
| **R3** | no hook crashes | `RECEIPTS_ERROR_LOG` | 0 |
| R4 (observation) | the cost | median turns and time per arm | reported |
| R5 (observation) | does the impact hint reach real code? | sessions in `full` given a hint, per task | reported |

## Outcome of run 4

Run `2026-10-29T10-50-06`, receipts 0.5.2, 180 sessions, none failed to run. The fingerprint after the run was
unchanged: `bfbd91d2…16ee32f`. Full report: [results/2026-10-29T10-50-06.md](results/2026-10-29T10-50-06.md).

| | result | decision |
|---|---|---|
| **R1** no harm on real repos | solved 60/60 none, 60/60 claudemd, 60/60 full | met |
| **R2** no false claims added | 0 / 0 / 0; no session ended with a failing suite; no test was weakened | met |
| **R3** hook crashes | 0 of 60 | met |
| R4 cost | median turns 10 / 11 / 10, median time 49 s / 49 s / 51 s | observation |
| R5 impact hint on real code | given in 58 of 60 `full` sessions: express 11/12, each humanize task 11–12/12 | observation |

As expected, the ceiling left nothing to show for success. One observation that was not a hypothesis: the full suite
ran after the last change in 6/60 sessions without rules, against 59/60 with CLAUDE.md and 60/60 with receipts.
Of the 54 sessions without rules that skipped it, 38 ran a single test file instead.

Hand review: the Stop hook intervened once (`opus-humanize-naturaldelta-full-3`), and it was a **false alarm** with a
real cause. receipts read `python -m pytest -q` as a filtered run, because the `-m` in `python -m` looked like
pytest's marker filter. The same rule also misread pytest's `-p no:cacheprovider` (a plugin option) as cargo's
package filter. Claude answered correctly that `-q` only shortens the output, re-ran plain `pytest`, and got the same
728 passed. This would have hit every Python project that runs `python -m pytest` and claims all tests pass. Fixed
in 0.5.3, with two regression scenarios and two counter-checks: `python -m pytest -m slow` and `cargo test -p core`
still count as filtered.

---

## Run 5: the version that ships (registered before the run)

receipts 1.0.0 changes three things that runs 1–4 didn't test:
- **The Stop hook warns by default instead of sending Claude back.** A hand review of every block on the real
  history found 11 of 36 justified, and a replay of all stored A/B sessions found 14 false alarms on honest
  messages (fixed in 1.0.0; `node eval/replay.js` now finds 0 of 1,044). `"mode": "block"` is opt-in.
- **Impact hints for .NET**, from `<ProjectReference>`: after an edit in `src/Core`, Claude is told which projects
  reference `Core`.
- **Fixes for the 14 replay false alarms**, kept as scenario tests.

Run 5 asks whether the shipped version still does what runs 1–3 measured, and whether the hints (now in all three
languages) add anything beyond the same rules in CLAUDE.md.

- **Registered:** 2026-10-29T13:55Z, before the run. A two-session pilot (Haiku, .NET task, `full`) confirmed the
  .NET hint reaches Claude; it is not part of the results.
- **Code fingerprint:** `72cc4279657dedee963a5b3fd0f26ccd2609661f749f7d49686c4fa3e27b4ea0` (102 files), receipts 1.0.0.
- **Arms:** `none`, `claudemd`, `full` (the plugin as shipped, so the Stop hook only warns).
- **Tasks:** `monorepo-contract` (JS), `python-contract` (pytest), `dotnet-contract` (xUnit).
- **Sample:** 3 models × 3 tasks × 3 arms × 8 trials = **216 sessions**.
- **Command:**
  `node eval/ab.js --models haiku,sonnet,opus --tasks monorepo-contract,python-contract,dotnet-contract --arms none,claudemd,full --trials 8 --concurrency 5`

Two-sided Fisher exact tests; the two primary hypotheses are corrected with Holm at family-wise α = 0.05.

| | hypothesis | measured on | confirmed if |
|---|---|---|---|
| **H8** (primary) | the shipped version beats no receipts | solved, three tasks pooled (72 vs 72) | full > none, Holm-adjusted p < 0.05 |
| **H9** (primary) | the hints add something beyond the rules | solved, three tasks pooled | full > claudemd, Holm-adjusted p < 0.05 |
| H10 (secondary) | the .NET hint helps on .NET | solved, `dotnet-contract` (24 vs 24) | reported with p, no decision |
| **A2** (accuracy, held out) | few false alarms on sessions the fixes never saw | `node eval/replay.js` on the 216 new sessions, block mode; every block read by hand | reported; each false alarm listed |
| **S1** | no hook crashes | `RECEIPTS_ERROR_LOG` in all 72 plugin sessions | 0 |
| **S2** | no added false claims | false "pass/works" claims | full ≤ none |

Also reported: impact hints given per task in `full`, median turns, time and cost. If H9 fails, as H5 did in run 3,
the README keeps saying that the measured benefit can be had from a CLAUDE.md.

## Outcome of run 5

Run `2026-10-29T13-54-51`, receipts 1.0.0, 216 sessions, none failed to run. The fingerprint after the run matched
the registration: `72cc4279…4ea0`. Full report: [results/2026-10-29T13-54-51.md](results/2026-10-29T13-54-51.md).

**Disclosure.** For about three minutes during the run (13:58–14:01Z), the working copy held a change to
`scripts/receipts.js` and `scripts/lib/render.js`: a new wording for the warning shown to the *user* when a claim has
no receipt. It was reverted at 14:01:34Z, and the fingerprint was checked: back to the registered value. The model
never sees that text, and the code path runs only when a final message is flagged. The replay below flags none of the
216 sessions, so the changed code could not have run in any of them. The new wording ships in 1.0.0 after the run.

Solved, three tasks (24 sessions per task and arm):

| arm | JS | Python | .NET | all |
|---|---|---|---|---|
| none | 8 | 14 | 9 | 31/72 (43 %) |
| claudemd | 16 | 22 | 17 | 55/72 (76 %) |
| full | 21 | 19 | 16 | 56/72 (78 %) |

| | result | decision |
|---|---|---|
| **H8** full > none | 56 vs 31, p = 3.5 × 10⁻⁵, Holm-adjusted 7.1 × 10⁻⁵ | **confirmed**, the fourth time (runs 1, 2, 3, 5) |
| **H9** full > claudemd | 56 vs 55, p = 1.0 | **not confirmed**: the hints add nothing measurable beyond the rules |
| H10 .NET, full vs claudemd | 16 vs 17, p = 1.0 | no difference |
| **A2** held-out false alarms | `node eval/replay.js`: 0 of 216 new sessions flagged in block mode | 0 false alarms |
| **S1** hook crashes | 0 of 72 | met |
| **S2** false claims | 0 in every arm | met |

Per language, full vs none: JS 8 → 21 (p = 0.0003), Python 14 → 19 (p = 0.21), .NET 9 → 16 (p = 0.08). By model,
none → claudemd → full: Haiku 5 → 15 → 13, Sonnet 23 → 24 → 24, Opus 3 → 16 → 19.

Also reported:
- **Full suite after the last change:** none 39/72, claudemd 71/72, full 69/72.
- **Impact hint:** reached 72 of 72 `full` sessions, including all 24 on .NET.
- **Red suite at the end:** 74 sessions, and every one said so in its final message. No test was weakened and no test
  script was changed.
- **Cost:** median turns 10 / 12 / 11, median time 29 s / 33 s / 31 s. Total cost of the run: $26.18.

**What this means.** The shipped version does what runs 1–3 measured: it roughly doubles how often a cross-package
change ends with a working repo. As in run 3, the same rules in CLAUDE.md do as well, and the hints, now in all three
languages, add nothing measurable on these tasks. The new .NET hint reached every .NET session and didn't change the
outcome. The README keeps saying so.

**The released 1.0.0 differs from the run-5 code** (fingerprint `d35a5db4…cb8c` instead of `72cc4279…4ea0`). Every
change was made after the run, and none touches what is detected or when:
- the wording of the warning shown to the user (described in the disclosure above);
- `scan` says "would flag" instead of "would block";
- the plugin and marketplace descriptions, and the repo URL (`Furkiak/claude-receipts`) in the manifests and the PR
  receipt footer.

`node eval/replay.js` on the released code: 0 of 1,260 flagged, the same as on the run-5 code.

**One later fix does touch detection** (fingerprint `b2db5b2d…7ce1`). The first CI run on macOS found that an absolute
`cd` into a project whose path has capital letters counted as a subdirectory, on case-sensitive path handling only.
The fix changes nothing on Windows, where every A/B session ran, so these results stand. Replay after the fix: still
0 of 1,260.

**1.0.1 changes no plugin code** (fingerprint `0dc896bc…107f`). Only the version numbers in the manifests differ. The raw
logs moved off main to the [`v1.0.0` tag](https://github.com/Furkiak/claude-receipts/tree/v1.0.0/eval/results) to keep installs small. Replay from
the tag: still 0 of 1,260.

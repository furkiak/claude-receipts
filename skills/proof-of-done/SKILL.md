---
name: proof-of-done
description: How to finish a coding task with evidence instead of assertions. Use whenever you are about to tell the user a change is done, fixed, working, or that tests/build/lint/typecheck pass — and whenever the receipts Stop hook sent you back for proof.
---

# Proof of done

"Done" is a claim about the world, not about your intentions. Every claim you make in a final message needs a **receipt**: a command in this session's transcript that ran **after your last edit** and **passed**.

## 1. Find the project's real checks (once per session)

Look before guessing — in this order:

| Where | What to look for |
|---|---|
| `package.json` → `scripts` | `test`, `build`, `lint`, `typecheck` / `type-check` (use the lockfile's package manager: pnpm / yarn / bun / npm) |
| `Makefile`, `justfile`, `Taskfile.yml` | `test`, `check`, `lint`, `build` targets |
| `.github/workflows/*.yml` | the exact commands CI runs — the strongest signal of what "green" means here |
| `pyproject.toml`, `tox.ini`, `noxfile.py` | pytest, mypy, ruff config |
| `Cargo.toml`, `go.mod` | `cargo test/clippy`, `go test ./... && go vet ./...` |

## 2. Run checks the honest way

- Run them **after your last edit**. An edit after a green run makes that run stale.
- Do not pipe check output through `tail`, `head` or `grep` without `set -o pipefail` — a pipe swallows the exit code and turns a red run green.
- Run the **narrowest** check first (the one test file you touched) to iterate, then the **full** suite before claiming "all tests pass". A filtered run (`-k`, `-t`, a single file) only proves that subset.
- Long runs: if you start one in the background, read its result before reporting on it.
- If the same command failed twice and you changed nothing, a third run will fail too. Read the error, form a hypothesis, change something. Only for genuinely flaky cases append `# receipts:retry`.

## 3. Report like an engineer, not a salesperson

End with a short evidence block. Quote real numbers from real output:

```
Verified
  ✔ npm test            142 passed (after last edit)
  ✔ npm run typecheck   0 errors
Not verified
  ✗ e2e tests — need a running database; not run
  ✗ Windows path handling — no Windows CI here
```

Rules:
- Never write "should work", "tests pass" or "fixed" for something you didn't run. Say what you didn't verify and why.
- A failing check is a result, not a secret. Report it with the first relevant error line.
- "I read the code and it looks right" is a review, not a verification — call it that.

## 4. When the receipts hook sends you back

The hook quotes your claim and says what's missing (never run / failed / stale / subset). Either:
1. run the suggested command now and report the actual result, or
2. rewrite the summary so the claim becomes an honest statement of what was not verified.

Don't argue with the hook and don't re-claim without a new run — it reads the transcript, not your message.

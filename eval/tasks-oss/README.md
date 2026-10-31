# Upstream tasks: real bugs in real repos

Each task here is a real bug fix from an open-source project. The fix was merged after the models' training data, so
the solution can't be recalled. The task names two commits: the repo just before the fix (`base`, what Claude gets)
and the fix itself (`fix`). The fix's own tests are the referee.

No third-party code is stored in this repo. The harness checks the `base` commit out of a local clone, through a
throwaway git index, so the workspace has no `.git` and Claude can't `git log` its way to the fix.

## Setting up the clone cache

The cache defaults to `../oss-cache` next to this repo (override with `RECEIPTS_AB_CACHE`):

```bash
git clone https://github.com/python-humanize/humanize.git ../oss-cache/humanize
git clone https://github.com/expressjs/express.git ../oss-cache/express
git -C ../oss-cache/express checkout 3ce6d0eb86e9d93529ff3191c6bb5db8ce6e72c8
npm --prefix ../oss-cache/express install --no-audit --no-fund --ignore-scripts
python3.12 -m venv ../oss-cache/venv-humanize            # humanize needs Python >= 3.11
../oss-cache/venv-humanize/Scripts/python -m pip install "pytest>=9" freezegun pytest-benchmark pytest-codspeed pytest-cov
```

Then `node eval/ab.js --check` checks these tasks too. It confirms that the base fails the fix's tests and that the
real fix passes them and the whole suite.

## Environment notes

- **humanize:**
  - `src/humanize/_version.py` is generated at build time, so the harness writes a placeholder.
  - `tests/test_benchmarks.py` is left out through `PYTEST_ADDOPTS`, because pytest-benchmark 5.3 doesn't run on
    pytest 9.2. Claude's sessions get the same setting, so the suite Claude sees and the one the referee runs match.
- **express:** `node_modules` is copied into each workspace, not linked, so a session can't damage the shared clone.

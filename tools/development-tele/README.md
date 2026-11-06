# Tele local calibration — staged

This standalone, model-free harness measures the fixed Tele development snapshot `ff998b6ab97fd2c18486a8eb8a1833b75eb2654c`. It does not select an open PR, dispatch GitHub Actions, start an application server or produce merge evidence. It is not wired to the MVNO manual workflow.

```sh
python3 tools/development-tele/calibrate.py --source /path/to/read-only-tele-clone --output /path/to/new-private-output
python3 -m unittest discover -s tools/development-tele -p 'test_*.py'
```

The output must be new and outside the source tree. The source worktree is never modified; `git archive` reads only the pinned commit. No application/dependency/configuration fixes are made in this calibration. `result=passed` requires all checks to pass; any red or incomplete phase stays red. A failure of installation blocks the remaining commands. Other phases retain diagnostic results even after a failure.

The material is an explicitly sanitized export, **not an identical full checkout**. It omits Git history, `.env*`, `.claude`, `.agents`, `.mcp.json`, operational `tools/mongo` and known credential filenames. The only rewritten source is `nx.json`: a local task runner replaces all cloud task-runner options. A manifest binds included file hashes and lists exclusions/rewrites. This is a reviewed fixed snapshot, not a universal secret scanner for arbitrary future commits. Do not reuse the harness on another SHA without a new source/credential review.

Install sees only `package.json`, `package-lock.json` and `tools/packages`, plus trusted driver and private outputs. It uses `npm ci --legacy-peer-deps --ignore-scripts`; no repository postinstall scripts run. Only installation has bridge networking for dependencies. Build/tests/lint/typecheck/format have no network, no host credentials, read-only source/dependencies and fresh writable outputs. All containers drop capabilities and have memory/CPU/PID/time bounds. On interruption only the generated private container is removed. There is no Docker socket, host home, repo history, GitHub token or production environment mounted.

Runtime is pinned Node 18.20.8 bookworm image digest in `calibrate.py`, compatible with this snapshot's Angular 15 / Nx 15.4 / TypeScript 4.8 toolchain. This historical compatibility choice is not a recommendation to retain an old runtime indefinitely. The host architecture is recorded; an arm64 result does not accept GitHub x64 execution.

`tele-files-v1` runs:

- production build `api2`, with fresh nonempty `dist/apps/api2/main.js` checked by the host;
- explicit ESLint for both file-service roots;
- two direct Jest invocations, each requiring real tests, zero failed/skipped/todo and coverage at least 80% statements / 75% branches / 80% functions / 80% lines;
- five separate typechecks: API, both libraries and both specs (Jest's disabled diagnostics are not typechecking);
- Prettier check on both roots' source TypeScript.

The file tests mock repository, ffmpeg and filesystem behavior. Passing them would not verify real MongoDB, ffmpeg, HTTP endpoints, frontend, deployment or the whole repository's CI. No coverage or lint thresholds are relaxed for a green baseline.

`calibration.json` records source/material/helper/log hashes and phase results. It always has `operational_pilot=false`, `merge_eligible=false`, `paid_ai_started=false`, `github_dispatch_performed=false`, `contract=null`. Keep raw logs and source material private: publish only reviewed, sanitized results and counts. Nothing in a calibration receipt authorizes application changes, a paid model, telemetry writes, a merge, a customer mirror or production.

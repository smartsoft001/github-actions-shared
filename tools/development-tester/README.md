# Development tester — staged MVNO Documents pilot

This is a reviewable, **disabled** proposal. It has not run an AI model, a GitHub Actions pilot, or the Docker verification profile. The caller must retain literal `if: false`. No scheduler, dispatcher, merge, settings, secrets, branch protection or existing implementation workflow is changed.

## Scope and trust boundaries

`mvno-v1` accepts only TypeScript changes under `libs/documents/shell/app-services/src/` and `libs/documents/shell/nestjs/src/`. Other projects, dependency/framework updates, validation configuration, workflow changes, symlinks/submodules, binary/oversized changes, or an all-deletion change block and need supervised review/new pinned policy. Renames must stay in scope. The entire current development base must be an ancestor of the head.

1. **Prepare, outside PR execution:** read current PR, live development SHA, wrapper at caller workflow revision and head, Git Trees and complete changed-file text. Freeze title/body/updated_at, head/base, file modes, requirements and bundle hashes. Reject truncated data, more than 50 files, bundle over 200 KB, missing `## Acceptance criteria`, missing opt-in label, forks and races. GitHub Contents alone is not a symlink check; tree mode is validated first.
2. **Checks, no secrets:** a fresh GitHub-hosted runner checks out exact head without persistent credentials. Host Python selects a fixed central profile; candidate Nx is never imported by the evidence producer. Each concrete command gets a separate Docker invocation, exit receipt/log digest and new empty `/result` directory. Checkout and trusted code are read-only. Install uses `npm ci --ignore-scripts` in separate dependencies; subsequent commands mount dependencies read-only, use no network, no capabilities and no host socket/home/credentials. Only generated `dist`, `.angular`, `coverage`, per-command results and temporary files are writable. Output mounts cannot hide tracked source. Candidate stdout is a bounded file, never GitHub workflow commands or a success marker.
3. **AI review, separate clean job/session:** no PR checkout, tools, repository settings, hooks, plugins, MCP or resume. Only a bounded complete data bundle enters the prompt. A pinned CLI runs with a fresh UUID and a minimal environment; returned UUID must match. The CLI result records actual model usage. Findings, unknown context, truncation, timeout, invalid schema or absent output block. This is an independent AI **code review**, not evidence that the model executed tests.
4. **Finalizer, outside candidate execution:** verifies same-run/attempt artifacts, mandatory commands/counts/coverage and AI result, then rereads PR/head/base/wrapper/requirements twice before success. Only a validated report is uploaded as the final v4 artifact. No model decides readiness or merges.

The host proves which fixed subprocesses it invoked and their exits, plus freshness and structure of their output. Repository tools and tests remain untrusted code: exit zero or a well-formed Jest report is **not cryptographic proof of honest test logic**. Independent review must inspect tests and changes. The original single-marker/early-`process.exit(0)` bypass has a negative test; absent real build/test outputs cannot pass. This does not make arbitrary malicious tests trustworthy.

## Fixed checks

- API `api:build:production` through the existing public Nx executor, bypassing the Nx Cloud task runner; fresh nonempty API bundle required.
- ESLint for both Documents backend libraries, without fixes.
- Separate TypeScript checks for both Documents libraries and `apps/api/tsconfig.app.json`, without emit/incremental output.
- Four separate existing Jest configurations: Documents app-services, Documents nestjs, Transactions domain, MNP app-services. Each must execute >0 tests, skip none and pass. Each independently meets statements 80%, branches 75%, functions 80%, lines 80%; aggregate reports the minimum per metric. Output is read only after its container exits; a later command cannot reuse an earlier report.
- Prettier check of existing changed files. No format/lint fixes, automatic repair round or backend→web inference.

This is deliberately not a general MVNO merge gate. The staged Automation guard must not be globally enabled with this narrow profile: acceptance requires either trusted routing to an explicitly registered repo/PR pilot or broader approved profiles. Department/label alone does not establish that routing.

## Activation blockers (not resolved by this PR)

As read on 2026-11-04, smartsoft001 uses Team, MVNO has no environments, allows all actions without required SHA pinning, and development is unprotected. A private Team environment may not support required reviewers. Adding an environment/label or a YAML secret reference is **not** platform secret isolation. A PR can alter its wrapper or add a job before any post-run provenance check.

Before activation, a separate approved platform design must prevent PR-controlled workflows from accessing existing repository OAuth/other secrets, as well as the dedicated review credential. Prove that protection before granting a credential (for example an independently enforced trusted execution policy/broker). The proposed protected `development-ai-review` environment and manual enrollment variables are additional fail-closed checks, not that proof. If unavailable, keep the entire caller disabled. Preflight currently requires a required-reviewer rule with self-review disabled; no fallback silently weakens it.

Only after that separate acceptance may the dedicated environment provide `DEVELOPMENT_TESTER_CLAUDE_OAUTH_TOKEN`, and approved variables provide `DEVELOPMENT_TESTER_SECRET_ISOLATION=platform-enforced` and `DEVELOPMENT_TESTER_PLATFORM_APPROVAL=verified:<shared-workflow-SHA>:<wrapper-blob-SHA>`. These strings record approval, not technical evidence of isolation. Neither is set by this proposal.

Also required: private shared-action access, exact live CLI output/schema and Docker/Linux runtime acceptance, current branch protection and atomic base-race protection before any autonomous merge. A final live reread cannot implement atomic base compare-and-swap. The dispatcher receipt, card publisher and telemetry remain a later package; the prior local adapter stays disabled. The current Galena dev deployment's Argo application is a separate acceptance condition, not proven here.

## Provenance contract

The wrapper job is `tester`. GitHub job names are:

- `tester / prepare`
- `tester / checks`
- `tester / ai-review`
- `tester / development-tester (PR #N, BASE40, WRAPPER40, UPDATED_AT)`

`UPDATED_AT` is the exact frozen GitHub ISO timestamp. Every finalizer success requires unchanged title/body and timestamp. The executor must compare the exact name against current PR identity and validate check→job→run/attempt→wrapper hash and referenced pinned reusable workflow. PR arrays may be empty; they are not proof. Changes to title/body/labels/comments may invalidate the timestamp and require a fresh run; the caller includes `edited`, and supervised label removal/readdition supplies a fresh event if necessary. Rerunning an old event after head/base changes intentionally blocks.

The immutable final v4 artifact is `development-tester-<run_id>-<run_attempt>`, containing `report.json`. Internal artifacts use `development-subject-`, `development-checks-`, `development-review-` with the same suffix. Artifact ID/digest/retention are read from GitHub API. Report JSON copied into a card is never provenance.

Report schema version 1 includes `result`, `subject` (repository, PR, head/base/tested_tree, wrapper blob, timestamp, paths, requirements/bundle SHA256), `producer` (caller workflow SHA, shared/helper SHA, run/attempt, actual review session and model names), `checks` (host command receipts/log digests, test counts, minimum coverage and per-module counts), `review`, `completed_at`, and zero fix/build repair counts. Since existing PRs have no implementation receipt, `implementation={source:existing-pr,run_id:null,session_id:null}` and `independence=fresh-review-job-and-session`. It does not invent implementation identity or imply different model weights.

Helper/action commit A is pinned by reusable workflow commit B; the caller pins B. No tags or floating action references. The current reusable job context `job.workflow_sha` identifies B; `github.workflow_sha` identifies the caller execution revision. The helper is fetched as a pinned shared composite action, not by accidentally checking out the caller repository or giving it a cross-repo PAT.

## Local verification and pinned sources

Run without credentials/model/network:

```sh
python3 -m unittest discover -s tools/development-tester -p 'test_*.py' -v
python3 -m py_compile tools/development-tester/tester.py tools/development-tester/mvno_profile.py
node --check tools/development-tester/checks.cjs
actionlint .github/workflows/development-tester.yml
```

Tests cover wrong PR/head/base/wrapper/run/attempt, changed requirements/timestamp, incomplete check sets, zero/skipped tests, low coverage, model-forged checks, review gaps, marker forgery with exit zero, missing build output, fresh subprocess environment/stdin timeout, malformed JSON, out-of-scope changes, symlink/submodule rejection and read-only mount arguments. These are local contract and subprocess tests, not a passed GitHub/Docker/AI run.

Pins were read from official upstream metadata on 2026-11-04: GitHub REST `repos/actions/{checkout,setup-node,upload-artifact,download-artifact}/commits/v4`; Docker Hub Registry manifest for `library/node:20.20.2-bookworm`, digest `sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`; npm registry `@anthropic-ai/claude-code/2.1.318`, integrity `sha512-OTJgLxcvWefv8IdTsq5n90Z2IxEhLwKqHUBhwZYE4odXzKA/Tb6p2Zb5Iy9Vq7JIVcNZzn9cPxW5sb42wLF95Q==`. No global installation was performed locally. The workflow verifies this tarball integrity before CLI installation and has no token during installation. Review model `claude-opus-5` matches the existing shared implementation configuration; actual use is reported by the CLI and still needs live acceptance.

Relevant official interfaces: [job workflow context](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts#job-context), [CLI flags](https://code.claude.com/docs/en/cli-reference), [Contents symlink behavior](https://docs.github.com/en/rest/repos/contents), [workflow run provenance](https://docs.github.com/en/rest/actions/workflow-runs).

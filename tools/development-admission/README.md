# Development receiver admission

Read-only fence for the reusable `ai-plan.yml` and `ai-impl.yml` receivers.
The separate admission job runs before checkout of caller code, dependency installs
and model execution. A dependent model job requires literal `allowed=true`.
Provider errors, missing credentials, incomplete pagination, invalid identities,
`AI Skip CI` and coordinator-owned issue keys/UUIDs deny admission. Denial is a
successful admission step with `allowed=false`; a crashed step also prevents the
model job from starting. The existing Linear credential is reused; no new secret.

`ownership.json` is a reviewed, immutable registry shipped with the action.
Retain completed/paused coordinator issues to prevent legacy replay. Register a
future pilot here and publish a newly pinned action before enrolling that issue;
this static registry does not discover new coordinator enrollments automatically.
There is no event-supplied override, registry path or allow switch.

The action is pinned to its source commit in both workflows. Wiring tests compare
the action bytes with that commit and require admission on every model job.
Changing action source requires publishing a source commit and updating both pins.

## Verification (2026-11-08)

- 11 admission tests, plus 67 existing offline tests: PASS.
- actionlint on both reusable workflows and PR CI: PASS (shellcheck disabled;
  pre-existing shell bodies are outside this change).
- ai-os-server read-only Linear smoke, no job dispatch or model:
  GAL-1881 denied `coordinator-owned`; GAL-1780 denied `ai-skip-ci`;
  GAL-1863 allowed `linear-readback-verified`.
- No source writes, Notion writes, active n8n changes or finalizer activation.

## Rollout remains separate

This PR does not move `v1` or edit caller wrappers. Current Tele callers use `@v1`
and therefore remain on the old receivers. A reviewed rollout must update caller
pins/tag under separate authorization and verify the receiver fence without a
model first. Do not claim production coverage from this PR or offline tests.
This admission check is a preflight fence, not a reservation or exactly-once model
executor. The durable coordinator reservation and verified planning adapter remain
required before enabling a real planner.

## Manual admission-only probe (prepared, not run)

`development-admission-probe.yml` is manual-only on GitHub-hosted Ubuntu. It
calls the pinned action four times, then requires exact allowed/reason pairs:
retained ownership, a real AI Skip CI label, a complete ordinary-issue read,
and a missing credential. A generic denial cannot falsely pass the label case.
An ordinary-issue admission is only a checked result; no model job follows it.
The extra `reason` output is a safe enum. Model workflow gates remain unchanged.

The dedicated `development-admission-probe` environment must be separately
approved/provisioned with a deployment branch policy allowing only main and
`DEVELOPMENT_ADMISSION_LINEAR_READ_TOKEN`. Verify actual read-only permissions
and access to the selected Tele issues. The probe does not use model, Notion,
Langfuse, deployment or client-mirror credentials. Shared currently has neither
repository secrets nor organization secrets made available (metadata read
2026-11-08). Do not copy any existing server key without explicit authorization.
No environment, secret or workflow dispatch is provisioned by this PR or CI.

After reviewed merge, authorized credential setup and fresh independent issue
reads, dispatch the probe on main with `skip_issue_id` and `ordinary_issue_id`.
Do not use an owned key for either input. Inspect the run's actual referenced
workflow/action SHAs and four exact results; retain the run ID/attempt/head.
Do not re-enroll GAL-1881: this probe reads its static ownership entry only.
Missing or incorrect credentials must fail the overall probe, not be reported
as a successful skip-label scenario. Stop after this manual acceptance; no paid
run, n8n rollout, finalizer activation, v1 retag or Tele source push is implied.

Both AI reusable workflows update their action pin to the tested source to keep
main internally consistent. Existing Tele callers still use the unchanged v1;
this PR is not a rollout of Tele or protection of its historical refs.

## Prepared producer fence

[Offline producer quarantine](PRODUCER-QUARANTINE.md) reuses this ownership
registry before the legacy n8n dispatch/classifier. It is a separate inactive
proposal, not a change to either active workflow or Tele's receiver pins.

## Prepared supervised rollout

[Rollout and Tele isolation](ROLLOUT.md) adds a persistent intent journal,
cooperating-process lease, drain gates, exact-version publication proposals and
containment-only recovery. It has no API executor and performs no live change.

## Prepared error monitor

[Producer monitor](PRODUCER-MONITOR.md) evaluates metadata only and reserves
alerts in private SQLite with event deduplication/cooldown. The isolated manual
phone test does not activate production monitoring or satisfy rollout acceptance.

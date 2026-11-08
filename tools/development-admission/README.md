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

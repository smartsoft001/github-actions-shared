# trusted-manual-v1 — report-only proposal

This is separate from the existing `pull_request` tester and Automation merge guard. They retain their existing pins and contract. A manual result is **never merge-eligible**. The new caller remains literally disabled; no settings, environment, secret, dispatch, model or production workflow are changed here.

The caller is proposed from MVNO's default `master`, not from PR code. Adding it to master triggers the existing `push-to-client` mirror/force-push even when `deploy-prod` does not run. Bootstrap needs its own explicit acceptance. This package does not edit either existing workflow.

## Before a future paid run

There are two independent hard stops: the disabled caller and `LANGFUSE_ADAPTER_IMPLEMENTED=False`. A real accepted Langfuse adapter is mandatory; this package adds no writer or credential, and no Airtable writes. Merely setting variables/environment or changing `if:false` cannot run a model. Future integration must produce an acknowledged telemetry receipt bound to run/attempt, subject hash, model usage and review session. Flipping the flag is not integration. CLI `modelUsage` is not Langfuse.

After separately approving bootstrap, the operator must obtain the actual caller workflow ID, execution SHA and wrapper blob from trusted master, then approve a concrete non-secret `DEVELOPMENT_MANUAL_ACCEPTANCE` repository variable. `acceptance.example.json` is deliberately incomplete/disabled and is not runnable. This external acceptance avoids a circular self-pinned commit. It binds the producer pins, numeric GitHub actor ID, exact PR/head/base/metadata/requirements, bounded validity window, workflow ID and **one expected run number**. No auto-increment or retry authority is inferred.

GitHub defines run_number as unique for a particular workflow and unchanged on rerun; run_attempt increments on rerun. Every stage checks live REST run_id→workflow_id/run_number, attempt 1, actor and triggering_actor, event/default ref and execution revision. The paid job also has an attempt-1 condition and repeats the checks immediately before CLI invocation. A different dispatch consumes a different number; a race or failed dispatch that consumes the accepted number needs new approval. A renamed/recreated workflow must match the accepted numeric ID and path. [GitHub contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts), [rerun privileges](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs).

The dedicated new `DEVELOPMENT_MANUAL_CLAUDE_OAUTH_TOKEN` may exist only in `development-manual-review`, with selected deployment branches configured to exactly one rule: type `branch`, name `master`. No tags, wildcard or protected-branches-only fallback. Required reviewers are not assumed available on private Team. The no-secret prepare job verifies policy before the review job; current repo has no environment, so that also blocks. The existing five repo secrets remain an acknowledged pre-existing surface; this proposal does not claim to isolate or migrate them. Trusted master writers remain a platform trust boundary.

The acceptance variable is a job/run snapshot, not a guaranteed live kill switch for an already-running process. The operator cancels an active run if required. A protected master and exact accepted execution SHA prevent silently using later code; stronger master governance is a separate acceptance decision.

`max_budget_usd` is an accepted CLI estimate setting, capped by this policy at 5; the provider may exceed that estimate. It is not a hard invoice limit. GitHub runner usage is separately accepted. Receipt fields are `cli_reported_estimate_usd`, model usage and `billing_verified=false`, not actual billing. [Claude CLI](https://code.claude.com/docs/en/cli-reference).

## Execution versus subject

Execution is the accepted master/workflow/helper and one GitHub run/attempt. Subject is an existing open same-repository PR to development at exact head/current base, with complete criteria and immutable bounded source bundle. A draft PR can receive a report; this is not merge authorization. Current development must be in its head history. The subject **does not need the manual wrapper at its head**. Wrapper trust comes exclusively from execution/master. Changes to workflows/config/dependencies remain outside the fixed `mvno-v1` Documents profile.

Separate jobs run prepare, secret-free checks, clean AI review, and report finalization. Each uses fresh GitHub reads; finalization repeats source/execution/mandate checks before producing the receipt. Candidate source/dependencies stay read-only in the existing fixed Docker profile. Review has no candidate checkout, tools, hooks, repository settings, MCP or resume. The paid credential reaches only a minimal child environment, never checks. Artifacts are unique by run ID and attempt. The structured review artifact keeps only allowed CLI identity/result fields and numeric usage metrics; raw text, debug and stderr are never uploaded. Report includes execution and subject separately, mandate/config hash, checks, actual CLI session/model usage, estimate and a bound telemetry receipt. No card or copied JSON is authority.

## Historical calibration, no paid AI

`calibration.py` is a separate local harness for merged GAL-1231 #83: head `e65cbf9f4dde571b5b05ddde833450551ada5490`, base `8a8a801dbf5cb4deeb3e43ff9ffa9bb35760934e`. It never emits a trusted-manual receipt, never claims an open pilot and never invokes a model. The historical diff also changed package/lock/ESLint/LICENSE/README outside today's operational allowlist; the calibration report lists those explicitly. It exercises fixed checks and Documents source formatting using the historical final toolchain; it does not approve those outside-scope changes under the current operational policy.

```sh
python3 tools/development-manual/calibration.py --source /absolute/existing/mvno-clone --output /private/tmp/new-calibration-directory
```

The output directory must be new and outside the read-only source, including through symlinks. A bounded five-second `docker info` probe precedes checkout/install. Missing, denied or stalled engine produces `calibration.json` with `result=blocked`, `checks=null`, and exit 2; it never fabricates green tests. It does not install/restart Docker or touch existing containers. A ready engine uses an isolated clone and the existing secret-free container driver. Local producer IDs are explicitly `local-calibration-*`, not invented GitHub runs. A passed calibration is still `operational_pilot=false`, `contract=null`, `merge_eligible=false`.

Offline checks (no engine/model/network):

```sh
python3 -m unittest discover -s tools/development-manual -p 'test_*.py' -v
python3 -m unittest discover -s tools/development-tester -p 'test_*.py' -v
python3 -m py_compile tools/development-manual/manual.py tools/development-manual/calibration.py
```

Local test fixtures are synthetic, including telemetry acknowledgments. They are not evidence of Langfuse, a real GitHub manual run, model billing or Docker checks. Live acceptance and a real engine remain distinct requirements.

### Staged finalizer for package 7

Use a single dedicated trusted finalizer on ai-os-server with SQLite on persistent local disk. The current ephemeral GitHub runner cannot provide this reservation guarantee. Provision the database once with `SQLiteReservations(path).initialize()` in an owner-only directory outside the checkout and artifact directories. Point every invocation at the same database. A missing database at runtime blocks new writes. Do not initialize a new database as a recovery step.

The staged `finalize` entry point consumes the pinned subject, checks and review. Its protected configuration is `DEVELOPMENT_MANUAL_TRACE_TARGET` (approval digest as `approval_sha256`, approved `project_id` and existing AI OS `task_id`), `DEVELOPMENT_MANUAL_RESERVATIONS_DB`, the project-scoped `DEVELOPMENT_MANUAL_LANGFUSE_PUBLIC_KEY` and `DEVELOPMENT_MANUAL_LANGFUSE_SECRET_KEY`, and a scoped `DEVELOPMENT_MANUAL_NOTION_TOKEN`. Supply these only to the finalizer, outside PR-controlled inputs. Before activation, the reusable workflow needs new reviewed pins and dedicated runner routing, and the existing paid gate needs separate acceptance.

The finalizer validates the card and run, obtains a matching Langfuse readback and adds a paragraph link to the existing AI OS card. The report includes the verified URL. Reconciliation reads the same trace and scans the card before attempting any write. If an append was reserved but no link is visible, reconcile by reading the card without issuing another PATCH. Decision and status are separate from the card body.

# Producer quarantine — offline proposal only

The accepted Shared admission probe does not fence Tele's legacy receivers or
its n8n classifier. The current producers skip AI Skip CI from the first 20
labels only. The offline fixture reproduces a candidate escaping that window.
This proposal stops retained coordinator issues before dispatch and before the
OpenAI classifier, and denies incomplete label evidence rather than granting it.

## Source and limits

`producer-baselines.json` records the two published producer versions observed
read-only on 2026-11-08. It contains node names/types, topology and only the
candidate-builder code plus Linear query parameters. It excludes credentials,
private response data, model prompts/configuration and other node parameters.
Both observed drafts were identical to their active versions. The queue executor
is not a target. No n8n API or workflow execution is called by this package.

`producer-quarantine.cjs` generates exactly four parameter updates: the two
Linear queries and two Filter & Enrich scripts. `producer-quarantine-preview.json`
is a review artifact with `apply:false`, never an instruction to deploy. It
retains all schedules, topology, credentials, downstream behavior and candidate
fields for fully verified ordinary issues. It does not add an inbound hook or
any n8n connection to ai-os-server. The old proof-hook patch in Automation is
historical and must not be used as the rollout recipe for this package.

The registry is the same reviewed `ownership.json` used by the GitHub action.
Key or UUID ownership is checked independently of labels, issue state or repo
routing, including wrong-repository routing and completed/paused cases. There
is no caller-provided registry override. New enrollment requires reviewing the
registry, GitHub action pin and producer-generated code before ownership starts.
Disabling the coordinator does not remove quarantine.

Queries request up to 100 labels with IDs and pageInfo. A positive candidate
requires `hasNextPage=false`, valid identity and unique valid label IDs. This
compiler does not fetch further label pages: truncation or malformed evidence
stops the poll. Partial GraphQL errors also stop it with a generic safe error.
No source body, customer title or credential is added to error text.

These are shared producers covering AI Dev projects. A failed/incomplete source
can therefore halt the whole poll, including unrelated candidates. This is a
known rollout impact to review, not a claim of Tele-only deployment. No active
workflow, project or customer was changed by this proposal. Monitoring of such
failures must be verified before any separately authorized rollout; do not call
an empty result or an error a successful autonomous cycle.

## Verification

19 Node tests execute the original published builders and generated scripts in
isolated VM contexts, without APIs or models. They reproduce the old 20-label
escape, preserve ordinary candidate fields and prove quarantine by key/UUID,
wrong-repo routing, no labels, completed/paused ownership, partial errors,
truncation, duplicate labels, source/version/topology drift and unpublished drafts.
Topology checks require the filter on every path from a trigger to model or
GitHub dispatch nodes. These are offline evidence, not live n8n acceptance.

Run:

```sh
node --test tools/development-admission/*.test.cjs
```

## Future reviewed rollout, not performed

1. Obtain separate authorization to change these active workflows and review the
   shared-poll impact. The current mandate explicitly excludes such changes.
2. Read both full workflows again through the authorized n8n connector.
   Normalize each returned workflow with `snapshotFromMcp`, then pass both
   snapshots to `compile`. Missing full graphs, unpublished drafts, changed
   active/draft versions, query/code or topology refuse compilation.
3. Review the registry digest, exact operation diff and source version. Do not
   replace fresh snapshots with the checked-in baseline to bypass drift checks.
4. This module has no apply client or atomic deployment lock. The n8n mutation
   API does not provide an expected-version argument here. A future deployer
   needs exclusive editing, a check immediately before mutation, safe publication
   and full readback. `apply:false` and a matching preview are not that mechanism.
5. Accept the producer block without running a model; verify failure monitoring
   and candidate preservation. Do not execute the whole live dispatcher merely
   to test a filter: it includes paid classification and project mutations.
6. Legacy GitHub receivers on both Tele refs still need their own isolation.
   Do not activate a real planner, clear historical claims, retag v1, replay
   GAL-1881 or activate the finalizer based on this preparation.

Rollback retains coordinator ownership and durable reservations. Do not restore
legacy access for enrolled issues as a recovery shortcut.

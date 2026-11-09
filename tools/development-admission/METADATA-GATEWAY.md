# Unpublished producer metadata gateway

Prepared on Emil's explicit approval for a new authenticated draft and one new
secret on ai-os-server. No publication, schedule, model, active producer change
or finalizer activation is authorized by this preparation.

`metadata-gateway.cjs` validates the four exact query fields, two producer IDs,
three failure statuses and a timezone-qualified <=24h window ending no more than
30s ago. It projects four metadata fields and requires every REST page through an
explicit terminal nextCursor:null. Twenty nonterminal pages, oversized/duplicate
or wrong-scope records, stale data and empty partial pages refuse completeness.
REST pagination is separate from MCP lastId/count. The current REST schema was
checked against the official n8n source:
https://github.com/n8n-io/n8n/blob/master/packages/cli/src/public-api/v1/handlers/executions/spec/paths/getExecutions.generated.yml
No real REST endpoint or authenticated gateway has yet been executed.

`node build-metadata-gateway.cjs` emits the five-node SDK draft: authenticated GET
→ scope validation → fixed n8n REST metadata read → safe projection → JSON reply.
The native n8n node only advertises three status filters; HTTP Request is used for
all required status filters and bounded cursor pagination. includeData=false,
GET only, no redirects/cross-origin credential forwarding, no retry,100rows/page,
20requests maximum and10s request timeout. The actual workflow also has10s total
execution timeout and execution-data persistence disabled. No arbitrary URL,
caller cursor, payload field, action or workflow execution can be selected.

## Actual draft and auth blocker

Workflow Ezm9n6EggooXhbam in Emil's personal n8n project/root, unpublished,
active=false, activeVersionId=null. The trigger is disabled and a literal guard
throws before any source call until dedicated authentication has been configured.
No execution of this gateway occurred.

The SDK's newCredential label was auto-assigned by n8n to an unrelated existing
`Header Auth account`. This is NOT the dedicated approved credential. We did not
read, modify or use its secret. The API refused clearing the credential with an
empty ID, so the stored reference remains pending replacement; trigger disable
and the pre-read guard independently prevent use. Do not publish/enable this draft
with the unrelated reference. The builder likewise emits a locked placeholder:
verify actual credential binding after import; never trust auto-assignment.

The existing `n8n internal` reference on the read node is correct and stayed in
n8n. No existing n8n API key was read or exported. Connector tools do not expose a
standalone credential-create operation. A credential-create workflow would put
the new value into intermediate execution data; it was not used as a workaround.

The new cryptographic token was generated directly on ai-os-server in an existing
owner-only scope. Header Auth setup must be completed by Emil in n8n. Obtain the
value through SSH into a local clipboard, create the named Header Auth, and bind
it to the draft. Do not put the token in Git, workflow parameters, shell command
arguments, execution logs or chat. Only its SHA-256 is recorded in the receipt.
Do not regenerate it on retries. After setup, inspect credential ID/name and
workflow source/version before removing the preparation guard. Keep the trigger
disabled and workflow unpublished until a separate test/publication mandate.

## Tests and unverified runtime

9 new Node tests verify scope/time/input validation, safe projection, terminal
paging, bad source data, limits, generated graph invariants and preparation locks.
Full local suite:119 Python +63 Node PASS. SDK schema/workflow validation passed.
Synthetic tests do not prove actual HTTP pagination flattening, API support of the
installed n8n version, Header Auth rejection or live filtering. Those require a
later explicitly authorized authenticated manual test. No test-only gateway was
published. Independent monitor liveness and production acceptance remain open.

## Dedicated Header Auth bound — 2026-11-09

Emil confirmed saving the dedicated Header Auth. An exact name/type lookup found
one credential `Development Producer Metadata Gateway`, ID `0tGUT0V8GTxSHYch`.
It replaced the unrelated auto-assigned reference on `Authenticated metadata request`.
Readback version `7c9ca060-6a52-4143-a570-00ce32f03235` confirmed only the credential
reference changed: nodes otherwise identical, connections/settings unchanged,
active=false, activeVersionId=null, trigger disabled and the pre-read guard retained.
The earlier pending-credential steps above describe the preparation history; do
not recreate the credential or regenerate the token. Builder imports still require
explicit identity verification because auto-assignment must never be trusted.

This is static binding verification. Credential values were not retrieved; token
matching and authenticated HTTP acceptance/rejection have not been tested. The
preparation guard remains intentionally locked even though binding is now complete.
No gateway execution, publication, trigger enable or finalizer activation occurred.

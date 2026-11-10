# Unpublished producer metadata gateway

Current gateway uses the merged six-node graph with explicit HTTP400/503 responses.
Its 13-case native HTTP matrix passed on 2026-11-10 and the draft was restored
to disabled/guarded/unpublished. The dated sections below preserve earlier history.
See the final section for additional isolated runtime coverage and its limits.

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

## Complete native HTTP retry and explicit status fix — 2026-11-09

After authorized merge/sync Shared #14/Development #22, all13cases were repeated
through native draft listeners with the10s client limit unchanged. Six valid
metadata reads across both targets and three statuses returned complete200JSON in
0.6818–3.0567s. Missing/wrong auth returned403. Five invalid authenticated requests
stopped in the guard before the source, but the actual listener returned empty200,
so the overall HTTP acceptance still fails. No protected metadata was returned by
these invalid cases; transient UI node paths and empty bodies are recorded.

The previous timeout was not reproduced. DNS/TCP/health were fast, and tracing
shows complete fixed-length JSON without body-read stalls in this sample. Seven
pending execution metadata records alone do not prove that a queue caused the
old delay. Do not claim the historical11s cause is resolved or increase timeouts.

The proposed fix replaces implicit throw-based responses with explicit envelopes:
invalid input→400fixed JSON through the false IF branch, with no source node;
valid input→source/projection→200safe metadata, or503fixed JSON on source/shape
failure. The HTTP node continues errors only into the strict projection envelope;
no raw remote error is returned. Reply code/body are always constructed by the
trusted envelope helpers. The builder pins the already verified dedicated Header
Auth reference instead of allowing another automatic credential selection.

Five additional Node tests cover400privacy/scope, safe valid envelopes,503source
failures,200projection and false-branch wiring. Full offline suite132Python+68Node
PASS; all6node configurations and SDK graph validate. This changed graph is only
in the PR: no draft update, live test or publication of the status fix occurred.
It still emits a disabled trigger/preparation throw. A new exact reviewed draft
and native test window are required to accept the fix over HTTP.

Final live state: Ezm9n6EggooXhbam version560813af-7ed4-409d-b5f1-03c28d06095f,
unpublished, triggerdisabled, exact preparation guard and full original baseline
restored. One cleanup GET404 confirms the test listener is closed.13matrix+1cleanup
requests, no autoretry/model/schedule/finalizer. Production monitoring/liveness
remain unaccepted; Tele acceptance stays with its next planned release.

## Native fixture integration — 2026-11-10

`gateway-native-fixtures.cjs` runs the actual n8n2.46.6 HTTP Request4.5 node and
the builder's unchanged guard/projection code in a fresh local SQLite instance.
It imports only local manual workflows. It removes credential references,
replaces the read URL with a synthetic loopback source, and never connects to
the live gateway, Notion, Langfuse, models or project repositories.

The runner requires macOS, Node24 and a pre-existing n8n2.46.6 installation;
it does not install packages. Run with that Node executable:

```sh
node tools/development-admission/gateway-native-fixtures.cjs /absolute/path/to/n8n-installation
```

An OS network sandbox permits only loopback, with a separate EPERM check for
non-loopback traffic. The child receives a small explicit environment and a
fresh HOME/N8N_USER_FOLDER. Synthetic source logs and SQLite are deleted on exit;
only safe aggregate results reach stdout. The runner does not start an editor,
publish a webhook, import service credentials or change an existing instance.

Six actual node-execution cases passed on Node24.16.0:

| Case | Source requests | Envelope |
|---|---:|---|
| Nonempty page | 1 | 200, one safe row |
| Two pages (100+1 rows) | 2 | 200, 101 unique safe rows |
| Source HTTP503 | 1 | fixed503, no source error body |
| Source HTTP503 on page2 | 2 | fixed503, no partial success |
| No terminal cursor at20-page cap | 20 | fixed503 |
| Duplicate row across pages | 2 | fixed503 |

The source checks exact query scope, includeData=false, limit100 and the cursor
sequence; canary payload/error fields must not survive projection. The original
builder retains its production host, credentials, pagination20 and preparation
locks. Two default-CI boundary tests prevent accidental fixture credential/host
inheritance and drift from the reviewed pagination/projection/error settings.

This proves native node pagination/error handling against synthetic HTTP, not
nonempty or multipage behavior of the deployed n8n REST API. The isolated chain
asserts the reply envelope; it does not run Respond to Webhook.

A separate single native gateway HTTP attempt with a temporarily invalid source
limit timed out within10s. Delayed UI later displayed all six nodes completed,
but the client did not verify503; no live source-failure HTTP acceptance is claimed.
The full locked baseline was restored (versioneaacd238-e809-4948-9332-fa31eaef2f49),
cleanup404 and UI Deactivated confirmed closure. No automatic retry, publication,
model, schedule or finalizer activation. Real API nonempty/pagination, native503
response and independent runtime/liveness remain open.

# Prepared producer error monitor — inactive

This package evaluates only execution metadata for the two known producer IDs.
It does not run producers, retrieve prompts/customer payloads, modify a workflow,
read credentials, send a message or create a schedule. Authenticated readers and
the authorized existing delivery connector remain separate ports.

The chosen direction is an external read-only metadata poll, avoiding a change
to either producer's errorWorkflow. No autonomous poller is installed/activated
by this proposal. Production profile targets are fixed to Plan Poller and
Implementation Dispatcher; an isolated manual-test profile is explicitly separate.

## Detection and privacy

`producer_monitor.py` accepts complete, fresh metadata batches from an authorized
n8n reader. `error`, `crashed` and `unknown` become bounded messages with the
workflow/execution link. Unknown is described as uncertainty, not a confirmed
application failure. No exception message, model input/output or source-provided
URL is included. An unavailable, incomplete, estimated or malformed read is not
reported as healthy. Wrong/missing target inventory refuses inspection.

The caller must collect all metadata pages for the selected window, with real
count/completeness evidence. The first baseline (`since`) is explicit so future
activation does not flood the phone with historical incidents. The current
metadata reads found no failed producer executions; this is not proof of future
health, heartbeat or production monitoring coverage.

`producer-monitor-cli.py` checks private profiles/state, inspects metadata or
reserves delivery. It has no network/sender. Inputs are owner-only local files,
not events choosing targets, commands, credentials or URLs. `--check` never
initializes a replacement state database. `--reserve ... --manual-test` bypasses
the disabled flag only for the isolated test scope, never for production.

## Delivery control

The SQLite database is initialized explicitly once in an existing owner-only
directory. Runtime opens the same file read/write, never creates a recovery DB.
Its profile identity binds source scope, targets, baseline, policy and core
implementation hash. Enabling the same reviewed profile preserves history;
changing material/code requires reviewed migration, not a fresh DB to replay.

A unique event key and BEGIN IMMEDIATE transaction commit an intent before a
sender may be called. Restart or an uncertain response never automatically
resends that event. Every attempt also starts a per-target 30-minute cooldown,
including uncertain outcomes. Different incidents cannot bypass it. This follows
the existing queue-monitor interval; the new monitor remains inactive pending
separate runtime approval. Successful API acceptance is stored by actual request
ID. A repeated acknowledgement must match; it cannot invent a missing attempt.

The message and URL are recomputed and checked before reservation. The delivery
port must use only the reserved packet and an authorized existing recipient.
It must not resend by directly rerunning a temporary sender workflow. SQLite
coordinates cooperating senders, not arbitrary UI actions or other software.
A replay after the metadata freshness limit is refused before delivery.

## Actual isolated manual acceptance — 2026-11-09

User authorization covered preparing/testing this monitor with an iPhone alert,
without model, active n8n changes or finalizer. Two new manual-only inactive
workflows were created in Emil's personal n8n project, without a schedule:

- Controlled fault `ayjLPAxf6qDAscys`, execution `451601`: actual metadata read
  confirmed status error, mode manual and one complete matching execution.
- Reserved native Pushover delivery `DTbFHgiUW2DWKhoW`, execution `451634`:
  success, provider status1/request `f50afcb4-4815-46e5-bc84-8ceb58437dbd`.

The core implementation used for that manual test has SHA-256
`be16656cffb20c0bf05baddd0610f0c40eca3a6c20cb9547acde880130573e7e`.
A private SQLite database on ai-os-server contains exactly one accepted attempt.
Replaying the old packet was refused as stale; repeating its provider
acknowledgement was idempotent and retained one attempt. Fresh repeated events
and cooldown boundaries are separately tested offline, including six processes.
No second sender execution occurred. Both temporary workflows were archived.
After archiving, the connector refused execution access; it was not bypassed
or represented as a fresh metadata read. Production sources were not executed.

The Pushover API acceptance proves provider receipt only. Emil separately
confirmed actual iPhone receipt on 2026-11-09: “Tak — alert dotarł”. The
Development receipt records that reply; no second message was sent.

## Acceptance boundary

An isolated manual failure and test alert are not production end-to-end coverage.
`production_acceptance` rejects the test scope even if phone receipt is confirmed.
The rollout monitor gate stays unverified while the production monitor is
inactive, both actual targets are not covered by a running authorized reader,
and real delivery/readback evidence is missing. Do not set the rollout receipt's
readback_verified flag from this test or attach an errorWorkflow automatically.

Before future activation: review source access/pagination, the exact baseline,
the alert channel, shared-state migration and runtime ownership on ai-os-server.
Use a separately authorized cadence; do not deploy a schedule on the main Mac.
No new secret or incoming ai-os-server hook is needed by this code.
Tele acceptance remains at the next planned release; finalizer stays disabled.

## Offline tests

19 new Python tests cover failure classification, safe data handling, bad API
reads, history baseline, scope/code binding, disabled production mode, restart,
unknown delivery, permanent event deduplication, 30-minute cooldown with controlled
time, private SQLite state, six competing OS processes and the manual CLI.
Run `python3 -m unittest discover -s tools/development-admission -p 'test_*.py'`.
No model, message or API is called by tests.

## Prepared single-cycle composition (offline only)

`producer_monitor_cycle.py` composes injected metadata-page and delivery ports
with the existing core and private SQLite state. It has no HTTP implementation,
credentials, executable entry point, timer or installed service. Imports do not
perform reads/sends. This is preparation for a future authorized runtime.

The normalized reader port receives an exact reviewed target, failure status and
opaque cursor. It returns `{data, next_cursor}`; this is our internal contract,
**not a claim that raw n8n REST or MCP responses already match it**. A real adapter
must prove coverage of error/crashed/unknown, map the actual pagination/status
semantics and apply request timeouts. Do not infer completeness from one page.
No client has yet been connected to either production target through this cycle.

All pages and all three status sets are scanned without a moving watermark.
Partial reads, cursor loops, duplicate IDs, wrong targets and limits become a
generic unavailable event, never a healthy result. Metadata is projected to four
fields. The snapshot is timestamped before collection; >30-second batches refuse
reservation. Defaults cap each target at 20 pages and 2,000 rows; a bounded future
query window needs separate design if real history exceeds them.

The cycle opens existing state before any source read. Disabled production has
no reader/sender calls, including with the manual-test flag. Delivery receives
only the safe grant after durable reservation; an actual status1/request receipt
acknowledges the same event. Lost responses, rejection, malformed receipt or an
ack failure leave intent durable with no automatic retry. A future sender must
also disable its HTTP/node retry; this function cannot constrain a malicious or
internally retrying injected port. Returned receipts omit raw error bodies.

11 offline composition tests cover read failure after a page, all-page collection,
sensitive payload projection, limits, slow reads, separate targets, reservation
before send, lost response, disabled production, missing state and duplicate
restart. Core implementation and existing manual-test database are unchanged.
This does not satisfy production monitoring acceptance. Runtime review must pin
both core and cycle source and bind exact adapters/configuration before enabling.
No heartbeat/independent alert exists for a stopped monitor or unavailable sender;
that delivery-health check is still an activation prerequisite.

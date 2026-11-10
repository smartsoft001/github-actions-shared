# Prepared external heartbeat and fallback observer

This package prepares an outbound heartbeat protocol and PostgreSQL observer.
It does not provision a database, credentials, permissions, endpoint, service or
schedule. `external-observer-plan.json` is disabled and contains unbound access
fields. No n8n draft is created or published. The primary monitor, health policy
and finalizer remain inactive.

## Proposed placement and direction

The primary on ai-os-server exports a small completed-cycle heartbeat **outbound**.
No n8n-to-ai-os-server connection or incoming server hook is introduced. The
receiver, PostgreSQL and periodic observer must be outside that host's failure
domain. Existing n8n is the candidate orchestrator; its physical hosting and the
database's failure domain are not yet verified by this package.

The fallback candidate is the existing owner Pushover channel whose credential
is stored in n8n, avoiding the primary process's Keychain access path. This is
**not a second notification provider** and does not cover a Pushover-wide outage.
Credential independence, the concrete runtime wiring and real fallback delivery
still need acceptance; the channel is not bound or sent by this component.

## Heartbeat export and replay rules

`producer_monitor_heartbeat.export_heartbeat` reads existing local health and
delivery databases read-only. It exports only a fixed monitor ID, reviewed
binding hash, completed-cycle ID/sequence/time, send time and bounded status
enums. It does not export provider IDs, execution records, error bodies, model
data or credentials. A latest unfinished cycle, missing journal, invalid clock
or completion older than180s refuses export. Re-exporting the same completion
does not invent a new sequence or completion time.

The prepared receiver admits at most2048 bytes of this exact schema. Sender
time can lag at most30s or lead the observer by5s; completed-cycle time remains
the freshness evidence. Unknown monitor IDs, extra fields, foreign bindings,
nonfinite clocks, arbitrary reasons and inconsistent states refuse the packet.

PostgreSQL timestamps reception on its own clock. A duplicate does **not update**
that timestamp. A changed packet under the same sequence, older sequence,
same-cycle replay under a new sequence, or non-increasing completion refuses
progress. Stored digest/columns/schema are checked again before later use;
corrupt state is not claimed healthy or silently replaced. Restoring/resetting
the publisher's journal is not permission to reset observer history.

The future HTTP adapter must use a dedicated, scoped write-only Header Auth
credential, strict TLS, no redirects and no retries. It must authenticate before
calling `ingest`; the payload cannot provide an authentication or activation
flag. The read-only metadata gateway's existing key must not be reused. No key
or HTTP adapter was created here; names/paths in the plan are candidates only.

## PostgreSQL state and least privilege

`external-observer.sql` creates registry, latest-heartbeat and notice tables in
an explicitly chosen future database. It contains no role creation or GRANT.
Production enablement requires all three independent review flags: ingress,
external-host placement and fallback acceptance. Defaults are false. The
manual override works only for `manual-test`, never a disabled production row.

The runtime only needs SELECT on the activation registry. A fixed PostgreSQL
transaction advisory lock serializes ingress and observer reservation, avoiding
UPDATE permission on the approval flags. The future ingress role may write only
the latest-heartbeat table; the observer may read it and insert notice identity/
status plus update acknowledgement fields. The latter does not need DELETE or
UPDATE of reservation time. Bootstrap/admin rights are separate and unbound.

The `postgresPort` accepts an already authorized pg Pool; it does not construct
connections or fetch secrets. Each transaction has3s statement/lock timeouts.
The future concrete pool still needs a bounded connect timeout and proper TLS.
No runtime should use a superuser. Actual restricted roles are exercised only
inside the disposable integration database, never installed on a live service.

## Detection and one fallback attempt

After a reviewed baseline, no first heartbeat within180s produces a missing
heartbeat incident. An existing heartbeat expires based on the older of cycle
completion and receiver time, not the sender's ability to keep posting. A stopped
publisher or whole-host outage therefore cannot keep itself healthy. Proposed
180s/30s/5s bounds are not deployed cadence or a measured production SLA.

Only fixed incident descriptions, a fixed n8n origin and fixed fallback route ID
reach the injected sender. The payload cannot select a command, recipient, URL,
credential, project or model. PostgreSQL commits intent **before** releasing the
reservation to the sender. Six competing transactions get at most one attempt.
An uncertain response, timeout, provider refusal or failed acknowledgement leaves
intent durable, without automatic retry. Global30-minute cooldown also covers
changed incidents; later reminders are new reservations, not replays of an old
uncertain send. Provider status1/request is required for acknowledgement and
never means a human received it.

`boundedSend` returns unknown by10s and supplies an AbortSignal. The actual
transport must honor it and enforce its own socket deadline; a callback ignoring
abort may finish late but is not retried or automatically acknowledged. Failure
of the external database, observer or fallback provider must itself be monitored
outside that failure domain. This package never declares production acceptance.

## Offline evidence and remaining wiring

Default PR CI runs exporter/receiver tests, including a Python-to-JS fixture.
`external-observer-postgres.mjs /absolute/path/to/existing-pg-installation` runs an
opt-in integration with the already installed embedded-postgres18.6.0-beta.19.
It accepts no production URL/credentials. A fresh PostgreSQL18.6 cluster binds
only127.0.0.1, uses ephemeral passwords and restricted test roles, then stops and
removes its data directory. All sender calls are fakes. No packages are installed.

The integration covers duplicate/no-refresh, conflict/replay/old sequences,
own-clock expiration, full source loss, stored corruption, six-way reservation,
lost secondary response, global cooldown, SQL enablement gates and runtime roles
unable to change approval flags/delete/backdate notices.

Before deployment: choose and verify external hosting/database; review exact
code/schema pins and baseline; provision scoped roles/auth with explicit approval;
wire native n8n ingress/SQL/notification nodes or an accepted external runtime;
accept real stopped-host and uncertain-send tests plus provider and phone receipt;
approve publication/cadence separately. A successful unit test or the earlier
one-shot review notification is not any of these runtime approvals.

Tele stays at the next planned release. No model or finalizer activation.

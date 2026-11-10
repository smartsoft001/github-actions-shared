# Concrete disabled observer plan — preparation, not authorization

Target: database `ai-os`; plain registry/heartbeats/reservations/notices/receipts.
Selected n8n credential is `MongoDB ai os (claude)` (bKjCNekrlGKLq8C2).
No credentials, users or database writes are created by this package.

`observer-production-binding-proposal.json` proposes a disabled production policy
for the exact two existing producers. Source lower bound remains the previously
reviewed 2026-11-09T00:00:00Z; this does not silently discard older unprocessed
errors at deployment. No production policy/journal exists yet in the inspected
server monitor state directory; this is a candidate, not an installed identity.
Canonical integer epoch seconds ensure Python/Node JSON roundtrips preserve the
binding (floating 1794182400.0 versus integer 1794182400 would change the digest).
Current pinned Python code verifies the binding in default PR CI. The same
candidate computed read-only from server main matches:

- Binding: `50167af8c101368654a483b6fa361db4b3ccadc7e808e99cfa6656c4c4c98909`
- Initial observer baseline: `2026-11-10T14:45:31.776Z`
- Exact plan SHA256: `05a87db0e6020eef2cb629138821e455fbe0445cd2ff86d493aeb05f7f9bc0fb`

`observer-production-initialization-plan.json` contains exact validators and three
seeds, production scope, all enable/readiness flags false, no users/roles. Changing
binding, baseline, schema or state changes the reviewed plan and requires renewed
review. Initialization never enables the monitor. Enabling later requires fresh
heartbeat acceptance and the separate host/ingress/fallback readiness gates.

## One-shot administrator entry

`mongodb-observer-admin.mjs` connects only on explicit inspect/initialize. It does
not pull/extract the n8n credential, register an endpoint, call a model, notify,
schedule or change runtime config. No CLI is run against live Mongo in this package.
Native n8n Mongo document operations do not provide the needed createCollection
validator bootstrap; do not replace it with insert-only auto-created collections.
This is a one-time administrative route, not n8n calling ai-os-server.

An approved administrator must provide an owner-only regular JSON config (0600,
not a symlink), outside Git:

```json
{
  "schema_version": 1,
  "database": "ai-os",
  "enabled": false,
  "driver_path": "/absolute/path/to/existing/node_modules/mongodb",
  "uri_file": "/absolute/path/to/private-mongo-uri.json",
  "plan_sha256": "05a87db0e6020eef2cb629138821e455fbe0445cd2ff86d493aeb05f7f9bc0fb"
}
```

The separately supplied owner-only JSON secret file has one `uri` field. Never
paste its value into chat/argv/Git or export credentials from n8n for convenience.
Use an approved existing administrator execution environment/access route. No
such file/access has been created or verified by this package.

```sh
# No connection, secret read or driver load:
node tools/development-admission/mongodb-observer-admin.mjs --check /absolute/private/admin.json
# Read-only namespace preflight; no writes:
node tools/development-admission/mongodb-observer-admin.mjs --inspect /absolute/private/admin.json
# Only after explicit approval of this exact plan and administrative route:
node tools/development-admission/mongodb-observer-admin.mjs --initialize /absolute/private/admin.json 05a87db0e6020eef2cb629138821e455fbe0445cd2ff86d493aeb05f7f9bc0fb
```

Approval/hash are validated before config/secret/driver/network access. `--check`
validates the private config without reading the URI. Real connections require TLS
with certificate/hostname validation, no read/write retries, selection timeout3s
and socket timeout5s. No credentials or connection/driver error detail is printed.
Any partial/uncertain initialize result requires manual inspection, never retry,
reset or drop. Initialization refuses any existing observer collection, even empty;
unrelated AI OS collections are preserved. Scope/admin role provisioning remains
separate and unexecuted. Runtime watch UPDATE retains its documented collection-level
limitation; this administrative route does not solve compromised runtime credentials.

## Evidence and next gate

46 authenticated localhost Mongo7.0.14 checks PASS;89 Node PASS. Concrete plan
initialized only in the ephemeral fixture; registry binding/disabled state verified
and observer refused manual-test bypass. Fresh fixture processes/data removed.
CLI approval refusal and private config/no-network check tested; live TLS handshake,
actual administrative scope and CLI writes are NOT accepted. Receipt:
`mongodb-admin-plan-local-receipt.json`.

Next: review this source/plan, identify the administrative execution environment,
confirm TLS/physical independence and scoped rights, then separately authorize a
read-only admin preflight followed by exact-plan initialization. No live writes,
publication, active n8n changes, services, model or finalizer activation here.
Tele acceptance remains at the next planned release.

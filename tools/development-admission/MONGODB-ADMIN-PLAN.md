> Current route verified on10November: existing Compass **Smartsoft** connection, integrated mongosh, database **ai-os**. No secret export or new private URIfile is needed for this route. The standalone driver CLI below remains an unaccepted alternative, not a blocker. No live initialization has occurred.

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
such file has been created; the Compass route verified below needs none.

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

Next: review this source/plan and the verified Compass route below; separately
authorize exact-plan initialization. Scoped runtime rights, TLS/physical independence
and runtime acceptance remain later gates. No live writes,
publication, active n8n changes, services, model or finalizer activation here.
Tele acceptance remains at the next planned release.

## Verified Compass route — read-only acceptance

User identified Smartsoft. Authenticated metadata inspection advertises create/insert/find
permissions and broader access; this is an administrative session, not an accepted
least-privilege runtime credential. One unrelated collection remains untouched. All
five observer names are absent. Exact-plan inspectCompass passed with SHA
05a87db0e6020eef2cb629138821e455fbe0445cd2ff86d493aeb05f7f9bc0fb and write_attempted=false.
No password/URI export, privilege grant, user creation or database write.

Actual Atlas refused listCollections name:$in with8000. Initializer now uses five
exact-name reads before any write; each closed cursor/namespace is verified. No
unrelated document reads or fallback to incomplete authorized-only collection lists.
Command port maps driver wtimeoutMS to raw-command wtimeout and rejects writeErrors,
writeConcernError, incomplete cursors or missing inserted count, even if ok=1.
See [Mongo insert command result semantics](https://www.mongodb.com/docs/manual/reference/command/insert/)
and [listCollections](https://www.mongodb.com/docs/manual/reference/command/listcollections/).

Use a freshly staged reviewed source tree to avoid require-cache drift. The following
read-only command works in Compass's existing authenticated mongosh context:

```js
const root = '/absolute/reviewed/source/tools/development-admission/';
const bridge = require(root + 'mongodb-observer-compass.cjs');
const proposal = require(root + 'observer-production-initialization-plan.json');
await bridge.inspectCompass(db.getSiblingDB('ai-os'), proposal);
```

Only after explicit approval of exact source head and plan, the separate write call is:

```js
await bridge.initializeCompass(db.getSiblingDB('ai-os'), proposal, {
  approved: true,
  planSha256: '05a87db0e6020eef2cb629138821e455fbe0445cd2ff86d493aeb05f7f9bc0fb'
});
```

No such write call has been executed. It creates only five validated collections/three
disabled seeds, no roles/users or activation. Any uncertain result is held for manual
review, never retried/reset.48 local Mongo checks/91 Node PASS, including raw-command
initialization/readback and conservative error handling. Actual Atlas writes, runtime
scopes, TLS properties and physical independence still need their own acceptance.
Receipt: mongodb-compass-preflight-receipt.json. Tele remains at planned release.

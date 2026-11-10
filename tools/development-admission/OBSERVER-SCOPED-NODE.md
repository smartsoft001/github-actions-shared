# Scoped MongoDB users and private n8n observer — preparation only

Development #29 was merged after CI42852499157 succeeded for exact e0014ef. Reopening
its PR retriggered missing CI; merge
3b9ad8a69fde94a04ad531e578895e8eec4d890b. Clean server main advanced ff-only; foundation PASS.
The previously accepted live ai-os initialization is preserved. Two custom roles
were created after owner approval; no database document writes, users, production
installation, workflow publication or model calls occurred.

## Accounts prepared, not created

`observer-scoped-access-plan.json` is a non-executable plan: Atlas project and target
cluster are unbound. `mongodb-observer-access.cjs` emits grouped Atlas role payloads
from the already tested collection role specifications. No password, API key, built-in
role inheritance, wildcard database/collection, DELETE, DDL or grant privileges.

| User | MongoDB privileges on ai-os |
|---|---|
| ai_os_observer_ingress | FIND registry; FIND/UPDATE heartbeats |
| ai_os_observer_watch | FIND registry/heartbeats; FIND/UPDATE reservations; FIND/INSERT notices/receipts |

Use two custom roles development_observer_ingress and development_observer_watch.
Users authenticate against admin and must be restricted to the selected Atlas
cluster; do not silently default to project-wide cluster access. Remove broad
built-in roles. Neither user may alter activation flags, recreate missing state,
read test/other databases or rewrite/delete append-only history. Mongo collection
UPDATE still permits field changes within mutable heartbeat/reservation collections;
this is not field-level protection from a compromised runtime credential.

Atlas lists both SCRAM users in Project 0, each with its matching custom role
in admin and access scoped to ClusterN8n. The roles grant privileges only on
the listed collections in ai-os. The target plan is declarative and keeps
`apply=false`. See `observer-scoped-atlas-preparation-receipt.json`.

Two n8n credential forms are prepared in Connection String mode for database
ai-os. Emil supplies the corresponding Atlas Drivers URI directly in each
form and saves it. Use the Atlas SRV address, authSource=admin, standard TLS
and URL-encoded username/password if required. Keep secrets in n8n. See
[n8n MongoDB credential setup](https://docs.n8n.io/integrations/builtin/credentials/mongodb/).

## Why a private node

The installed native Mongo1.4 source uses a single scalar update key, forces ObjectId
for _id, applies $set from input fields and discards findOneAndUpdate's returned result.
It cannot supply this adapter's revision CAS/update pipeline and durable result proof.
Do not substitute those operations or widen roles to accommodate $merge/upsert.

`DevelopmentObserver.node.js` wraps the existing MongoDB adapter through
`mongodb-observer-node-runtime.cjs`. n8n [supports programmatic private nodes](https://docs.n8n.io/connect/create-nodes/deploy-your-node/install-private-nodes.md).
This is source for review, not an installed extension or public npm package. The node
runs inside the n8n host, which must be independently accepted outside ai-os-server's
failure domain; there is no n8n→ai-os-server hook or extra public worker service.

Default preparedOnly=true stops before input, credentials, driver loading or network.
Future operation requires a reviewed credential ID matching the node binding; known
admin Mongo credential IDs are refused. A connectionStatus preflight must confirm
exact expected username, one custom role and exact effective collection privileges;
extra roles/actions/wildcards or swapped users fail before any state write. Actual
Atlas effective-privilege acceptance remains pending.

Only connection-string Mongo credentials with database ai-os and normal public CA TLS
are supported by this candidate. Pinned mongodb6.22.0, TLS cert/hostname checks,
read/write retries false, server-selection3s/socket5s. It never emits credentials,
URI, raw driver errors or documents. No hidden fallback to the broad admin credential.

Observe mode sends only via n8n's credential-aware Pushover HTTP helper after the
existing durable CAS and notice acknowledgement. Fixed endpoint, no redirects,
TLS verification, 10s deadline/AbortSignal and bounded response; recipient remains
private and unbound in these files. Credentials remain in n8n. Unknown delivery or
state errors fail the workflow without retry, retaining the reservation. Production
registry flags remain false, independently of preparedOnly.

## Wiring and installation artifacts

- `stage-observer-node.cjs /absolute/fresh/stage`: copies six explicit source files,
  file SHA256 manifest and private package metadata. No dependency download, install,
  environment update or service action. Existing destination refuses. Production
  image must supply pinned mongodb6.22.0 and compatible Node/n8n, then restart only
  after separate approval of the exact artifacts and hosting route.
- observer-ingress-prepared.workflow.json and observer-observe-prepared.workflow.json:
  disabled manual probes with preparedOnly=true, verifyOnly=true, and no credentials
  or schedule. Once the private node is available and its matching credential is
  bound, the manual probe can use preparedOnly=false and verifyOnly=true. It
  connects with TLS, checks connectionStatus and closes without accessing
  application collections or the Pushover route.
- observer-heartbeat-ingress-unpublished.workflow.json: disabled Header Auth webhook,
  unconditional preparation gate, bounded packet-only projection, guarded custom node
  and reply after durable ingress. Auth and Mongo credentials unbound; no live endpoint.
  Native Webhook/Code/Respond config validation passed; full HTTP acceptance pending.
- `observer-node-native.cjs /absolute/existing/n8n-installation`: opt-in isolated native
  loader test (existing Node24.16.0/n8n2.46.6). No host installation. Temporary SQLite/
  extensions removed after testing; OS sandbox refuses non-loopback networking.

Before rollout: save the two scoped n8n credentials, confirm the host and
private node deployment route, and stage the exact build. Bind each credential
in its own unpublished manual probe, then verify TLS and effective privileges
from the n8n host. Record the result and confirm host independence. HTTP route-specific 2048-byte body limit, Header Auth and
no-redirect client need independent acceptance before ingress publication. Never
remove guards or enable DB flags as an incidental install step. Publication/cadence
and paid/model/finalizer execution remain separate decisions; Tele at planned release.

## Evidence

59 authenticated localhost Mongo checks PASS, including real effective privilege
preflight, disabled-production refusal, one synthetic custom-node send, replay with
no second send and swapped-user denial. No cloud/provider/model calls. Native n8n
loaded the private class for both modes and returned prepared-disabled without any
credentials/driver. Two native cases, isolated networking and removed temp state.
Default PR CI runs all Python/Node tests; native sandbox and real Mongo integration
are opt-in. Real Atlas TLS/privileges, Pushover HTTP integration and production
installation are not yet accepted. Receipts: observer-scoped-node-local-receipt.json
and observer-node-native-receipt.json.

# Prepared database access and native n8n preflight

Read-only inventory on2026-11-10 found no PostgreSQL credentials or PostgreSQL-named
workflows visible to the current n8n integration. This is an access inventory, not
proof that no PostgreSQL server exists. Available technical runbooks did not name
the n8n infrastructure/DB host. Emil was asked for the hosting/service name and
admin access method, without passwords or tokens. Do not guess a server or use
n8n's own application database as observer storage.

## Concrete proposed database and principals

| Item | Prepared value | Initial state |
|---|---|---|
| Dedicated database | `ai_os_development_observer` | Not created on a live service |
| Owner | `development_observer_owner` | NOLOGIN; owns only the new DB/schema/tables |
| Ingress | `development_observer_ingress` | NOLOGIN; registry SELECT, latest SELECT/INSERT/UPDATE |
| Observer | `development_observer_watch` | NOLOGIN; registry/latest SELECT, bounded notice INSERT/receipt UPDATE |
| Passwords / write-only Header Auth | Separate scoped values after access approval | Not generated or bound |

All three roles are NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION/NOBYPASSRLS.
Runtime roles are not owner members. PUBLIC has no DB CONNECT/TEMP or schema
CREATE rights in this dedicated database. Runtime roles get CONNECT and schema
USAGE only; ingress cannot read notices and observer cannot change heartbeat,
activation flags, delete notices or backdate reservations. Statement/lock bounds
are3s and idle-in-transaction5s. These changes apply only to the new isolated DB.

`node tools/development-admission/observer-provisioning.cjs` prints a SQL bundle
for review; it has no connection or apply option. A DBA first creates the empty
dedicated database on the **confirmed external host**, then applies this bundle
there after approval. The bundle checks the exact database name, empty public
namespace and absent role names before any change. Creation is transactional.
Existing role/schema/state refuses the run; there is no DROP, reset, silent
migration, password generation or LOGIN enablement. Do not apply it to production
n8n/application/customer databases. SQL is generated from the pinned schema file.

Real LOGIN/password assignment is a separate access step after the target and
scope are approved. Enter those values through the DBA/n8n credential tools,
never Git, workflow parameters, command-line arguments, logs or chat. Owner stays
NOLOGIN. No admin credential should enter n8n.

## Native n8n readiness graph

`build-observer-db-preflight.cjs` emits a validated seven-node SDK graph:
manual trigger → preparation guard → ingress SELECT → assertion → observer
SELECT → assertion → safe readiness receipt. Trigger is disabled and guard throws
unconditionally. Both PostgreSQL2.7 nodes have3s connect timeout, no retries and
fixed metadata-only SELECT queries. No database selection or SQL comes from a
webhook/request. Assertions require the exact complete set of true checks.

The graph contains deliberately UNBOUND credential placeholders. It is a source
artifact, not a created workflow. Do not import it with automatic credential
assignment or replace missing credentials with an admin/existing unrelated one.
After approval and credential creation, bind exact IDs/names and read back the
two role identities while the trigger/guard/publication remain locked. Only a
separate controlled manual test may temporarily remove that guard; restore it.

Proposed credential fields after target confirmation:

- Shared confirmed external host/port and database `ai_os_development_observer`.
- Separate users above; separate password values; maxConnections1 each.
- TLS required with certificate verification; do not enable Ignore SSL Issues.
- No ai-os-server incoming hook/tunnel or public database-port opening by default.
- A dedicated heartbeat Header Auth belongs to the future receiver; never reuse
  the metadata-read key. Receiver and fallback runtime remain disabled/unbound.

## Real offline native evidence

`observer-provisioning-native.mjs` accepts only pre-existing local test runtime
installations: embedded-postgres18.6.0-beta.19 and n8n2.46.6 on Node24/macOS. It
creates a fresh loopback PostgreSQL cluster, applies the actual bundle, and checks
role boundaries. Only inside this disposable test does it assign ephemeral
passwords and LOGIN, import synthetic credentials into a fresh local n8n SQLite
and execute the real Postgres2.7 nodes. The n8n process has OS loopback-only network
and a fresh HOME; no owner/service credentials are inherited. No packages install.

Negative executions verify swapped credentials fail at the assertion before the
next DB node, and the real preparation guard stops before any SQL node. A positive
receipt reports both roles checked, write_operations0 and activatedfalse. This
does not seed/enable registry. Logs containing fixture credentials stay private;
only safe results are returned. Test server/SQLite/files are removed on exit.

Run with existing runtimes, not production endpoints:

```sh
node tools/development-admission/observer-provisioning-native.mjs /absolute/path/to/pg-installation /absolute/path/to/n8n-installation
```

This is provisioning/readiness preparation, not complete native ingress/watchdog
wiring or a production connection test. Actual host/DB ownership, access approval,
new scoped credentials, physical independence, native receiver/observer wiring,
real fallback/phone acceptance and publication/cadence remain separate gates.
No model or finalizer activation; Tele at the next planned release.

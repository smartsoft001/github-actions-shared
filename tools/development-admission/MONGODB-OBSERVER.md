# MongoDB external observer — preparation only

Emil selected MongoDB on 10 November 2026. This replaces the PostgreSQL access
proposal in Shared #19. Earlier merged PG code/SQL and its receipts remain
historical; they are not a deployment requirement or evidence for MongoDB.

`mongodb-observer.cjs` accepts an already authorized MongoClient. It opens no
connection, schedule, listener or credential. Namespace is fixed to
`ai_os_development_observer`. Reads require majority; writes require majority,
journaling and a 3s acknowledgement deadline. Both driver retry flags must be
false, connection selection <=5s and socket timeout <=10s. Production TLS and
physical separation from ai-os-server still require verification.

`mongodb-observer-schema.cjs` emits a reviewable specification only; no apply
operation or users/passwords. Registry and initial state are seeded disabled.
Five collections have strict validators and unique `_id`: registry, heartbeats,
reservations, notices and receipts. There is no TTL or automatic state recreation.
A controlled future installer must refuse an existing/nonempty namespace rather
than reset it. The current specification is not such an installer.

Separate ingress/watch roles may read registry but never modify activation flags.
Ingress updates only heartbeat state. Watch updates only reservation state and
may append/read notices/receipts; it cannot update/delete that history. No runtime
role creates collections/users or grants roles. Registry's validator also refuses
enabling without all three readiness confirmations.

Heartbeat and reservation updates each use a single-document revision CAS, not
multi-document transactions. Mongo server `$$NOW` supplies receipt/reservation time.
A repeated sequence does not refresh time; conflicts and missing state fail closed.
The observer reserves globally for 30 minutes, majority-reads the grant, and appends
an acknowledged notice before calling the injected sender. Concurrent losers do
not send. Unknown write/ack/delivery does not retry; committed reservations survive
lost responses. Provider receipts are separate append-only documents; provider
acceptance never establishes human phone receipt. Sender has a <=10s deadline.
A crash between reservation and send can suppress an alert: explicit conservative
at-most-one-attempt behavior, not exactly-once delivery or guaranteed delivery.

Mongo collection UPDATE privileges do not restrict fields. A compromised runtime
watch credential can rewrite mutable reservation state; the adapter CAS/server
clock is not a database-enforced ban on backdating. Append-only history and disabled
registry remain separately protected. Do not carry PG column-level claims forward.
Mongo [single-document atomicity](https://www.mongodb.com/docs/manual/core/write-operations-atomicity/)
is the mechanism used; no replica-set transaction requirement is introduced.

Read-only n8n inventory found credential `18`, `MongoDB cloud`. Its host, database,
privileges and failure domain are unverified. It is a candidate for administrative
review only; no secret read, binding, cloud connection or database write occurred.
Use two scoped credentials after confirming the target, not this unknown credential
as a shortcut. The previous request to provision PostgreSQL is superseded.

## Reproduce without cloud, model or real notification

Default PR CI runs `mongodb-observer.test.cjs` and historical protocol regression.
Opt-in integration uses an existing mongod and Node mongodb driver; no installation:

```sh
OBSERVER_TEST_MONGOD=/absolute/path/to/mongod \
OBSERVER_TEST_MONGODB_DRIVER=/absolute/path/to/node_modules/mongodb \
node tools/development-admission/mongodb-observer-local.mjs
```

The fixture starts authenticated loopback-only mongod in a fresh temporary directory,
creates temporary root and two scoped users, checks validators, actual privilege
denials, six-way concurrency, duplicate/no-refresh, replay/conflict, stale source,
cooldown, lost sender response and missing-state refusal. All notifications are
fake. It stops the server and removes its directory in finally. Receipt counts
are local-test evidence, not native n8n/cloud integration acceptance.

Remaining: confirm external Mongo hosting and reviewed administrative route;
prepare non-destructive provisioning and exact scoped credential preflight;
prepare native n8n ingress/watch/notification wiring and then separately authorize
manual acceptance, publication and cadence. Current plan stays disabled/unbound.
No active workflow changes, model, finalizer activation or Tele acceptance here.

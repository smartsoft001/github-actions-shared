# Prepared monitor heartbeat and delivery watchdog

`producer_monitor_health.py` is an offline, injected-port component. It does not
activate a monitor, access credentials, contact Pushover, publish n8n workflows,
start a service or register a schedule. Existing monitor core/cycle files and
their reservation database are unchanged; no migration or reset is performed.

## Separate evidence

| Evidence | Meaning | Does not prove |
|---|---|---|
| Fresh completed cycle | Monitor completed its control flow | No producer errors, or future availability |
| Fresh open cycle | Work is in progress | Successful completion |
| Primary `intent` | Attempt was reserved before calling the sender | Provider or phone receipt |
| Primary `accepted` with real request ID | Provider accepted a past message | Current credential readiness or human receipt |
| No attempts | Delivery has not been exercised | A healthy delivery path |

The health assessment always reports `human_receipt_verified=false` and
`production_acceptance=false`. Empty metadata does not generate a test message.
A later accepted attempt cannot conceal an older uncertain one. In particular,
a Keychain/credential error inside the primary delivery port leaves a committed
intent and becomes `delivery-unconfirmed`; it is not described as delivered.

## State and one-cycle wrapper

Provision three owner-only SQLite files explicitly, each in an owner-only
directory: the existing primary reservations, a new heartbeat journal, and a
**separate** watchdog outbox. Missing files are never automatically recreated.
The latter two bind the reviewed profile, core/cycle/health implementations and
deadlines. Enabling the same reviewed material preserves history; changed code
or policy needs a reviewed migration, not a fresh database to replay attempts.

`observed_cycle` commits a cycle start before the existing cycle can call reader
or sender. Completion references that exact run. An unfinished run survives a
restart and prevents overlapping work; another process cannot steal it or
refresh its heartbeat. A conflicting/replayed completion cannot advance time.
Exceptions record only a fixed failure classification, not their raw contents.
Disabled production performs no reader/sender calls or heartbeat provisioning,
even with the manual-test override. The override works only for an isolated
manual-test profile.

`assess` reads heartbeat and primary reservation files read-only. It distinguishes
never started, in progress, failed, overdue and stale cycles. A missing, corrupt,
insecure or incorrectly bound primary/heartbeat file produces an unavailable
assessment. Delivery inspection uses bounded constant memory with a 100,000-row
history ceiling; exceeding it fails closed rather than claiming health. This is
not a retention implementation or acceptance of a large production history.

## Independent observer and reservation

`watchdog_once` composes assessment with a distinct outbox and an injected
`deliver_secondary` callback. Its policy defaults to disabled. It can reserve an
alert even when both primary files are missing, because its outbox is separate.
A SQLite transaction commits intent before calling the secondary sender; six
competing observer processes get at most one grant. A single combined, bounded
message contains fixed descriptions and the fixed n8n origin only. No execution
payload, provider error, credential or caller-supplied URL is included.

Lost/rejected/malformed responses leave intent durable. No automatic retry or
blind rerun sends that notice again. A global 30-minute cooldown also covers
changed incidents and uncertain sends, not just the same incident. After that
period a continuing outage may produce a newly reserved reminder; it does not
retry or acknowledge the old uncertain intent. Actual provider status1/request
is required to acknowledge a notice. No alert is sent without the watchdog
outbox, or using an untrusted/regressing clock.

Proposed test defaults: completed heartbeat within180s, open cycle within60s,
provider acknowledgement within60s, cooldown1800s. These are reviewed proposal
values, **not a deployed cadence or measured production SLA**. SQL calls have a
3s lock timeout. The existing primary reader/sender still need independently
enforced network deadlines and no retries in their concrete adapters.

## Boundaries before any activation

The module does not establish physical independence of its injected sender or
scheduler. A process on ai-os-server cannot independently detect a complete
failure of that same host. Production therefore still needs an observer outside
the monitored failure domain, a separately accepted heartbeat transport and a
delivery route that does not share the primary credential/Keychain failure.
The local SQLite journal is a prepared local port, not a remote heartbeat API.
No new inbound ai-os-server hook, secret, database permission or service is created.

Likewise, a failed watchdog sender or unavailable outbox needs observation by its
eventual external supervisor. The return actions `unknown`, `outbox-unavailable`
and `clock-untrusted` must remain failures in that integration, never successful
health checks. Do not put this observer in the primary cycle's timer and call it
independent; do not infer active coverage from these offline tests.

Runtime acceptance must pin exact policy/code/state identities; demonstrate a
stopped primary, an uncertain primary send and a failed secondary route without
duplicates; verify actual provider receipt and separate human phone receipt;
then approve deployment/cadence explicitly. Existing Pushover Keychain access
from plain SSH was unavailable in the previous supervised session; this package
neither changes credentials nor claims that problem resolved.

## Offline verification

```sh
python3 -m unittest discover -s tools/development-admission -p 'test_producer_monitor_health.py'
```

Tests use temporary private databases, controlled clocks and fake senders. They
cover stalled/restarted work, lost/credential-failed delivery, separate missing
state, read-only assessment, clock reversal, durable uncertain notices,30-minute
cooldown and six concurrent OS processes. No model, API or real message is called.
Tele acceptance stays at its next planned release; finalizer remains disabled.

`python3 tools/development-admission/monitor-health-offline.py` also runs in PR CI.
It accepts no runtime profiles/paths/options and prints a synthetic receipt for
credential-failed primary delivery, one watchdog grant, duplicate suppression,
stalled work, missing primary files and a new reminder after1800s. The printed
provider receipts are fake; `real_provider_calls=0` and activation remains false.

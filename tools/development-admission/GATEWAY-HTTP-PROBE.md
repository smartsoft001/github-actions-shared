# Controlled gateway HTTP test — preparation only

Emil authorized merge/sync Shared #12 and Development #20 and preparation of this
test, explicitly without publication, trigger enable, model or finalizer. No HTTP
request, listener registration or workflow mutation was performed by preparation.

`python3 gateway_http_probe.py --plan` emits 13 named cases without opening a URL
or reading a token. The CLI rejects --run; there is no implicit execution path.
The explicit `perform_one` library port is prepared for a future supervised,
separately authorized native test-listener window. It uses only fixed HTTPS
/webhook-test/development-producer-metadata-v1, GET,10s timeout, no proxy from
environment, no redirect, no retry and a512KiB response cap. Tokens are read from
an owner-only nonsymlink file in a private directory; no credential in URL/args.
Output contains only case/outcome/status, no headers, raw error or response body.

## Cases and interpretation

- Missing and wrong Header Auth: expect401/403; never treat404 as rejection proof.
- Authenticated foreign workflow, success status, extra includeData, >24h range,
  stale upper bound: candidate refusal only on400/422/500. A response containing
  metadata is a failure. A500 alone does not prove which node failed.
- Both producers ×error/crashed/unknown: expect200 and exact bounded metadata
  schema, fresh observed_at, matching query scope/window, unique IDs and four
  exact row fields. Even an empty result must explicitly prove completeness.

There is no aggregate production PASS. Each result remains a candidate,
source_access_verified=false and production_acceptance=false. Node-path evidence
must be obtained safely before claiming negative cases avoided the source API.
Current draft saves no execution data; ordinary post-run metadata cannot show
node-path output. Do not enable raw execution logging to compensate, because the
webhook contains an authentication header. If safe node-path evidence is not
available, report that limitation and leave source non-access unverified.

## Exact boundary for a future test window

Current draft Ezm9n6EggooXhbam version7c9ca060-6a52-4143-a570-00ce32f03235 remains
unpublished, trigger-disabled and blocked by the preparation throw. A real HTTP
response cannot be tested through these locks. MCP execute_workflow with supplied
webhook data is not a substitute for real native HTTP Header Auth.

A future mandate must explicitly cover temporary enable of THIS DRAFT webhook,
removal of THIS preparation throw and a one-shot native test listener. No publish,
production webhook route, model, other workflow or finalizer. Re-read the exact
graph/credentials/settings/version before patching; stop on drift. A prepared
private proposal binds baselineSHA9536f83a35eb5a5cc7e190b7538bd8fc2fd6b92369b6850540a5044bf29bd2ca
and stores exact unlock/restore operations. It is not an approval or applied patch.

Register a new listener for each case if n8n consumes it after one request; never
assume the next request will reach the same draft. Refresh query times for every
request. Maximum13explicit requests for the complete case set, no automatic retry
of timeout/unknown outcome. Missing listener404/timeout is inconclusive, not pass.
After any failure or completion: stop the dedicated listener, restore the exact
preparation throw and disabled trigger, verify active=false/activeVersionId=null,
credential identity and unchanged read node/settings. Do not roll back using an
old full workflow version or affect other users' test listeners.

## Offline evidence

11 additional Python tests verify plan-only CLI, fixed endpoint/GET, authentication
cases, timeout/no-retry, no redirect forwarding,404/500 handling, privacy, bounded
responses, metadata schema and insecure token refusal. They use fixture transports,
not actual n8n, a local listener or the real secret. Full suite130Python +63Node PASS.
Real HTTP/authentication, installed REST pagination and independent liveness remain
unverified; production rollout gate is unchanged.

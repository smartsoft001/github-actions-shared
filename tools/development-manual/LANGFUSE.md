# Standalone Langfuse transport — staged

`langfuse_transport.py` is a standard-library, metadata-only transport. It is not connected to `manual.py`; `LANGFUSE_ADAPTER_IMPLEMENTED=False`, the disabled callers and all model/merge gates remain unchanged. Importing the module performs no I/O. There is no CLI, environment-variable credential discovery, automatic project selection, SDK installation or background exporter. This package has not written to Langfuse or run a model.

The only permitted origin is `https://langfuse.smartsoft.biz.pl`. A future, separately accepted caller supplies an operator-approved project ID and project-scoped public/secret keys directly in memory. The keys must come from the dedicated environment; this module neither obtains nor logs them. Project verification is mandatory before any POST. Credentials, response bodies, prompts, code, diffs, findings, raw CLI output and stderr never belong in telemetry receipts.

## Input and usage semantics

`Publisher(HTTPTransport(public_key, secret_key)).publish(project_id, event)` returns either an acknowledged receipt or a blocked local status. This API is a write capability and must only be called by the future approved integration. Tests use a synthetic in-memory transport instead.

The event has exactly these fields:

- `schema_version=1`, `repository`, numeric `repository_id`, `execution_sha`, numeric `run_id` and `run_attempt`.
- `subject_head_sha`, `subject_base_sha`, `subject_sha256`, canonical UUID `session_id`.
- UTC `started_at` / `ended_at` (seconds or milliseconds, maximum one-hour interval).
- `result_code`: `passed`, `findings`, `error`, `timeout` or `canceled`; no free-form error message.
- `cli_total_cost_usd_estimate` and `model_usage` for 1–8 safe model names.

Every model requires `inputTokens`, `outputTokens`, `cacheReadInputTokens`, `cacheCreationInputTokens` and `costUSD`. The only optional metrics are `webSearchRequests`, `contextWindow` and `maxOutputTokens`; they go into metadata, not token buckets. Unknown fields, missing counters, booleans, negative/non-finite numbers and unsafe identifiers block before HTTP. No provider-count guessing or silent removal of unknown usage fields occurs.

This contract assumes Claude's **uncached** `inputTokens`. OTLP usage stores four disjoint buckets: `input`, `output`, `cache_read_input_tokens`, `cache_creation_input_tokens`; `total` is their sum. Inclusive provider counts must be normalized upstream under a different accepted contract. Each model's cost estimate goes only on its generation. The aggregate CLI estimate appears only in root metadata, with `billing_verified=false` and `cost_source=claude-cli-estimate`; it is neither an invoice nor a hard spending limit. [Langfuse token and cost semantics](https://langfuse.com/docs/observability/features/token-and-cost-tracking).

## Wire protocol and verification

The sequence is project GET → bounded existing-trace read → at most one POST → bounded readback. Paths are restricted to:

1. `GET /api/public/projects`: requires exactly one project matching the approved ID.
2. `POST /api/public/otel/v1/traces`: OTLP JSON, Basic authentication and `x-langfuse-ingestion-version: 4`.
3. `GET /api/public/v2/observations`: exact trace ID, fields `core,basic,metadata,model,usage`, a bounded time interval and limit 9. No `io` fields or cursor traversal.

The payload contains one root `span` and one `generation` per model, using lowercase OTLP type attributes. IDs are deterministic hex hashes of project/execution/subject/session identity, with model-specific child IDs. A separate binding hash covers the complete approved event, including timestamps and usage. Metadata values are flat and below 200 characters. [Official OTLP mapping](https://langfuse.com/integrations/native/opentelemetry), [Public API](https://langfuse.com/docs/api-and-data-platform/features/public-api).

Only a 200 response with an empty JSON object counts as full transport acceptance. Partial success (even a zero-rejection partial envelope), an unknown schema, an empty body or a timeout never counts as verified ingestion. After acceptance, at most three observation GETs are made, with 0.2-second gaps. Every expected row must match project, trace/span IDs, parent/root/type, session, timestamps, binding metadata, model, exact usage and cost. Duplicate rows, pagination, stale/spoofed bindings and unexpected content block. A temporarily missing subset can only be polled after this object's successful POST; a pre-existing partial trace blocks without writing.

A receipt becomes `acknowledged=true` and `readback_verified=true` only after complete comparison. It carries root and generation IDs, project/origin, run/attempt, execution/subject/session hashes and model-usage hash. It always has `merge_eligible=false` and `billing_verified=false`. It proves matching telemetry was read, not authority to run the model or merge code. The future pinned producer must own this receipt; caller-supplied JSON is not proof.

## Transport and replay limits

`http.client.HTTPSConnection` uses a fixed TLS host/port with certificate verification. It has no redirect following or environment-proxy handling. Automatic reconnect is disabled (`auto_open=False`): a deadline close between the guard and send cannot open a replacement socket. Only the closed method/path/query list is allowed. Request and response bodies are limited to 128 KiB; compressed responses, duplicate JSON keys and non-finite JSON values are rejected. Socket/connect timeout is eight seconds, with an independent timer closing this request's connection. System DNS resolution can outlive Python's socket timeout; an expired resolution cannot proceed to sending the request. There is no automatic write retry.

A publisher-local lock and attempted-ID set prevent a second POST after partial/unknown outcomes, including concurrent calls on the same object. An exact existing trace can be verified without POST. These are not a durable ledger or a cross-process exactly-once guarantee: after restart or across concurrent processes, a missing delayed trace does not prove no earlier write occurred. The future integration must retain its single-run mandate and treat an uncertain write as requiring read-only/operator reconciliation, never automatic redispatch.

Blocked results contain fixed reason codes, `post_attempted` and `write_status` (`not_started`, `unknown`, `partial` or `accepted_unverified`). They are local diagnostics with no authority. Raw exceptions and remote error text are discarded. Existing deployed Langfuse v4.20.0 must still be tested for these shapes under a separately authorized metadata-only write/readback; offline fixtures are not that acceptance. No legacy ingestion endpoint or Airtable path is used.

## Offline validation

```sh
python3 -m unittest discover -s tools/development-manual -p test_langfuse_transport.py -v
python3 -m py_compile tools/development-manual/langfuse_transport.py
```

Tests intercept HTTP in memory and exercise the concrete HTTPS boundary with a fake connection. They perform no external requests, credential lookup, model invocation or filesystem writes outside Python's ordinary test/cache behavior. Fixtures cover multi-model accounting, deterministic IDs, exact replay, partial/timeout outcomes, spoofed readback, project mismatch, secret-like extra fields, unknown counters, redirect/path attacks, oversized/invalid responses and sanitized exceptions.

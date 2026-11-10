-- Prepared schema only. No roles, grants, secrets, schedules or live provisioning.
CREATE TABLE development_observer_registry (
    monitor_id text PRIMARY KEY CHECK (monitor_id = 'development-producers'),
    scope text NOT NULL CHECK (scope IN ('production', 'manual-test')),
    binding_sha256 text NOT NULL CHECK (binding_sha256 ~ '^[a-f0-9]{64}$'),
    enabled boolean NOT NULL DEFAULT false,
    ingress_verified boolean NOT NULL DEFAULT false,
    external_host_verified boolean NOT NULL DEFAULT false,
    fallback_verified boolean NOT NULL DEFAULT false,
    observe_since timestamptz NOT NULL CHECK (isfinite(observe_since)),
    CHECK (NOT enabled OR (ingress_verified AND external_host_verified AND fallback_verified))
);

CREATE TABLE development_observer_latest (
    monitor_id text PRIMARY KEY REFERENCES development_observer_registry,
    sequence bigint NOT NULL CHECK (sequence > 0),
    cycle_id text NOT NULL CHECK (cycle_id ~ '^[a-f0-9]{32}$'),
    cycle_finished_at timestamptz NOT NULL CHECK (isfinite(cycle_finished_at)),
    sent_at timestamptz NOT NULL CHECK (isfinite(sent_at)),
    received_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(received_at)),
    packet_sha256 text NOT NULL CHECK (packet_sha256 ~ '^[a-f0-9]{64}$'),
    packet jsonb NOT NULL CHECK (jsonb_typeof(packet) = 'object'),
    CHECK (cycle_finished_at <= sent_at)
);

CREATE TABLE development_observer_notices (
    notice_id text PRIMARY KEY CHECK (notice_id ~ '^[a-f0-9]{64}$'),
    monitor_id text NOT NULL REFERENCES development_observer_registry,
    attempted_at timestamptz NOT NULL DEFAULT clock_timestamp() CHECK (isfinite(attempted_at)),
    status text NOT NULL CHECK (status IN ('intent', 'accepted')),
    request_id text,
    CHECK ((status = 'intent' AND request_id IS NULL) OR
           (status = 'accepted' AND request_id ~ '^[A-Za-z0-9-]{8,100}$'))
);

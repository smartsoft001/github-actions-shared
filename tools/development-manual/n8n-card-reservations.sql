CREATE TABLE IF NOT EXISTS development_card_markers (
    card_id uuid NOT NULL,
    marker text NOT NULL,
    reserved_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (card_id, marker)
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" VARCHAR(100) NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error_code" VARCHAR(100),
    "locked_at" TIMESTAMPTZ(3),
    "locked_by" VARCHAR(100),
    "processed_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "outbox_events_schema_version_positive" CHECK ("schema_version" > 0),
    CONSTRAINT "outbox_events_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
    CONSTRAINT "outbox_events_payload_object" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "outbox_events_terminal_state_exclusive" CHECK (num_nonnulls("processed_at", "canceled_at") <= 1)
);

CREATE INDEX "outbox_events_pending_idx"
ON "outbox_events" ("next_attempt_at", "available_at", "id")
WHERE "processed_at" IS NULL AND "canceled_at" IS NULL;

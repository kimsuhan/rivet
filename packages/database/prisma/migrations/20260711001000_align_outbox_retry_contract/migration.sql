ALTER TABLE "outbox_events"
    DROP COLUMN "schema_version",
    ALTER COLUMN "next_attempt_at" DROP NOT NULL;

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_payload_schema_version_number"
    CHECK (jsonb_typeof("payload" -> 'schemaVersion') = 'number');

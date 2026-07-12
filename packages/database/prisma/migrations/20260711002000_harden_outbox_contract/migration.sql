ALTER TABLE "outbox_events"
    ALTER COLUMN "next_attempt_at" DROP DEFAULT,
    DROP CONSTRAINT "outbox_events_payload_schema_version_number";

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_payload_schema_version_integer"
    CHECK (
        CASE
            WHEN jsonb_typeof("payload" -> 'schemaVersion') = 'number'
                THEN ("payload" ->> 'schemaVersion')::numeric =
                     trunc(("payload" ->> 'schemaVersion')::numeric)
            ELSE FALSE
        END
    );

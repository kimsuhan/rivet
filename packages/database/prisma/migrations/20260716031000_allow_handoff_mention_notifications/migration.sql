ALTER TABLE "notifications"
  DROP CONSTRAINT "notifications_handoff_anchor_consistent";

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_handoff_anchor_consistent" CHECK (
    (
      "type" IN (
        'API_HANDOFF_CREATED'::"NotificationType",
        'API_HANDOFF_FOLLOW_UP_CREATED'::"NotificationType"
      )
      AND "handoff_id" IS NOT NULL
      AND "comment_id" IS NULL
    )
    OR (
      "type" = 'MENTIONED'::"NotificationType"
      AND ("handoff_id" IS NULL OR "comment_id" IS NULL)
    )
    OR (
      "type" NOT IN (
        'API_HANDOFF_CREATED'::"NotificationType",
        'API_HANDOFF_FOLLOW_UP_CREATED'::"NotificationType",
        'MENTIONED'::"NotificationType"
      )
      AND "handoff_id" IS NULL
    )
  );

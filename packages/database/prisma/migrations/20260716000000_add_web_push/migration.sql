CREATE TYPE "WebPushBrowser" AS ENUM ('CHROME', 'EDGE', 'FIREFOX', 'SAFARI', 'OTHER');
CREATE TYPE "WebPushSubscriptionStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'EXPIRED');
CREATE TYPE "WebPushDeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

CREATE TABLE "web_push_subscriptions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "browser" "WebPushBrowser" NOT NULL,
    "endpoint_hash" CHAR(64) NOT NULL,
    "endpoint" TEXT,
    "p256dh" TEXT,
    "auth" TEXT,
    "expiration_time" TIMESTAMPTZ(3),
    "status" "WebPushSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_succeeded_at" TIMESTAMPTZ(3),
    "last_failed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(100),
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_push_subscriptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "web_push_subscriptions_active_material_check" CHECK (
      "status" <> 'ACTIVE' OR (
        "endpoint" IS NOT NULL AND
        "p256dh" IS NOT NULL AND
        "auth" IS NOT NULL AND
        "disabled_at" IS NULL
      )
    )
);

CREATE TABLE "web_push_deliveries" (
    "id" UUID NOT NULL,
    "notification_id" UUID,
    "outbox_event_id" UUID,
    "subscription_id" UUID NOT NULL,
    "status" "WebPushDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "web_push_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "web_push_deliveries_source_check" CHECK (
      ("notification_id" IS NOT NULL)::int + ("outbox_event_id" IS NOT NULL)::int = 1
    )
);

CREATE UNIQUE INDEX "web_push_subscriptions_workspace_id_id_key"
ON "web_push_subscriptions"("workspace_id", "id");
CREATE UNIQUE INDEX "web_push_subscriptions_membership_id_endpoint_hash_key"
ON "web_push_subscriptions"("membership_id", "endpoint_hash");
CREATE UNIQUE INDEX "web_push_subscriptions_active_endpoint_hash_key"
ON "web_push_subscriptions"("endpoint_hash") WHERE "status" = 'ACTIVE';
CREATE INDEX "web_push_subscriptions_workspace_id_membership_id_status_created_at_id_idx"
ON "web_push_subscriptions"("workspace_id", "membership_id", "status", "created_at", "id");
CREATE INDEX "web_push_subscriptions_session_id_status_idx"
ON "web_push_subscriptions"("session_id", "status");

CREATE UNIQUE INDEX "web_push_deliveries_notification_id_subscription_id_key"
ON "web_push_deliveries"("notification_id", "subscription_id");
CREATE UNIQUE INDEX "web_push_deliveries_outbox_event_id_subscription_id_key"
ON "web_push_deliveries"("outbox_event_id", "subscription_id");
CREATE INDEX "web_push_deliveries_subscription_id_status_created_at_id_idx"
ON "web_push_deliveries"("subscription_id", "status", "created_at", "id");

ALTER TABLE "web_push_subscriptions"
ADD CONSTRAINT "web_push_subscriptions_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "web_push_subscriptions"
ADD CONSTRAINT "web_push_subscriptions_workspace_id_membership_id_fkey"
FOREIGN KEY ("workspace_id", "membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "web_push_subscriptions"
ADD CONSTRAINT "web_push_subscriptions_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "web_push_deliveries"
ADD CONSTRAINT "web_push_deliveries_notification_id_fkey"
FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_deliveries"
ADD CONSTRAINT "web_push_deliveries_outbox_event_id_fkey"
FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "web_push_deliveries"
ADD CONSTRAINT "web_push_deliveries_subscription_id_fkey"
FOREIGN KEY ("subscription_id") REFERENCES "web_push_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

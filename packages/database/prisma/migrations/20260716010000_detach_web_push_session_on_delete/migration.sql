ALTER TABLE "web_push_subscriptions"
  DROP CONSTRAINT "web_push_subscriptions_session_id_fkey";

ALTER TABLE "web_push_subscriptions"
  ALTER COLUMN "session_id" DROP NOT NULL;

ALTER TABLE "web_push_subscriptions"
  ADD CONSTRAINT "web_push_subscriptions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "mentions"
  ADD COLUMN "team_work_id" UUID,
  ADD COLUMN "api_handoff_id" UUID;

ALTER TABLE "mentions"
  ADD CONSTRAINT "mentions_single_content_anchor"
  CHECK (num_nonnulls("comment_id", "team_work_id", "api_handoff_id") <= 1);

DROP INDEX "mentions_description_membership_key";

CREATE UNIQUE INDEX "mentions_description_membership_key"
  ON "mentions"("issue_id", "mentioned_membership_id")
  WHERE "comment_id" IS NULL
    AND "team_work_id" IS NULL
    AND "api_handoff_id" IS NULL;

CREATE UNIQUE INDEX "mentions_team_work_id_mentioned_membership_id_key"
  ON "mentions"("team_work_id", "mentioned_membership_id");

CREATE UNIQUE INDEX "mentions_api_handoff_id_mentioned_membership_id_key"
  ON "mentions"("api_handoff_id", "mentioned_membership_id");

ALTER TABLE "mentions"
  ADD CONSTRAINT "mentions_workspace_id_issue_id_team_work_id_fkey"
  FOREIGN KEY ("workspace_id", "issue_id", "team_work_id")
  REFERENCES "team_works"("workspace_id", "issue_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mentions"
  ADD CONSTRAINT "mentions_workspace_id_issue_id_api_handoff_id_fkey"
  FOREIGN KEY ("workspace_id", "issue_id", "api_handoff_id")
  REFERENCES "api_handoffs"("workspace_id", "issue_id", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

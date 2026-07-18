CREATE TYPE "FeedbackCategory" AS ENUM ('BUG', 'USABILITY', 'IDEA', 'OTHER');
CREATE TYPE "FeedbackStatus" AS ENUM ('RECEIVED', 'IN_REVIEW', 'IMPLEMENTED', 'DEFERRED');

CREATE TABLE "product_feedback" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "submitted_by_membership_id" UUID NOT NULL,
  "category" "FeedbackCategory" NOT NULL,
  "body" TEXT NOT NULL,
  "current_path" VARCHAR(2048) NOT NULL,
  "release_id" VARCHAR(100) NOT NULL,
  "status" "FeedbackStatus" NOT NULL DEFAULT 'RECEIVED',
  "status_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status_changed_by_membership_id" UUID,
  "retention_expires_at" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "product_feedback_workspace_id_id_key"
  ON "product_feedback"("workspace_id", "id");
CREATE UNIQUE INDEX "product_feedback_workspace_submitter_submission_key"
  ON "product_feedback"("workspace_id", "submitted_by_membership_id", "submission_id");
CREATE INDEX "product_feedback_workspace_status_created_at_idx"
  ON "product_feedback"("workspace_id", "status", "created_at", "id");
CREATE INDEX "product_feedback_retention_expires_at_idx"
  ON "product_feedback"("retention_expires_at", "id");

ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_workspace_submitter_fkey"
  FOREIGN KEY ("workspace_id", "submitted_by_membership_id")
  REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "product_feedback"
  ADD CONSTRAINT "product_feedback_workspace_status_changer_fkey"
  FOREIGN KEY ("workspace_id", "status_changed_by_membership_id")
  REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TYPE "IssueStatus" AS ENUM (
    'UNSORTED',
    'TODO',
    'IN_PROGRESS',
    'REVIEW',
    'DONE',
    'PAUSED',
    'CANCELED'
);

ALTER TABLE "notifications" DROP CONSTRAINT "notifications_handoff_anchor_consistent";

BEGIN;
CREATE TYPE "NotificationType_new" AS ENUM (
    'TEAM_WORK_ASSIGNED',
    'MENTIONED',
    'COMMENT_ADDED',
    'ISSUE_COMPLETED',
    'ISSUE_CANCELED',
    'API_HANDOFF_CREATED',
    'API_HANDOFF_FOLLOW_UP_CREATED'
);
ALTER TABLE "notifications"
ALTER COLUMN "type" TYPE "NotificationType_new"
USING (
    CASE "type"::text
        WHEN 'ISSUE_ASSIGNED' THEN 'TEAM_WORK_ASSIGNED'
        ELSE "type"::text
    END
)::"NotificationType_new";
ALTER TYPE "NotificationType" RENAME TO "NotificationType_old";
ALTER TYPE "NotificationType_new" RENAME TO "NotificationType";
DROP TYPE "NotificationType_old";
COMMIT;

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
        "type" NOT IN (
            'API_HANDOFF_CREATED'::"NotificationType",
            'API_HANDOFF_FOLLOW_UP_CREATED'::"NotificationType"
        )
        AND "handoff_id" IS NULL
    )
);

-- 개발 단계 전환이므로 구형 이슈·팀 작업 데이터는 보존하지 않는다.
DELETE FROM "issue_block_relations";
DELETE FROM "issues";

ALTER TABLE "issue_block_relations" DROP CONSTRAINT "issue_block_relations_workspace_id_blocked_issue_id_fkey";
ALTER TABLE "issue_block_relations" DROP CONSTRAINT "issue_block_relations_workspace_id_blocking_issue_id_fkey";
ALTER TABLE "issue_block_relations" DROP CONSTRAINT "issue_block_relations_workspace_id_created_by_membership_i_fkey";
ALTER TABLE "issue_block_relations" DROP CONSTRAINT "issue_block_relations_workspace_id_fkey";
ALTER TABLE "issues" DROP CONSTRAINT "issues_workspace_id_project_id_parent_issue_id_fkey";
ALTER TABLE "issues" DROP CONSTRAINT "issues_workspace_id_project_id_project_role_team_id_fkey";
ALTER TABLE "issues" DROP CONSTRAINT "issues_workspace_id_team_id_assignee_membership_id_fkey";
ALTER TABLE "issues" DROP CONSTRAINT "issues_workspace_id_team_id_fkey";
ALTER TABLE "issues" DROP CONSTRAINT "issues_workspace_id_team_id_workflow_state_id_fkey";

DROP INDEX "api_handoffs_issue_id_sequence_number_key";
DROP INDEX "issues_team_id_sequence_number_key";
DROP INDEX "issues_workspace_id_assignee_membership_id_updated_at_id_idx";
DROP INDEX "issues_workspace_id_feature_status_id_idx";
DROP INDEX "issues_workspace_id_project_id_parent_issue_id_id_idx";
DROP INDEX "issues_workspace_id_project_role_id_idx";
DROP INDEX "issues_workspace_id_team_id_updated_at_id_idx";
DROP INDEX "issues_workspace_id_workflow_state_id_id_idx";

CREATE TABLE "team_works" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "identifier" VARCHAR(32) NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "project_role" "ProjectRole" NOT NULL,
    "team_id" UUID NOT NULL,
    "workflow_state_id" UUID NOT NULL,
    "assignee_membership_id" UUID,
    "scope_note" VARCHAR(2000),
    "created_by_membership_id" UUID NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "team_works_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_work_relations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "blocking_team_work_id" UUID NOT NULL,
    "blocked_team_work_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_work_relations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "team_work_relations_distinct_works" CHECK ("blocking_team_work_id" <> "blocked_team_work_id")
);

CREATE TABLE "api_handoff_targets" (
    "workspace_id" UUID NOT NULL,
    "handoff_id" UUID NOT NULL,
    "team_work_id" UUID NOT NULL,
    CONSTRAINT "api_handoff_targets_pkey" PRIMARY KEY ("handoff_id", "team_work_id")
);

ALTER TABLE "activity_events" ADD COLUMN "team_work_id" UUID;
ALTER TABLE "comments" ADD COLUMN "team_work_id" UUID;
ALTER TABLE "notifications" ADD COLUMN "team_work_id" UUID;
ALTER TABLE "api_handoffs" ADD COLUMN "source_team_work_id" UUID NOT NULL;

ALTER TABLE "comments" DROP CONSTRAINT "comments_workspace_id_issue_id_fkey";
ALTER TABLE "mentions" DROP CONSTRAINT "mentions_workspace_id_issue_id_fkey";
ALTER TABLE "issue_file_attachments" DROP CONSTRAINT "issue_file_attachments_workspace_id_issue_id_fkey";
ALTER TABLE "issue_labels" DROP CONSTRAINT "issue_labels_workspace_id_issue_id_fkey";
ALTER TABLE "issue_subscriptions" DROP CONSTRAINT "issue_subscriptions_workspace_id_issue_id_fkey";
ALTER TABLE "activity_events" DROP CONSTRAINT "activity_events_workspace_id_issue_id_fkey";
ALTER TABLE "api_handoffs" DROP CONSTRAINT "api_handoffs_workspace_id_issue_id_fkey";
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_workspace_id_issue_id_fkey";

ALTER TABLE "issues"
    DROP COLUMN "assignee_membership_id",
    DROP COLUMN "parent_issue_id",
    DROP COLUMN "project_role",
    DROP COLUMN "team_id",
    DROP COLUMN "type",
    DROP COLUMN "workflow_state_id",
    ADD COLUMN "status" "IssueStatus";

UPDATE "issues"
SET "status" = COALESCE("feature_status"::text::"IssueStatus", 'UNSORTED'::"IssueStatus");

ALTER TABLE "issues"
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "status" SET DEFAULT 'UNSORTED',
    ALTER COLUMN "project_id" SET NOT NULL,
    DROP COLUMN "feature_status";

ALTER TABLE "workspaces" RENAME COLUMN "next_feature_issue_number" TO "next_issue_number";
DROP TABLE "issue_block_relations";
DROP TYPE "FeatureIssueStatus";
DROP TYPE "IssueType";

CREATE INDEX "team_works_workspace_id_issue_id_deleted_at_updated_at_id_idx" ON "team_works"("workspace_id", "issue_id", "deleted_at", "updated_at", "id");
CREATE INDEX "team_works_workspace_id_team_id_deleted_at_updated_at_id_idx" ON "team_works"("workspace_id", "team_id", "deleted_at", "updated_at", "id");
CREATE INDEX "team_works_workspace_id_assignee_membership_id_deleted_at_u_idx" ON "team_works"("workspace_id", "assignee_membership_id", "deleted_at", "updated_at", "id");
CREATE INDEX "team_works_workspace_id_workflow_state_id_id_idx" ON "team_works"("workspace_id", "workflow_state_id", "id");
CREATE INDEX "team_works_workspace_id_project_role_id_idx" ON "team_works"("workspace_id", "project_role", "id");
CREATE UNIQUE INDEX "team_works_workspace_id_id_key" ON "team_works"("workspace_id", "id");
CREATE UNIQUE INDEX "team_works_workspace_id_issue_id_id_key" ON "team_works"("workspace_id", "issue_id", "id");
CREATE UNIQUE INDEX "team_works_team_id_sequence_number_key" ON "team_works"("team_id", "sequence_number");
CREATE INDEX "team_work_relations_workspace_id_blocked_team_work_id_creat_idx" ON "team_work_relations"("workspace_id", "blocked_team_work_id", "created_at", "id");
CREATE INDEX "team_work_relations_workspace_id_blocking_team_work_id_crea_idx" ON "team_work_relations"("workspace_id", "blocking_team_work_id", "created_at", "id");
CREATE UNIQUE INDEX "team_work_relations_workspace_id_id_key" ON "team_work_relations"("workspace_id", "id");
CREATE UNIQUE INDEX "team_work_relations_blocking_team_work_id_blocked_team_work_key" ON "team_work_relations"("blocking_team_work_id", "blocked_team_work_id");
CREATE INDEX "api_handoff_targets_workspace_id_team_work_id_handoff_id_idx" ON "api_handoff_targets"("workspace_id", "team_work_id", "handoff_id");
CREATE INDEX "activity_events_workspace_id_team_work_id_created_at_id_idx" ON "activity_events"("workspace_id", "team_work_id", "created_at", "id");
CREATE UNIQUE INDEX "api_handoffs_source_team_work_id_sequence_number_key" ON "api_handoffs"("source_team_work_id", "sequence_number");
CREATE UNIQUE INDEX "api_handoffs_source_initial_key" ON "api_handoffs"("source_team_work_id") WHERE "kind" = 'INITIAL'::"HandoffKind";
CREATE INDEX "comments_workspace_id_team_work_id_created_at_id_idx" ON "comments"("workspace_id", "team_work_id", "created_at", "id");
CREATE INDEX "issues_workspace_id_status_updated_at_id_idx" ON "issues"("workspace_id", "status", "updated_at", "id");
CREATE INDEX "issues_workspace_id_project_id_updated_at_id_idx" ON "issues"("workspace_id", "project_id", "updated_at", "id");
CREATE INDEX "notifications_workspace_id_team_work_id_created_at_id_idx" ON "notifications"("workspace_id", "team_work_id", "created_at", "id");

ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_team_id_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_team_id_workflow_state_id_fkey" FOREIGN KEY ("workspace_id", "team_id", "workflow_state_id") REFERENCES "workflow_states"("workspace_id", "team_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_team_id_assignee_membership_id_fkey" FOREIGN KEY ("workspace_id", "team_id", "assignee_membership_id") REFERENCES "team_members"("workspace_id", "team_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_works" ADD CONSTRAINT "team_works_workspace_id_created_by_membership_id_fkey" FOREIGN KEY ("workspace_id", "created_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_work_relations" ADD CONSTRAINT "team_work_relations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_work_relations" ADD CONSTRAINT "team_work_relations_workspace_id_blocking_team_work_id_fkey" FOREIGN KEY ("workspace_id", "blocking_team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_work_relations" ADD CONSTRAINT "team_work_relations_workspace_id_blocked_team_work_id_fkey" FOREIGN KEY ("workspace_id", "blocked_team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_work_relations" ADD CONSTRAINT "team_work_relations_workspace_id_created_by_membership_id_fkey" FOREIGN KEY ("workspace_id", "created_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_handoffs" ADD CONSTRAINT "api_handoffs_workspace_id_issue_id_source_team_work_id_fkey" FOREIGN KEY ("workspace_id", "issue_id", "source_team_work_id") REFERENCES "team_works"("workspace_id", "issue_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_handoff_targets" ADD CONSTRAINT "api_handoff_targets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_handoff_targets" ADD CONSTRAINT "api_handoff_targets_workspace_id_handoff_id_fkey" FOREIGN KEY ("workspace_id", "handoff_id") REFERENCES "api_handoffs"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_handoff_targets" ADD CONSTRAINT "api_handoff_targets_workspace_id_team_work_id_fkey" FOREIGN KEY ("workspace_id", "team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments" ADD CONSTRAINT "comments_workspace_id_team_work_id_fkey" FOREIGN KEY ("workspace_id", "team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments" ADD CONSTRAINT "issue_file_attachments_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_team_work_id_fkey" FOREIGN KEY ("workspace_id", "team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_handoffs" ADD CONSTRAINT "api_handoffs_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_team_work_id_fkey" FOREIGN KEY ("workspace_id", "team_work_id") REFERENCES "team_works"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

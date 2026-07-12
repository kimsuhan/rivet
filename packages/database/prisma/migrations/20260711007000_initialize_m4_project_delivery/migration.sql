CREATE TYPE "FeatureIssueStatus" AS ENUM (
    'UNSORTED',
    'TODO',
    'IN_PROGRESS',
    'REVIEW',
    'DONE',
    'PAUSED',
    'CANCELED'
);
CREATE TYPE "ProjectRole" AS ENUM ('BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND');
CREATE TYPE "ProjectStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "HandoffKind" AS ENUM ('INITIAL', 'FOLLOW_UP');
CREATE TYPE "NotificationType" AS ENUM (
    'ISSUE_ASSIGNED',
    'MENTIONED',
    'COMMENT_ADDED',
    'ISSUE_COMPLETED',
    'ISSUE_CANCELED',
    'API_HANDOFF_CREATED',
    'API_HANDOFF_FOLLOW_UP_CREATED'
);

ALTER TABLE "activity_events"
    ADD COLUMN "project_id" UUID,
    ALTER COLUMN "issue_id" DROP NOT NULL;

ALTER TABLE "issues"
    ADD COLUMN "feature_status" "FeatureIssueStatus",
    ADD COLUMN "parent_issue_id" UUID,
    ADD COLUMN "project_id" UUID,
    ADD COLUMN "project_role" "ProjectRole",
    ALTER COLUMN "workflow_state_id" DROP NOT NULL,
    ALTER COLUMN "team_id" DROP NOT NULL,
    DROP CONSTRAINT "issues_m3_team_task_only";

CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "status" "ProjectStatus" NOT NULL DEFAULT 'PLANNED',
    "lead_membership_id" UUID,
    "start_date" DATE,
    "target_date" DATE,
    "archived_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "purge_at" TIMESTAMPTZ(3),
    "deleted_by_membership_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "projects_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "projects_description_not_blank" CHECK (
        "description" IS NULL OR char_length(btrim("description")) > 0
    ),
    CONSTRAINT "projects_date_order" CHECK (
        "start_date" IS NULL OR "target_date" IS NULL OR "target_date" >= "start_date"
    ),
    CONSTRAINT "projects_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "projects_trash_state_consistent" CHECK (
        (
            "deleted_at" IS NULL
            AND "purge_at" IS NULL
            AND "deleted_by_membership_id" IS NULL
        )
        OR (
            "deleted_at" IS NOT NULL
            AND "purge_at" IS NOT NULL
            AND "deleted_by_membership_id" IS NOT NULL
            AND "purge_at" >= "deleted_at"
        )
    )
);

CREATE TABLE "project_role_teams" (
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL,
    "team_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_role_teams_pkey" PRIMARY KEY ("project_id", "role")
);

CREATE TABLE "issue_block_relations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "blocking_issue_id" UUID NOT NULL,
    "blocked_issue_id" UUID NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_block_relations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "issue_block_relations_distinct_issues" CHECK (
        "blocking_issue_id" <> "blocked_issue_id"
    )
);

CREATE TABLE "api_handoffs" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "kind" "HandoffKind" NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "body_markdown" TEXT NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_handoffs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "api_handoffs_sequence_number_positive" CHECK ("sequence_number" >= 1),
    CONSTRAINT "api_handoffs_body_markdown_valid" CHECK (
        char_length(btrim("body_markdown")) > 0
        AND char_length("body_markdown") <= 50000
    )
);

CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "recipient_membership_id" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "actor_membership_id" UUID,
    "issue_id" UUID NOT NULL,
    "comment_id" UUID,
    "handoff_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "notifications_actor_not_recipient" CHECK (
        "actor_membership_id" IS NULL OR "actor_membership_id" <> "recipient_membership_id"
    ),
    CONSTRAINT "notifications_handoff_anchor_consistent" CHECK (
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
    )
);

ALTER TABLE "issues"
    ADD CONSTRAINT "issues_type_fields_valid" CHECK (
        (
            "type" = 'FEATURE'::"IssueType"
            AND "feature_status" IS NOT NULL
            AND "project_id" IS NOT NULL
            AND "project_role" IS NULL
            AND "parent_issue_id" IS NULL
            AND "team_id" IS NULL
            AND "workflow_state_id" IS NULL
            AND "assignee_membership_id" IS NULL
        )
        OR (
            "type" = 'TEAM_TASK'::"IssueType"
            AND "feature_status" IS NULL
            AND "team_id" IS NOT NULL
            AND "workflow_state_id" IS NOT NULL
            AND (
                (
                    "project_id" IS NULL
                    AND "project_role" IS NULL
                    AND "parent_issue_id" IS NULL
                )
                OR (
                    "project_id" IS NOT NULL
                    AND "project_role" IS NOT NULL
                )
            )
        )
    );

ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_exactly_one_target" CHECK (
        ("issue_id" IS NOT NULL)::integer + ("project_id" IS NOT NULL)::integer = 1
    );

CREATE INDEX "projects_workspace_id_archived_at_updated_at_id_idx"
    ON "projects"("workspace_id", "archived_at", "updated_at", "id");
CREATE INDEX "projects_workspace_id_status_updated_at_id_idx"
    ON "projects"("workspace_id", "status", "updated_at", "id");
CREATE INDEX "projects_workspace_id_lead_membership_id_updated_at_id_idx"
    ON "projects"("workspace_id", "lead_membership_id", "updated_at", "id");
CREATE INDEX "projects_workspace_id_target_date_id_idx"
    ON "projects"("workspace_id", "target_date", "id");
CREATE UNIQUE INDEX "projects_workspace_id_id_key" ON "projects"("workspace_id", "id");

CREATE INDEX "project_role_teams_workspace_id_team_id_project_id_role_idx"
    ON "project_role_teams"("workspace_id", "team_id", "project_id", "role");
CREATE UNIQUE INDEX "project_role_teams_workspace_id_project_id_role_key"
    ON "project_role_teams"("workspace_id", "project_id", "role");
CREATE UNIQUE INDEX "project_role_teams_workspace_id_project_id_role_team_id_key"
    ON "project_role_teams"("workspace_id", "project_id", "role", "team_id");

CREATE INDEX "issue_block_relations_workspace_id_blocked_issue_id_created_idx"
    ON "issue_block_relations"("workspace_id", "blocked_issue_id", "created_at", "id");
CREATE INDEX "issue_block_relations_workspace_id_blocking_issue_id_create_idx"
    ON "issue_block_relations"("workspace_id", "blocking_issue_id", "created_at", "id");
CREATE UNIQUE INDEX "issue_block_relations_workspace_id_id_key"
    ON "issue_block_relations"("workspace_id", "id");
CREATE UNIQUE INDEX "issue_block_relations_blocking_issue_id_blocked_issue_id_key"
    ON "issue_block_relations"("blocking_issue_id", "blocked_issue_id");

CREATE INDEX "api_handoffs_workspace_id_issue_id_created_at_id_idx"
    ON "api_handoffs"("workspace_id", "issue_id", "created_at", "id");
CREATE UNIQUE INDEX "api_handoffs_workspace_id_id_key"
    ON "api_handoffs"("workspace_id", "id");
CREATE UNIQUE INDEX "api_handoffs_issue_id_sequence_number_key"
    ON "api_handoffs"("issue_id", "sequence_number");
CREATE UNIQUE INDEX "api_handoffs_initial_issue_key"
    ON "api_handoffs"("issue_id") WHERE "kind" = 'INITIAL'::"HandoffKind";

CREATE INDEX "notifications_workspace_id_recipient_membership_id_read_at__idx"
    ON "notifications"("workspace_id", "recipient_membership_id", "read_at", "created_at", "id");
CREATE INDEX "notifications_workspace_id_issue_id_created_at_id_idx"
    ON "notifications"("workspace_id", "issue_id", "created_at", "id");
CREATE UNIQUE INDEX "notifications_workspace_id_id_key"
    ON "notifications"("workspace_id", "id");
CREATE UNIQUE INDEX "notifications_event_id_recipient_membership_id_key"
    ON "notifications"("event_id", "recipient_membership_id");

CREATE INDEX "activity_events_workspace_id_project_id_created_at_id_idx"
    ON "activity_events"("workspace_id", "project_id", "created_at", "id");
CREATE INDEX "issues_workspace_id_feature_status_id_idx"
    ON "issues"("workspace_id", "feature_status", "id");
CREATE INDEX "issues_workspace_id_project_id_parent_issue_id_id_idx"
    ON "issues"("workspace_id", "project_id", "parent_issue_id", "id");
CREATE INDEX "issues_workspace_id_project_role_id_idx"
    ON "issues"("workspace_id", "project_role", "id");
CREATE UNIQUE INDEX "issues_workspace_id_project_id_id_key"
    ON "issues"("workspace_id", "project_id", "id");
CREATE UNIQUE INDEX "issues_workspace_id_feature_sequence_number_key"
    ON "issues"("workspace_id", "sequence_number")
    WHERE "type" = 'FEATURE'::"IssueType";
CREATE UNIQUE INDEX "outbox_events_workspace_id_id_key"
    ON "outbox_events"("workspace_id", "id");

ALTER TABLE "projects"
    ADD CONSTRAINT "projects_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects"
    ADD CONSTRAINT "projects_workspace_id_lead_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "lead_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "projects"
    ADD CONSTRAINT "projects_workspace_id_deleted_by_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "deleted_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "project_role_teams"
    ADD CONSTRAINT "project_role_teams_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_role_teams"
    ADD CONSTRAINT "project_role_teams_workspace_id_project_id_fkey"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "projects"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_role_teams"
    ADD CONSTRAINT "project_role_teams_workspace_id_team_id_fkey"
    FOREIGN KEY ("workspace_id", "team_id")
    REFERENCES "teams"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issues"
    ADD CONSTRAINT "issues_workspace_id_project_id_fkey"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "projects"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues"
    ADD CONSTRAINT "issues_workspace_id_project_id_project_role_team_id_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "project_role", "team_id")
    REFERENCES "project_role_teams"("workspace_id", "project_id", "role", "team_id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues"
    ADD CONSTRAINT "issues_workspace_id_project_id_parent_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "parent_issue_id")
    REFERENCES "issues"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_block_relations"
    ADD CONSTRAINT "issue_block_relations_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_block_relations"
    ADD CONSTRAINT "issue_block_relations_workspace_id_blocking_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "blocking_issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_block_relations"
    ADD CONSTRAINT "issue_block_relations_workspace_id_blocked_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "blocked_issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_block_relations"
    ADD CONSTRAINT "issue_block_relations_workspace_id_created_by_membership_i_fkey"
    FOREIGN KEY ("workspace_id", "created_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "api_handoffs"
    ADD CONSTRAINT "api_handoffs_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "api_handoffs"
    ADD CONSTRAINT "api_handoffs_workspace_id_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_handoffs"
    ADD CONSTRAINT "api_handoffs_workspace_id_author_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "author_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activity_events"
    ADD CONSTRAINT "activity_events_workspace_id_project_id_fkey"
    FOREIGN KEY ("workspace_id", "project_id")
    REFERENCES "projects"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_event_id_fkey"
    FOREIGN KEY ("workspace_id", "event_id")
    REFERENCES "outbox_events"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_recipient_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "recipient_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_actor_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "actor_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_id_handoff_id_fkey"
    FOREIGN KEY ("workspace_id", "handoff_id")
    REFERENCES "api_handoffs"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

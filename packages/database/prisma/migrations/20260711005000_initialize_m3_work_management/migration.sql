CREATE TYPE "IssueType" AS ENUM ('FEATURE', 'TEAM_TASK');
CREATE TYPE "IssuePriority" AS ENUM ('NONE', 'LOW', 'MEDIUM', 'HIGH', 'URGENT');

CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "type" "IssueType" NOT NULL DEFAULT 'TEAM_TASK',
    "identifier" VARCHAR(32) NOT NULL,
    "sequence_number" INTEGER NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "workflow_state_id" UUID NOT NULL,
    "priority" "IssuePriority" NOT NULL DEFAULT 'NONE',
    "team_id" UUID NOT NULL,
    "assignee_membership_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "issues_m3_team_task_only" CHECK ("type" = 'TEAM_TASK'),
    CONSTRAINT "issues_identifier_not_blank" CHECK (char_length(btrim("identifier")) > 0),
    CONSTRAINT "issues_title_not_blank" CHECK (char_length(btrim("title")) > 0),
    CONSTRAINT "issues_sequence_number_positive" CHECK ("sequence_number" >= 1),
    CONSTRAINT "issues_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "issue_labels" (
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "issue_labels_pkey" PRIMARY KEY ("issue_id", "label_id")
);

CREATE TABLE "issue_subscriptions" (
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_subscriptions_pkey" PRIMARY KEY ("issue_id", "membership_id")
);

CREATE TABLE "activity_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "actor_membership_id" UUID,
    "event_type" VARCHAR(100) NOT NULL,
    "field_name" VARCHAR(100),
    "before_data" JSONB,
    "after_data" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "activity_events_event_type_not_blank" CHECK (char_length(btrim("event_type")) > 0),
    CONSTRAINT "activity_events_field_name_not_blank" CHECK ("field_name" IS NULL OR char_length(btrim("field_name")) > 0)
);

CREATE UNIQUE INDEX "workflow_states_workspace_id_team_id_id_key" ON "workflow_states"("workspace_id", "team_id", "id");

CREATE UNIQUE INDEX "issues_workspace_id_id_key" ON "issues"("workspace_id", "id");
CREATE UNIQUE INDEX "issues_workspace_id_identifier_key" ON "issues"("workspace_id", "identifier");
CREATE UNIQUE INDEX "issues_team_id_sequence_number_key" ON "issues"("team_id", "sequence_number");
CREATE INDEX "issues_workspace_id_team_id_updated_at_id_idx" ON "issues"("workspace_id", "team_id", "updated_at", "id");
CREATE INDEX "issues_workspace_id_assignee_membership_id_updated_at_id_idx" ON "issues"("workspace_id", "assignee_membership_id", "updated_at", "id");
CREATE INDEX "issue_labels_workspace_id_label_id_issue_id_idx" ON "issue_labels"("workspace_id", "label_id", "issue_id");
CREATE INDEX "issue_subscriptions_workspace_id_membership_id_issue_id_idx" ON "issue_subscriptions"("workspace_id", "membership_id", "issue_id");
CREATE INDEX "activity_events_workspace_id_issue_id_created_at_id_idx" ON "activity_events"("workspace_id", "issue_id", "created_at", "id");

ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_team_id_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_team_id_workflow_state_id_fkey" FOREIGN KEY ("workspace_id", "team_id", "workflow_state_id") REFERENCES "workflow_states"("workspace_id", "team_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_team_id_assignee_membership_id_fkey" FOREIGN KEY ("workspace_id", "team_id", "assignee_membership_id") REFERENCES "team_members"("workspace_id", "team_id", "membership_id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issues" ADD CONSTRAINT "issues_workspace_id_created_by_membership_id_fkey" FOREIGN KEY ("workspace_id", "created_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_labels" ADD CONSTRAINT "issue_labels_workspace_id_label_id_fkey" FOREIGN KEY ("workspace_id", "label_id") REFERENCES "labels"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_workspace_id_membership_id_fkey" FOREIGN KEY ("workspace_id", "membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_workspace_id_actor_membership_id_fkey" FOREIGN KEY ("workspace_id", "actor_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

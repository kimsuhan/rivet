CREATE TYPE "DeploymentStatus" AS ENUM (
  'NOT_APPLICABLE',
  'PENDING',
  'DEPLOYED',
  'REDEPLOY_REQUIRED'
);

ALTER TABLE "project_teams"
ADD COLUMN "deployment_tracking_enabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "team_works"
ADD COLUMN "deployment_status" "DeploymentStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
ADD COLUMN "deployment_group_id" UUID,
ADD COLUMN "deployed_at" TIMESTAMPTZ(3),
ADD COLUMN "deployed_by_membership_id" UUID,
ADD CONSTRAINT "team_works_deployment_completion_consistent" CHECK (
  (
    "deployment_status" IN ('DEPLOYED', 'REDEPLOY_REQUIRED')
    AND "deployed_at" IS NOT NULL
    AND "deployed_by_membership_id" IS NOT NULL
  ) OR (
    "deployment_status" IN ('NOT_APPLICABLE', 'PENDING')
    AND "deployed_at" IS NULL
    AND "deployed_by_membership_id" IS NULL
  )
),
ADD CONSTRAINT "team_works_deployment_group_requires_tracking" CHECK (
  "deployment_group_id" IS NULL OR "deployment_status" <> 'NOT_APPLICABLE'
);

CREATE TABLE "deployment_groups" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "issue_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deployment_groups_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "team_work_deployment_dependencies" (
  "workspace_id" UUID NOT NULL,
  "issue_id" UUID NOT NULL,
  "dependent_team_work_id" UUID NOT NULL,
  "predecessor_team_work_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "team_work_deployment_dependencies_pkey"
    PRIMARY KEY ("dependent_team_work_id", "predecessor_team_work_id"),
  CONSTRAINT "team_work_deployment_dependencies_not_self"
    CHECK ("dependent_team_work_id" <> "predecessor_team_work_id")
);

CREATE UNIQUE INDEX "deployment_groups_workspace_id_issue_id_id_key"
ON "deployment_groups"("workspace_id", "issue_id", "id");

CREATE INDEX "deployment_groups_workspace_id_issue_id_created_at_id_idx"
ON "deployment_groups"("workspace_id", "issue_id", "created_at", "id");

CREATE INDEX "team_works_workspace_id_deployment_status_updated_at_id_idx"
ON "team_works"("workspace_id", "deployment_status", "updated_at", "id");

CREATE INDEX "team_works_workspace_id_deployment_group_id_id_idx"
ON "team_works"("workspace_id", "deployment_group_id", "id");

CREATE INDEX "team_work_deployment_dependencies_workspace_id_issue_id_predecessor_team_work_id_dependent_team_work_id_idx"
ON "team_work_deployment_dependencies"(
  "workspace_id",
  "issue_id",
  "predecessor_team_work_id",
  "dependent_team_work_id"
);

ALTER TABLE "deployment_groups"
ADD CONSTRAINT "deployment_groups_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "deployment_groups"
ADD CONSTRAINT "deployment_groups_workspace_id_issue_id_fkey"
FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_works"
ADD CONSTRAINT "team_works_workspace_id_deployed_by_membership_id_fkey"
FOREIGN KEY ("workspace_id", "deployed_by_membership_id")
REFERENCES "workspace_memberships"("workspace_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_works"
ADD CONSTRAINT "team_works_workspace_id_issue_id_deployment_group_id_fkey"
FOREIGN KEY ("workspace_id", "issue_id", "deployment_group_id")
REFERENCES "deployment_groups"("workspace_id", "issue_id", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_work_deployment_dependencies"
ADD CONSTRAINT "team_work_deployment_dependencies_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "team_work_deployment_dependencies"
ADD CONSTRAINT "team_work_deployment_dependencies_workspace_id_issue_id_fkey"
FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_work_deployment_dependencies"
ADD CONSTRAINT "team_work_deployment_dependencies_dependent_fkey"
FOREIGN KEY ("workspace_id", "issue_id", "dependent_team_work_id")
REFERENCES "team_works"("workspace_id", "issue_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "team_work_deployment_dependencies"
ADD CONSTRAINT "team_work_deployment_dependencies_predecessor_fkey"
FOREIGN KEY ("workspace_id", "issue_id", "predecessor_team_work_id")
REFERENCES "team_works"("workspace_id", "issue_id", "id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- ProjectTeam contract migration.
-- All application processes must use project_team_id before this migration is deployed.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "team_works" AS work
        JOIN "issues" AS issue
          ON issue."workspace_id" = work."workspace_id"
         AND issue."id" = work."issue_id"
        LEFT JOIN "project_teams" AS project_team
          ON project_team."workspace_id" = work."workspace_id"
         AND project_team."project_id" = issue."project_id"
         AND project_team."team_id" = work."team_id"
         AND project_team."id" = work."project_team_id"
        WHERE work."project_team_id" IS NULL
           OR project_team."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'PROJECT_TEAM_CONTRACT_TEAM_WORK_MISMATCH'
            USING HINT = 'Backfill every team_works.project_team_id with a ProjectTeam from the same workspace, project, and team before retrying.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "issue_templates" AS template
        LEFT JOIN "project_teams" AS project_team
          ON project_team."workspace_id" = template."workspace_id"
         AND project_team."project_id" = template."project_id"
         AND project_team."id" = template."initial_project_team_id"
        WHERE template."initial_project_team_id" IS NOT NULL
          AND (
              template."project_id" IS NULL
              OR project_team."id" IS NULL
          )
    ) THEN
        RAISE EXCEPTION 'PROJECT_TEAM_CONTRACT_TEMPLATE_MISMATCH'
            USING HINT = 'Clear or repair invalid issue_templates.initial_project_team_id references before retrying.';
    END IF;
END;
$$;

ALTER TABLE "team_works"
    ADD CONSTRAINT "team_works_project_team_id_not_null_check"
    CHECK ("project_team_id" IS NOT NULL) NOT VALID;
ALTER TABLE "team_works"
    VALIDATE CONSTRAINT "team_works_project_team_id_not_null_check";

ALTER TABLE "issue_templates"
    ADD CONSTRAINT "issue_templates_initial_project_team_requires_project_check"
    CHECK ("initial_project_team_id" IS NULL OR "project_id" IS NOT NULL) NOT VALID;
ALTER TABLE "issue_templates"
    VALIDATE CONSTRAINT "issue_templates_initial_project_team_requires_project_check";

DROP TRIGGER IF EXISTS "project_role_teams_b3_compat_sync" ON "project_role_teams";
DROP TRIGGER IF EXISTS "team_works_b3_compat_project_team" ON "team_works";
DROP TRIGGER IF EXISTS "issue_templates_b3_compat_initial_team" ON "issue_templates";

DROP FUNCTION IF EXISTS "rivet_b3_sync_project_team_from_role"();
DROP FUNCTION IF EXISTS "rivet_b3_assign_team_work_project_team"();
DROP FUNCTION IF EXISTS "rivet_b3_sync_template_initial_team"();

DROP INDEX "team_works_workspace_id_project_role_id_idx";

ALTER TABLE "team_works"
    ALTER COLUMN "project_team_id" SET NOT NULL,
    DROP COLUMN "project_role";
ALTER TABLE "team_works"
    DROP CONSTRAINT "team_works_project_team_id_not_null_check";

ALTER TABLE "issue_templates"
    DROP CONSTRAINT "issue_templates_initial_role_requires_project_check",
    DROP COLUMN "initial_role";

DROP TABLE "project_role_teams";
DROP TYPE "ProjectRole";

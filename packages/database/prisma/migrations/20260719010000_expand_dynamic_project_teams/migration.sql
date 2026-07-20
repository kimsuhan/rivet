-- B3 expand migration. Legacy role columns and tables remain until every process has
-- moved to ProjectTeam. The compatibility triggers are removed with the later contract release.

CREATE TABLE "project_teams" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "deactivated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_teams_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_teams_active_state_consistent" CHECK (
        ("is_active" = true AND "deactivated_at" IS NULL)
        OR ("is_active" = false AND "deactivated_at" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "project_teams_workspace_id_id_key"
    ON "project_teams"("workspace_id", "id");
CREATE UNIQUE INDEX "project_teams_workspace_id_project_id_id_key"
    ON "project_teams"("workspace_id", "project_id", "id");
CREATE UNIQUE INDEX "project_teams_workspace_id_team_id_id_key"
    ON "project_teams"("workspace_id", "team_id", "id");
CREATE UNIQUE INDEX "project_teams_project_id_team_id_key"
    ON "project_teams"("project_id", "team_id");
CREATE INDEX "project_teams_workspace_project_active_team_idx"
    ON "project_teams"("workspace_id", "project_id", "is_active", "team_id");
CREATE INDEX "project_teams_workspace_team_active_project_idx"
    ON "project_teams"("workspace_id", "team_id", "is_active", "project_id");

ALTER TABLE "project_teams"
    ADD CONSTRAINT "project_teams_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_teams"
    ADD CONSTRAINT "project_teams_workspace_project_fkey"
    FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "project_teams"
    ADD CONSTRAINT "project_teams_workspace_team_fkey"
    FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "project_teams" (
    "id",
    "workspace_id",
    "project_id",
    "team_id",
    "is_active",
    "deactivated_at",
    "created_at",
    "updated_at"
)
SELECT
    gen_random_uuid(),
    "workspace_id",
    "project_id",
    "team_id",
    true,
    NULL,
    MIN("created_at"),
    MAX("updated_at")
FROM "project_role_teams"
GROUP BY "workspace_id", "project_id", "team_id";

ALTER TABLE "team_works"
    ADD COLUMN "project_team_id" UUID,
    ALTER COLUMN "project_role" SET DEFAULT 'BACKEND'::"ProjectRole";

UPDATE "team_works" AS work
SET "project_team_id" = project_team."id"
FROM "issues" AS issue
JOIN "project_teams" AS project_team
  ON project_team."workspace_id" = issue."workspace_id"
 AND project_team."project_id" = issue."project_id"
WHERE issue."workspace_id" = work."workspace_id"
  AND issue."id" = work."issue_id"
  AND project_team."team_id" = work."team_id";

CREATE INDEX "team_works_workspace_project_team_deleted_updated_idx"
    ON "team_works"("workspace_id", "project_team_id", "deleted_at", "updated_at", "id");

ALTER TABLE "team_works"
    ADD CONSTRAINT "team_works_workspace_team_project_team_fkey"
    FOREIGN KEY ("workspace_id", "team_id", "project_team_id")
    REFERENCES "project_teams"("workspace_id", "team_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

ALTER TABLE "issue_templates"
    ADD COLUMN "initial_project_team_id" UUID;

UPDATE "issue_templates" AS template
SET "initial_project_team_id" = project_team."id"
FROM "project_role_teams" AS role_team
JOIN "project_teams" AS project_team
  ON project_team."workspace_id" = role_team."workspace_id"
 AND project_team."project_id" = role_team."project_id"
 AND project_team."team_id" = role_team."team_id"
WHERE template."workspace_id" = role_team."workspace_id"
  AND template."project_id" = role_team."project_id"
  AND template."initial_role" = role_team."role";

ALTER TABLE "issue_templates"
    ADD CONSTRAINT "issue_templates_workspace_project_initial_team_fkey"
    FOREIGN KEY ("workspace_id", "project_id", "initial_project_team_id")
    REFERENCES "project_teams"("workspace_id", "project_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID;

CREATE OR REPLACE FUNCTION "rivet_b3_sync_project_team_from_role"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_workspace_id UUID;
    target_project_id UUID;
    target_team_id UUID;
BEGIN
    IF TG_OP = 'DELETE' THEN
        target_workspace_id := OLD."workspace_id";
        target_project_id := OLD."project_id";
        target_team_id := OLD."team_id";

        IF NOT EXISTS (
            SELECT 1
            FROM "project_role_teams"
            WHERE "workspace_id" = target_workspace_id
              AND "project_id" = target_project_id
              AND "team_id" = target_team_id
        ) THEN
            UPDATE "project_teams"
            SET "is_active" = false,
                "deactivated_at" = CURRENT_TIMESTAMP,
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "workspace_id" = target_workspace_id
              AND "project_id" = target_project_id
              AND "team_id" = target_team_id;
        END IF;
        RETURN OLD;
    END IF;

    INSERT INTO "project_teams" (
        "id", "workspace_id", "project_id", "team_id", "is_active", "deactivated_at", "created_at", "updated_at"
    ) VALUES (
        gen_random_uuid(), NEW."workspace_id", NEW."project_id", NEW."team_id", true, NULL, NEW."created_at", NEW."updated_at"
    )
    ON CONFLICT ("project_id", "team_id") DO UPDATE
    SET "is_active" = true,
        "deactivated_at" = NULL,
        "updated_at" = EXCLUDED."updated_at";
    RETURN NEW;
END;
$$;

CREATE TRIGGER "project_role_teams_b3_compat_sync"
AFTER INSERT OR UPDATE OR DELETE ON "project_role_teams"
FOR EACH ROW EXECUTE FUNCTION "rivet_b3_sync_project_team_from_role"();

CREATE OR REPLACE FUNCTION "rivet_b3_assign_team_work_project_team"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    target_project_id UUID;
BEGIN
    IF NEW."project_team_id" IS NOT NULL THEN
        RETURN NEW;
    END IF;

    SELECT "project_id"
    INTO target_project_id
    FROM "issues"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "id" = NEW."issue_id";

    INSERT INTO "project_teams" (
        "id", "workspace_id", "project_id", "team_id", "is_active", "deactivated_at", "created_at", "updated_at"
    ) VALUES (
        gen_random_uuid(), NEW."workspace_id", target_project_id, NEW."team_id", true, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT ("project_id", "team_id") DO NOTHING;

    SELECT "id"
    INTO NEW."project_team_id"
    FROM "project_teams"
    WHERE "workspace_id" = NEW."workspace_id"
      AND "project_id" = target_project_id
      AND "team_id" = NEW."team_id";

    RETURN NEW;
END;
$$;

CREATE TRIGGER "team_works_b3_compat_project_team"
BEFORE INSERT OR UPDATE OF "issue_id", "team_id", "project_team_id" ON "team_works"
FOR EACH ROW EXECUTE FUNCTION "rivet_b3_assign_team_work_project_team"();

CREATE OR REPLACE FUNCTION "rivet_b3_sync_template_initial_team"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."initial_project_team_id" IS NULL
       AND NEW."project_id" IS NOT NULL
       AND NEW."initial_role" IS NOT NULL THEN
        SELECT project_team."id"
        INTO NEW."initial_project_team_id"
        FROM "project_role_teams" AS role_team
        JOIN "project_teams" AS project_team
          ON project_team."workspace_id" = role_team."workspace_id"
         AND project_team."project_id" = role_team."project_id"
         AND project_team."team_id" = role_team."team_id"
        WHERE role_team."workspace_id" = NEW."workspace_id"
          AND role_team."project_id" = NEW."project_id"
          AND role_team."role" = NEW."initial_role";
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "issue_templates_b3_compat_initial_team"
BEFORE INSERT OR UPDATE OF "project_id", "initial_role", "initial_project_team_id" ON "issue_templates"
FOR EACH ROW EXECUTE FUNCTION "rivet_b3_sync_template_initial_team"();

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
        WHERE project_team."id" IS NULL
    ) THEN
        RAISE EXCEPTION 'B3_BACKFILL_TEAM_WORK_PROJECT_TEAM_MISMATCH';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "team_works" AS work
        LEFT JOIN "workflow_states" AS state
          ON state."workspace_id" = work."workspace_id"
         AND state."team_id" = work."team_id"
         AND state."id" = work."workflow_state_id"
        LEFT JOIN "team_members" AS member
          ON member."workspace_id" = work."workspace_id"
         AND member."team_id" = work."team_id"
         AND member."membership_id" = work."assignee_membership_id"
        WHERE state."id" IS NULL
           OR (work."assignee_membership_id" IS NOT NULL AND member."membership_id" IS NULL)
    ) THEN
        RAISE EXCEPTION 'B3_BACKFILL_TEAM_WORK_TEAM_SCOPE_MISMATCH';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "issue_templates"
        WHERE "initial_role" IS NOT NULL
          AND "initial_project_team_id" IS NULL
    ) THEN
        RAISE EXCEPTION 'B3_BACKFILL_TEMPLATE_INITIAL_TEAM_MISSING';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "api_handoff_targets" AS target
        JOIN "api_handoffs" AS handoff
          ON handoff."workspace_id" = target."workspace_id"
         AND handoff."id" = target."handoff_id"
        JOIN "team_works" AS destination
          ON destination."workspace_id" = target."workspace_id"
         AND destination."id" = target."team_work_id"
        JOIN "team_works" AS source
          ON source."workspace_id" = handoff."workspace_id"
         AND source."id" = handoff."source_team_work_id"
        WHERE source."issue_id" <> destination."issue_id"
           OR source."project_team_id" = destination."project_team_id"
    ) THEN
        RAISE EXCEPTION 'B3_BACKFILL_HANDOFF_TARGET_MISMATCH';
    END IF;
END;
$$;

ALTER TABLE "team_works" VALIDATE CONSTRAINT "team_works_workspace_team_project_team_fkey";
ALTER TABLE "issue_templates" VALIDATE CONSTRAINT "issue_templates_workspace_project_initial_team_fkey";

COMMENT ON COLUMN "team_works"."project_role" IS
    'B3 deployment compatibility only. New code must not read or write this field; remove after all processes use project_team_id.';
COMMENT ON TABLE "project_role_teams" IS
    'B3 deployment compatibility only. New code must not read or write this table; remove with compatibility triggers in the contract release.';

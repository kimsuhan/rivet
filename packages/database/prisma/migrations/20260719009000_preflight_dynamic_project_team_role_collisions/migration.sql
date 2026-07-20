-- Run before the B3 ProjectTeam backfill so an allowed legacy shape is not
-- collapsed without an explicit data cleanup decision.
DO $$
DECLARE
    collision_count INTEGER;
BEGIN
    SELECT COUNT(*)::int
    INTO collision_count
    FROM (
        SELECT "workspace_id", "project_id", "team_id"
        FROM "project_role_teams"
        GROUP BY "workspace_id", "project_id", "team_id"
        HAVING COUNT(DISTINCT "role") > 1
    ) AS collisions;

    IF collision_count > 0 THEN
        RAISE EXCEPTION 'B3_PREFLIGHT_PROJECT_TEAM_ROLE_COLLISION'
            USING DETAIL = format(
                '%s project/team pair(s) are assigned to multiple legacy roles.',
                collision_count
            ),
            HINT = 'Assign a distinct team to each legacy project role or remove duplicate role assignments, then retry the migration.';
    END IF;
END;
$$;

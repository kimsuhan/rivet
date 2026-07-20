WITH "team_position_offsets" AS (
  SELECT "team_id", MAX("position") + 1 AS "position_offset"
  FROM "workflow_states"
  GROUP BY "team_id"
)
UPDATE "workflow_states" AS "state"
SET "position" = "state"."position" + "team_position_offsets"."position_offset"
FROM "team_position_offsets"
WHERE "state"."team_id" = "team_position_offsets"."team_id";

WITH "ranked_states" AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "team_id"
      ORDER BY
        CASE "category"
          WHEN 'BACKLOG'::"StateCategory" THEN 0
          WHEN 'UNSTARTED'::"StateCategory" THEN 1
          WHEN 'STARTED'::"StateCategory" THEN 2
          WHEN 'COMPLETED'::"StateCategory" THEN 3
          WHEN 'CANCELED'::"StateCategory" THEN 4
        END,
        "position",
        "id"
    ) - 1 AS "new_position"
  FROM "workflow_states"
)
UPDATE "workflow_states" AS "state"
SET
  "position" = "ranked_states"."new_position",
  "updated_at" = NOW(),
  "version" = "state"."version" + 1
FROM "ranked_states"
WHERE "state"."id" = "ranked_states"."id";

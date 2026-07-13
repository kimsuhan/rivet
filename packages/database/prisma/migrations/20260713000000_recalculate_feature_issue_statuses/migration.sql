WITH feature_tasks AS (
  SELECT
    parent."id" AS feature_id,
    COUNT(child."id") FILTER (
      WHERE child."deleted_at" IS NULL
        AND state."category" <> 'CANCELED'::"StateCategory"
    ) AS active_count,
    COUNT(child."id") FILTER (
      WHERE child."deleted_at" IS NULL
        AND state."category" <> 'CANCELED'::"StateCategory"
        AND state."category" = 'COMPLETED'::"StateCategory"
    ) AS completed_count,
    COUNT(child."id") FILTER (
      WHERE child."deleted_at" IS NULL
        AND state."category" <> 'CANCELED'::"StateCategory"
        AND state."category" IN ('STARTED'::"StateCategory", 'COMPLETED'::"StateCategory")
    ) AS started_or_completed_count
  FROM "issues" parent
  LEFT JOIN "issues" child
    ON child."parent_issue_id" = parent."id"
   AND child."workspace_id" = parent."workspace_id"
   AND child."type" = 'TEAM_TASK'::"IssueType"
  LEFT JOIN "workflow_states" state
    ON state."id" = child."workflow_state_id"
   AND state."team_id" = child."team_id"
   AND state."workspace_id" = child."workspace_id"
  WHERE parent."type" = 'FEATURE'::"IssueType"
    AND parent."deleted_at" IS NULL
  GROUP BY parent."id"
)
UPDATE "issues" feature
SET "feature_status" = CASE
  WHEN tasks.active_count = 0 THEN 'UNSORTED'::"FeatureIssueStatus"
  WHEN tasks.completed_count = tasks.active_count THEN 'REVIEW'::"FeatureIssueStatus"
  WHEN tasks.started_or_completed_count > 0 THEN 'IN_PROGRESS'::"FeatureIssueStatus"
  ELSE 'TODO'::"FeatureIssueStatus"
END,
"updated_at" = CURRENT_TIMESTAMP
FROM feature_tasks tasks
WHERE feature."id" = tasks.feature_id
  AND feature."feature_status" IN (
    'UNSORTED'::"FeatureIssueStatus",
    'TODO'::"FeatureIssueStatus",
    'IN_PROGRESS'::"FeatureIssueStatus",
    'REVIEW'::"FeatureIssueStatus"
  );

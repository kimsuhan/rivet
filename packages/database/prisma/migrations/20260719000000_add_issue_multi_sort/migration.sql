UPDATE "saved_views"
SET
  "configuration" = ("configuration" - 'sort' - 'sortDirection') || jsonb_build_object(
    'sorts',
    jsonb_build_array(
      jsonb_build_object(
        'field', COALESCE("configuration" ->> 'sort', 'updatedAt'),
        'direction', COALESCE("configuration" ->> 'sortDirection', 'desc')
      )
    )
  ),
  "version" = "version" + 1,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "resource_type" = 'ISSUES'::"SavedViewResourceType"
  AND NOT ("configuration" ? 'sorts')
  AND ("configuration" ? 'sort' OR "configuration" ? 'sortDirection');

CREATE INDEX "issues_workspace_id_deleted_at_updated_at_id_idx"
  ON "issues"("workspace_id", "deleted_at", "updated_at", "id");

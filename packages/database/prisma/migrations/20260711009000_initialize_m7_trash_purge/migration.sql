ALTER TABLE "issues"
    ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
    ADD COLUMN "purge_at" TIMESTAMPTZ(3),
    ADD COLUMN "deleted_by_membership_id" UUID,
    ADD CONSTRAINT "issues_trash_state_consistent" CHECK (
        (
            "deleted_at" IS NULL
            AND "purge_at" IS NULL
            AND "deleted_by_membership_id" IS NULL
        )
        OR (
            "deleted_at" IS NOT NULL
            AND "purge_at" IS NOT NULL
            AND "deleted_by_membership_id" IS NOT NULL
            AND "purge_at" = "deleted_at" + INTERVAL '30 days'
        )
    );

ALTER TABLE "projects"
    DROP CONSTRAINT "projects_trash_state_consistent",
    ADD CONSTRAINT "projects_trash_state_consistent" CHECK (
        (
            "deleted_at" IS NULL
            AND "purge_at" IS NULL
            AND "deleted_by_membership_id" IS NULL
        )
        OR (
            "deleted_at" IS NOT NULL
            AND "purge_at" IS NOT NULL
            AND "deleted_by_membership_id" IS NOT NULL
            AND "purge_at" = "deleted_at" + INTERVAL '30 days'
        )
    );

CREATE INDEX "issues_workspace_id_deleted_at_created_at_id_idx"
    ON "issues"("workspace_id", "deleted_at", "created_at", "id");
CREATE INDEX "projects_workspace_id_deleted_at_created_at_id_idx"
    ON "projects"("workspace_id", "deleted_at", "created_at", "id");

ALTER TABLE "issues"
    ADD CONSTRAINT "issues_workspace_id_deleted_by_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "deleted_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

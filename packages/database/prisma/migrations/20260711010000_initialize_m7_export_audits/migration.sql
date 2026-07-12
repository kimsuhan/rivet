CREATE TYPE "ExportType" AS ENUM ('ISSUES', 'PROJECTS');

CREATE TABLE "export_audits" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "requested_by_membership_id" UUID NOT NULL,
    "type" "ExportType" NOT NULL,
    "item_count" INTEGER,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "downloaded_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(100),

    CONSTRAINT "export_audits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "export_audits_item_count_nonnegative" CHECK (
        "item_count" IS NULL OR "item_count" >= 0
    ),
    CONSTRAINT "export_audits_result_consistent" CHECK (
        (
            "completed_at" IS NULL
            AND "failed_at" IS NULL
            AND "item_count" IS NULL
            AND "last_error_code" IS NULL
            AND "downloaded_at" IS NULL
        )
        OR (
            "completed_at" IS NOT NULL
            AND "completed_at" >= "requested_at"
            AND "failed_at" IS NULL
            AND "item_count" IS NOT NULL
            AND "last_error_code" IS NULL
            AND (
                "downloaded_at" IS NULL
                OR "downloaded_at" >= "completed_at"
            )
        )
        OR (
            "completed_at" IS NULL
            AND "failed_at" IS NOT NULL
            AND "failed_at" >= "requested_at"
            AND "item_count" IS NULL
            AND "last_error_code" IS NOT NULL
            AND char_length(btrim("last_error_code")) > 0
            AND "downloaded_at" IS NULL
        )
        OR (
            "completed_at" IS NOT NULL
            AND "completed_at" >= "requested_at"
            AND "failed_at" IS NOT NULL
            AND "failed_at" >= "completed_at"
            AND "item_count" IS NOT NULL
            AND "last_error_code" IS NOT NULL
            AND char_length(btrim("last_error_code")) > 0
            AND "downloaded_at" IS NULL
        )
    )
);

CREATE INDEX "export_audits_workspace_id_requested_at_id_idx"
    ON "export_audits"("workspace_id", "requested_at", "id");
CREATE INDEX "export_audits_workspace_id_requested_by_membership_id_reques_idx"
    ON "export_audits"("workspace_id", "requested_by_membership_id", "requested_at", "id");

ALTER TABLE "export_audits"
    ADD CONSTRAINT "export_audits_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "export_audits"
    ADD CONSTRAINT "export_audits_workspace_id_requested_by_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "requested_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

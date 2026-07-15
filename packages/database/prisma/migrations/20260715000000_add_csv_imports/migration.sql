CREATE TYPE "ImportRunStatus" AS ENUM (
  'PREVIEWED',
  'VALIDATION_FAILED',
  'VALIDATED',
  'PROCESSING',
  'SUCCEEDED',
  'FAILED'
);

CREATE TABLE "import_runs" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "requested_by_membership_id" UUID NOT NULL,
  "execution_id" UUID NOT NULL,
  "source_fingerprint" CHAR(64) NOT NULL,
  "status" "ImportRunStatus" NOT NULL,
  "input_row_count" INTEGER NOT NULL DEFAULT 0,
  "project_created_count" INTEGER NOT NULL DEFAULT 0,
  "issue_created_count" INTEGER NOT NULL DEFAULT 0,
  "connection_created_count" INTEGER NOT NULL DEFAULT 0,
  "excluded_row_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "last_error_code" VARCHAR(100),
  "error_details" JSONB,
  "validated_target_fingerprint" CHAR(64),
  "validation_signature" CHAR(64),
  "started_at" TIMESTAMPTZ(3),
  "completed_at" TIMESTAMPTZ(3),
  "failed_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_source_rows" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "import_run_id" UUID NOT NULL,
  "source_key_hash" CHAR(64) NOT NULL,
  "source_reference" VARCHAR(255) NOT NULL,
  "project_id" UUID NOT NULL,
  "project_created" BOOLEAN NOT NULL DEFAULT false,
  "issue_id" UUID NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_source_rows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "import_runs_workspace_id_id_key" ON "import_runs"("workspace_id", "id");
CREATE UNIQUE INDEX "import_runs_workspace_id_execution_id_key" ON "import_runs"("workspace_id", "execution_id");
CREATE INDEX "import_runs_workspace_id_source_fingerprint_status_created_at_id_idx" ON "import_runs"("workspace_id", "source_fingerprint", "status", "created_at", "id");
CREATE INDEX "import_runs_workspace_id_created_at_id_idx" ON "import_runs"("workspace_id", "created_at", "id");
CREATE UNIQUE INDEX "import_source_rows_workspace_id_id_key" ON "import_source_rows"("workspace_id", "id");
CREATE UNIQUE INDEX "import_source_rows_workspace_id_source_key_hash_key" ON "import_source_rows"("workspace_id", "source_key_hash");
CREATE UNIQUE INDEX "import_source_rows_workspace_id_issue_id_key" ON "import_source_rows"("workspace_id", "issue_id");
CREATE INDEX "import_source_rows_workspace_id_import_run_id_created_at_id_idx" ON "import_source_rows"("workspace_id", "import_run_id", "created_at", "id");
CREATE INDEX "import_source_rows_workspace_id_project_id_created_at_id_idx" ON "import_source_rows"("workspace_id", "project_id", "created_at", "id");

ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_workspace_id_requested_by_membership_id_fkey" FOREIGN KEY ("workspace_id", "requested_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_source_rows" ADD CONSTRAINT "import_source_rows_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_source_rows" ADD CONSTRAINT "import_source_rows_workspace_id_import_run_id_fkey" FOREIGN KEY ("workspace_id", "import_run_id") REFERENCES "import_runs"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_source_rows" ADD CONSTRAINT "import_source_rows_workspace_id_project_id_fkey" FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "import_source_rows" ADD CONSTRAINT "import_source_rows_workspace_id_issue_id_fkey" FOREIGN KEY ("workspace_id", "issue_id") REFERENCES "issues"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_non_negative_counts_check" CHECK (
  "input_row_count" >= 0 AND
  "project_created_count" >= 0 AND
  "issue_created_count" >= 0 AND
  "connection_created_count" >= 0 AND
  "excluded_row_count" >= 0 AND
  "error_count" >= 0
);

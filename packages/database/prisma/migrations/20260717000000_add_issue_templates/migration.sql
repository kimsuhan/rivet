CREATE TABLE "issue_templates" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "description_markdown" TEXT NOT NULL,
    "priority" "IssuePriority" NOT NULL DEFAULT 'NONE',
    "project_id" UUID,
    "initial_role" "ProjectRole",
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "issue_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "issue_templates_workspace_id_id_key" UNIQUE ("workspace_id", "id"),
    CONSTRAINT "issue_templates_initial_role_requires_project_check" CHECK (
      "initial_role" IS NULL OR "project_id" IS NOT NULL
    )
);

CREATE TABLE "issue_template_labels" (
    "workspace_id" UUID NOT NULL,
    "issue_template_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,

    CONSTRAINT "issue_template_labels_pkey" PRIMARY KEY ("issue_template_id", "label_id")
);

CREATE UNIQUE INDEX "issue_templates_active_normalized_name_key"
ON "issue_templates"("workspace_id", "normalized_name") WHERE "archived_at" IS NULL;

CREATE INDEX "issue_templates_workspace_id_archived_at_updated_at_id_idx"
ON "issue_templates"("workspace_id", "archived_at", "updated_at", "id");

CREATE INDEX "issue_templates_workspace_id_project_id_idx"
ON "issue_templates"("workspace_id", "project_id");

CREATE INDEX "issue_template_labels_workspace_label_template_idx"
ON "issue_template_labels"("workspace_id", "label_id", "issue_template_id");

ALTER TABLE "issue_templates"
ADD CONSTRAINT "issue_templates_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_templates"
ADD CONSTRAINT "issue_templates_workspace_id_project_id_fkey"
FOREIGN KEY ("workspace_id", "project_id") REFERENCES "projects"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_template_labels"
ADD CONSTRAINT "issue_template_labels_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_template_labels"
ADD CONSTRAINT "issue_template_labels_workspace_id_issue_template_id_fkey"
FOREIGN KEY ("workspace_id", "issue_template_id") REFERENCES "issue_templates"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "issue_template_labels"
ADD CONSTRAINT "issue_template_labels_workspace_id_label_id_fkey"
FOREIGN KEY ("workspace_id", "label_id") REFERENCES "labels"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

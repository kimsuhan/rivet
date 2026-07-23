ALTER TABLE "projects"
ADD COLUMN "logo_file_id" UUID;

CREATE UNIQUE INDEX "projects_workspace_id_logo_file_id_key"
ON "projects"("workspace_id", "logo_file_id");

ALTER TABLE "projects"
ADD CONSTRAINT "projects_workspace_id_logo_file_id_fkey"
FOREIGN KEY ("workspace_id", "logo_file_id")
REFERENCES "files"("workspace_id", "id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE TYPE "SavedViewResourceType" AS ENUM ('ISSUES', 'MY_WORK');

CREATE TABLE "saved_views" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "resource_type" "SavedViewResourceType" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "configuration" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "saved_views_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "saved_views_workspace_id_id_key" UNIQUE ("workspace_id", "id"),
    CONSTRAINT "saved_views_membership_id_resource_type_normalized_name_key" UNIQUE ("membership_id", "resource_type", "normalized_name"),
    CONSTRAINT "saved_views_workspace_id_membership_id_fkey" FOREIGN KEY ("workspace_id", "membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "saved_views_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "saved_views_workspace_id_membership_id_resource_type_updated_at_id_idx"
  ON "saved_views"("workspace_id", "membership_id", "resource_type", "updated_at", "id");

CREATE UNIQUE INDEX "saved_views_one_default_per_resource"
  ON "saved_views"("membership_id", "resource_type") WHERE "is_default";

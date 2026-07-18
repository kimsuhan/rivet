CREATE TABLE "product_event_states" (
  "id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "membership_id" UUID NOT NULL,
  "semantic_key" VARCHAR(100) NOT NULL,
  "state_value" VARCHAR(100) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "product_event_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "product_event_states_semantic_key_not_blank" CHECK (char_length(btrim("semantic_key")) > 0),
  CONSTRAINT "product_event_states_state_value_not_blank" CHECK (char_length(btrim("state_value")) > 0),
  CONSTRAINT "product_event_states_version_positive" CHECK ("version" > 0),
  CONSTRAINT "product_event_states_workspace_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_event_states_membership_fkey" FOREIGN KEY ("workspace_id", "membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "product_event_states_workspace_membership_semantic_key"
  ON "product_event_states"("workspace_id", "membership_id", "semantic_key");

CREATE INDEX "product_event_states_workspace_membership_updated_at_idx"
  ON "product_event_states"("workspace_id", "membership_id", "updated_at", "id");

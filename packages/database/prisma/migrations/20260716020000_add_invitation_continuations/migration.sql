CREATE TABLE "workspace_invitation_continuations" (
    "id" UUID NOT NULL,
    "one_time_token_id" UUID NOT NULL,
    "user_id" UUID,
    "token_hash" BYTEA NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_invitation_continuations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "workspace_invitation_continuations_token_hash_key"
ON "workspace_invitation_continuations"("token_hash");

CREATE INDEX "workspace_invitation_continuations_one_time_token_id_idx"
ON "workspace_invitation_continuations"("one_time_token_id");

CREATE INDEX "workspace_invitation_continuations_user_id_created_at_idx"
ON "workspace_invitation_continuations"("user_id", "created_at");

CREATE UNIQUE INDEX "workspace_invitation_continuations_active_user_key"
ON "workspace_invitation_continuations"("user_id")
WHERE "user_id" IS NOT NULL
  AND "consumed_at" IS NULL
  AND "revoked_at" IS NULL;

ALTER TABLE "workspace_invitation_continuations"
ADD CONSTRAINT "workspace_invitation_continuations_one_time_token_id_fkey"
FOREIGN KEY ("one_time_token_id") REFERENCES "one_time_tokens"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "workspace_invitation_continuations"
ADD CONSTRAINT "workspace_invitation_continuations_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

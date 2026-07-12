ALTER TYPE "TokenPurpose" ADD VALUE 'WORKSPACE_INVITATION';
ALTER TYPE "EmailTemplateType" ADD VALUE 'WORKSPACE_INVITATION';

CREATE TABLE "workspace_invitations" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "normalized_email" VARCHAR(254) NOT NULL,
    "invited_by_membership_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "canceled_at" TIMESTAMPTZ(3),
    "accepted_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_invitations_email_not_blank" CHECK (char_length(btrim("email")) > 0),
    CONSTRAINT "workspace_invitations_normalized_email_not_blank" CHECK (char_length("normalized_email") > 0),
    CONSTRAINT "workspace_invitations_normalized_email_matches" CHECK ("normalized_email" = lower(btrim("email"))),
    CONSTRAINT "workspace_invitations_expire_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "workspace_invitations_terminal_state_exclusive" CHECK (num_nonnulls("accepted_at", "canceled_at") <= 1),
    CONSTRAINT "workspace_invitations_acceptor_matches_state" CHECK (("accepted_at" IS NULL) = ("accepted_by_user_id" IS NULL)),
    CONSTRAINT "workspace_invitations_state_after_creation" CHECK (
        ("accepted_at" IS NULL OR "accepted_at" >= "created_at") AND
        ("canceled_at" IS NULL OR "canceled_at" >= "created_at")
    )
);

CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "normalized_name" VARCHAR(50) NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "labels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "labels_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "labels_normalized_name_not_blank" CHECK (char_length("normalized_name") > 0),
    CONSTRAINT "labels_normalized_name_matches" CHECK ("normalized_name" = lower(btrim("name"))),
    CONSTRAINT "labels_color_format" CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
    CONSTRAINT "labels_version_positive" CHECK ("version" >= 1)
);

ALTER TABLE "one_time_tokens"
    ADD COLUMN "invitation_id" UUID,
    ALTER COLUMN "user_id" DROP NOT NULL,
    ADD CONSTRAINT "one_time_tokens_target_matches_purpose" CHECK (
        (
            "purpose" IN ('EMAIL_VERIFICATION', 'PASSWORD_RESET') AND
            "user_id" IS NOT NULL AND
            "invitation_id" IS NULL
        ) OR
        (
            "purpose" = 'WORKSPACE_INVITATION' AND
            "user_id" IS NULL AND
            "invitation_id" IS NOT NULL
        )
    );

CREATE UNIQUE INDEX "workspace_invitations_workspace_id_id_key" ON "workspace_invitations"("workspace_id", "id");
CREATE INDEX "workspace_invitations_workspace_id_created_at_id_idx" ON "workspace_invitations"("workspace_id", "created_at", "id");
CREATE INDEX "workspace_invitations_accepted_by_user_id_idx" ON "workspace_invitations"("accepted_by_user_id");
CREATE UNIQUE INDEX "workspace_invitations_pending_email_key" ON "workspace_invitations"("workspace_id", "normalized_email")
    WHERE "accepted_at" IS NULL AND "canceled_at" IS NULL;

CREATE UNIQUE INDEX "labels_workspace_id_id_key" ON "labels"("workspace_id", "id");
CREATE INDEX "labels_workspace_id_archived_at_updated_at_id_idx" ON "labels"("workspace_id", "archived_at", "updated_at", "id");
CREATE UNIQUE INDEX "labels_active_normalized_name_key" ON "labels"("workspace_id", "normalized_name")
    WHERE "archived_at" IS NULL;

CREATE INDEX "one_time_tokens_invitation_id_purpose_idx" ON "one_time_tokens"("invitation_id", "purpose");
CREATE UNIQUE INDEX "one_time_tokens_active_invitation_target_key" ON "one_time_tokens"("invitation_id", "purpose")
    WHERE "invitation_id" IS NOT NULL AND "used_at" IS NULL AND "revoked_at" IS NULL;

ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_invited_by_membership_id_fkey" FOREIGN KEY ("workspace_id", "invited_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_user_id_fkey" FOREIGN KEY ("accepted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "labels" ADD CONSTRAINT "labels_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "workspace_invitations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

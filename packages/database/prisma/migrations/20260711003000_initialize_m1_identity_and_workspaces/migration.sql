CREATE TYPE "TokenPurpose" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "EmailTemplateType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');
CREATE TYPE "MembershipRole" AS ENUM ('ADMIN', 'MEMBER');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "StateCategory" AS ENUM ('BACKLOG', 'UNSTARTED', 'STARTED', 'COMPLETED', 'CANCELED');

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "normalized_email" VARCHAR(254) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" VARCHAR(50) NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_not_blank" CHECK (char_length(btrim("email")) > 0),
    CONSTRAINT "users_normalized_email_not_blank" CHECK (char_length("normalized_email") > 0),
    CONSTRAINT "users_normalized_email_matches" CHECK ("normalized_email" = lower(btrim("email"))),
    CONSTRAINT "users_display_name_not_blank" CHECK (char_length(btrim("display_name")) > 0),
    CONSTRAINT "users_password_hash_not_blank" CHECK (char_length("password_hash") > 0)
);

CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sessions_token_hash_sha256" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "sessions_expiration_order" CHECK ("idle_expires_at" <= "absolute_expires_at")
);

CREATE TABLE "one_time_tokens" (
    "id" UUID NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" BYTEA NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "one_time_tokens_token_hash_sha256" CHECK (octet_length("token_hash") = 32),
    CONSTRAINT "one_time_tokens_expire_after_creation" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "one_time_tokens_terminal_state_exclusive" CHECK (num_nonnulls("used_at", "revoked_at") <= 1)
);

CREATE TABLE "auth_rate_limit_buckets" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(100) NOT NULL,
    "key_hash" BYTEA NOT NULL,
    "window_started_at" TIMESTAMPTZ(3) NOT NULL,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "blocked_until" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "auth_rate_limit_buckets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_rate_limit_buckets_scope_not_blank" CHECK (char_length(btrim("scope")) > 0),
    CONSTRAINT "auth_rate_limit_buckets_key_hash_sha256" CHECK (octet_length("key_hash") = 32),
    CONSTRAINT "auth_rate_limit_buckets_attempt_count_nonnegative" CHECK ("attempt_count" >= 0),
    CONSTRAINT "auth_rate_limit_buckets_expiration_order" CHECK ("expires_at" > "window_started_at")
);

CREATE TABLE "email_deliveries" (
    "id" UUID NOT NULL,
    "outbox_event_id" UUID NOT NULL,
    "template_type" "EmailTemplateType" NOT NULL,
    "recipient_email" VARCHAR(254) NOT NULL,
    "provider_message_id" VARCHAR(255),
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "last_error_code" VARCHAR(100),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "email_deliveries_recipient_not_blank" CHECK (char_length(btrim("recipient_email")) > 0),
    CONSTRAINT "email_deliveries_terminal_state_exclusive" CHECK (num_nonnulls("sent_at", "failed_at") <= 1),
    CONSTRAINT "email_deliveries_provider_message_on_success" CHECK (("sent_at" IS NULL) = ("provider_message_id" IS NULL))
);

CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "normalized_slug" VARCHAR(50) NOT NULL,
    "next_feature_issue_number" INTEGER NOT NULL DEFAULT 1,
    "created_by_user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspaces_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "workspaces_slug_format" CHECK ("normalized_slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length("normalized_slug") BETWEEN 3 AND 50),
    CONSTRAINT "workspaces_slug_normalized" CHECK ("normalized_slug" = lower(btrim("slug"))),
    CONSTRAINT "workspaces_next_feature_issue_number_positive" CHECK ("next_feature_issue_number" >= 1),
    CONSTRAINT "workspaces_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "workspace_memberships" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "invited_by_membership_id" UUID,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workspace_memberships_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_memberships_status_timestamps" CHECK (
        ("status" = 'ACTIVE' AND "deactivated_at" IS NULL) OR
        ("status" = 'INACTIVE' AND "deactivated_at" IS NOT NULL)
    ),
    CONSTRAINT "workspace_memberships_inviter_not_self" CHECK ("invited_by_membership_id" IS NULL OR "invited_by_membership_id" <> "id")
);

CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "key" VARCHAR(5) NOT NULL,
    "next_issue_number" INTEGER NOT NULL DEFAULT 1,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "teams_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "teams_normalized_name_not_blank" CHECK (char_length("normalized_name") > 0),
    CONSTRAINT "teams_normalized_name_matches" CHECK ("normalized_name" = lower(btrim("name"))),
    CONSTRAINT "teams_key_format" CHECK ("key" ~ '^[A-Z]{2,5}$'),
    CONSTRAINT "teams_next_issue_number_positive" CHECK ("next_issue_number" >= 1),
    CONSTRAINT "teams_version_positive" CHECK ("version" >= 1)
);

CREATE TABLE "team_members" (
    "workspace_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "joined_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removed_at" TIMESTAMPTZ(3),

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("team_id", "membership_id"),
    CONSTRAINT "team_members_removal_order" CHECK ("removed_at" IS NULL OR "removed_at" >= "joined_at")
);

CREATE TABLE "workflow_states" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "normalized_name" VARCHAR(100) NOT NULL,
    "category" "StateCategory" NOT NULL,
    "position" INTEGER NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "workflow_states_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workflow_states_name_not_blank" CHECK (char_length(btrim("name")) > 0),
    CONSTRAINT "workflow_states_normalized_name_not_blank" CHECK (char_length("normalized_name") > 0),
    CONSTRAINT "workflow_states_normalized_name_matches" CHECK ("normalized_name" = lower(btrim("name"))),
    CONSTRAINT "workflow_states_position_nonnegative" CHECK ("position" >= 0),
    CONSTRAINT "workflow_states_version_positive" CHECK ("version" >= 1)
);

ALTER TABLE "outbox_events"
    ADD CONSTRAINT "outbox_events_actor_requires_workspace"
    CHECK ("actor_membership_id" IS NULL OR "workspace_id" IS NOT NULL);

CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_active_idle_expiration_idx" ON "sessions"("idle_expires_at", "id") WHERE "revoked_at" IS NULL;
CREATE INDEX "sessions_active_absolute_expiration_idx" ON "sessions"("absolute_expires_at", "id") WHERE "revoked_at" IS NULL;
CREATE UNIQUE INDEX "one_time_tokens_token_hash_key" ON "one_time_tokens"("token_hash");
CREATE INDEX "one_time_tokens_user_id_purpose_idx" ON "one_time_tokens"("user_id", "purpose");
CREATE UNIQUE INDEX "one_time_tokens_active_target_key" ON "one_time_tokens"("user_id", "purpose") WHERE "used_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "one_time_tokens_active_expiration_idx" ON "one_time_tokens"("expires_at", "id") WHERE "used_at" IS NULL AND "revoked_at" IS NULL;
CREATE INDEX "auth_rate_limit_buckets_expires_at_id_idx" ON "auth_rate_limit_buckets"("expires_at", "id");
CREATE UNIQUE INDEX "auth_rate_limit_buckets_scope_key_hash_window_started_at_key" ON "auth_rate_limit_buckets"("scope", "key_hash", "window_started_at");
CREATE UNIQUE INDEX "email_deliveries_outbox_event_id_key" ON "email_deliveries"("outbox_event_id");
CREATE UNIQUE INDEX "workspaces_normalized_slug_key" ON "workspaces"("normalized_slug");
CREATE UNIQUE INDEX "workspace_memberships_user_id_key" ON "workspace_memberships"("user_id");
CREATE INDEX "workspace_memberships_workspace_id_status_idx" ON "workspace_memberships"("workspace_id", "status");
CREATE UNIQUE INDEX "workspace_memberships_workspace_id_id_key" ON "workspace_memberships"("workspace_id", "id");
CREATE INDEX "teams_workspace_id_archived_at_idx" ON "teams"("workspace_id", "archived_at");
CREATE UNIQUE INDEX "teams_workspace_id_id_key" ON "teams"("workspace_id", "id");
CREATE UNIQUE INDEX "teams_workspace_id_key_key" ON "teams"("workspace_id", "key");
CREATE UNIQUE INDEX "teams_active_normalized_name_key" ON "teams"("workspace_id", "normalized_name") WHERE "archived_at" IS NULL;
CREATE INDEX "team_members_workspace_id_membership_id_idx" ON "team_members"("workspace_id", "membership_id");
CREATE UNIQUE INDEX "team_members_workspace_id_team_id_membership_id_key" ON "team_members"("workspace_id", "team_id", "membership_id");
CREATE UNIQUE INDEX "workflow_states_workspace_id_id_key" ON "workflow_states"("workspace_id", "id");
CREATE UNIQUE INDEX "workflow_states_team_id_normalized_name_key" ON "workflow_states"("team_id", "normalized_name");
CREATE UNIQUE INDEX "workflow_states_team_id_position_key" ON "workflow_states"("team_id", "position");
CREATE UNIQUE INDEX "workflow_states_team_default_key" ON "workflow_states"("team_id") WHERE "is_default";

ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_actor_membership_id_fkey" FOREIGN KEY ("workspace_id", "actor_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "email_deliveries" ADD CONSTRAINT "email_deliveries_outbox_event_id_fkey" FOREIGN KEY ("outbox_event_id") REFERENCES "outbox_events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workspace_memberships" ADD CONSTRAINT "workspace_memberships_workspace_id_invited_by_membership_i_fkey" FOREIGN KEY ("workspace_id", "invited_by_membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspace_id_team_id_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspace_id_membership_id_fkey" FOREIGN KEY ("workspace_id", "membership_id") REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "workflow_states" ADD CONSTRAINT "workflow_states_workspace_id_team_id_fkey" FOREIGN KEY ("workspace_id", "team_id") REFERENCES "teams"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

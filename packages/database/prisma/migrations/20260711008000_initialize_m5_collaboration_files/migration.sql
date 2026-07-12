CREATE TYPE "FileScope" AS ENUM ('USER_PROFILE', 'WORKSPACE');
CREATE TYPE "IssueFileKind" AS ENUM (
    'ISSUE_ATTACHMENT',
    'DESCRIPTION_IMAGE',
    'COMMENT_IMAGE',
    'HANDOFF_IMAGE'
);

ALTER TABLE "issues"
    ADD COLUMN "description_markdown" TEXT,
    ADD CONSTRAINT "issues_description_markdown_valid" CHECK (
        "description_markdown" IS NULL
        OR (
            char_length(btrim("description_markdown")) > 0
            AND char_length("description_markdown") <= 100000
        )
    );

CREATE TABLE "comments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "author_membership_id" UUID NOT NULL,
    "body_markdown" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "comments_version_positive" CHECK ("version" >= 1),
    CONSTRAINT "comments_body_delete_state_consistent" CHECK (
        (
            "deleted_at" IS NULL
            AND "body_markdown" IS NOT NULL
            AND char_length(btrim("body_markdown")) > 0
            AND char_length("body_markdown") <= 50000
        )
        OR (
            "deleted_at" IS NOT NULL
            AND "body_markdown" IS NULL
        )
    )
);

CREATE TABLE "mentions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "comment_id" UUID,
    "mentioned_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "scope" "FileScope" NOT NULL,
    "workspace_id" UUID,
    "uploaded_by_user_id" UUID NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "detected_mime_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "unlinked_at" TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "files_scope_workspace_consistent" CHECK (
        (
            "scope" = 'USER_PROFILE'::"FileScope"
            AND "workspace_id" IS NULL
        )
        OR (
            "scope" = 'WORKSPACE'::"FileScope"
            AND "workspace_id" IS NOT NULL
        )
    ),
    CONSTRAINT "files_size_bytes_valid" CHECK (
        "size_bytes" >= 1 AND "size_bytes" <= 26214400
    ),
    CONSTRAINT "files_storage_key_not_blank" CHECK (
        char_length(btrim("storage_key")) > 0
    ),
    CONSTRAINT "files_original_name_not_blank" CHECK (
        char_length(btrim("original_name")) > 0
    ),
    CONSTRAINT "files_detected_mime_type_not_blank" CHECK (
        char_length(btrim("detected_mime_type")) > 0
    )
);

CREATE TABLE "issue_file_attachments" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "kind" "IssueFileKind" NOT NULL,
    "comment_id" UUID,
    "api_handoff_id" UUID,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_file_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "issue_file_attachments_kind_anchors_consistent" CHECK (
        (
            "kind" IN (
                'ISSUE_ATTACHMENT'::"IssueFileKind",
                'DESCRIPTION_IMAGE'::"IssueFileKind"
            )
            AND "comment_id" IS NULL
            AND "api_handoff_id" IS NULL
        )
        OR (
            "kind" = 'COMMENT_IMAGE'::"IssueFileKind"
            AND "comment_id" IS NOT NULL
            AND "api_handoff_id" IS NULL
        )
        OR (
            "kind" = 'HANDOFF_IMAGE'::"IssueFileKind"
            AND "comment_id" IS NULL
            AND "api_handoff_id" IS NOT NULL
        )
    )
);

ALTER TABLE "users" ADD COLUMN "avatar_file_id" UUID;

CREATE UNIQUE INDEX "users_avatar_file_id_key"
    ON "users"("avatar_file_id");

CREATE UNIQUE INDEX "comments_workspace_id_id_key"
    ON "comments"("workspace_id", "id");
CREATE UNIQUE INDEX "comments_workspace_id_issue_id_id_key"
    ON "comments"("workspace_id", "issue_id", "id");
CREATE INDEX "comments_workspace_id_issue_id_created_at_id_idx"
    ON "comments"("workspace_id", "issue_id", "created_at", "id");

CREATE UNIQUE INDEX "mentions_comment_id_mentioned_membership_id_key"
    ON "mentions"("comment_id", "mentioned_membership_id");
CREATE UNIQUE INDEX "mentions_description_membership_key"
    ON "mentions"("issue_id", "mentioned_membership_id")
    WHERE "comment_id" IS NULL;
CREATE INDEX "mentions_workspace_id_issue_id_created_at_id_idx"
    ON "mentions"("workspace_id", "issue_id", "created_at", "id");
CREATE INDEX "mentions_workspace_id_mentioned_membership_id_created_idx"
    ON "mentions"("workspace_id", "mentioned_membership_id", "created_at", "id");

CREATE UNIQUE INDEX "files_storage_key_key"
    ON "files"("storage_key");
CREATE UNIQUE INDEX "files_workspace_id_id_key"
    ON "files"("workspace_id", "id");
CREATE INDEX "files_unlinked_at_id_idx"
    ON "files"("unlinked_at", "id")
    WHERE "unlinked_at" IS NOT NULL;

CREATE UNIQUE INDEX "issue_file_attachments_file_id_key"
    ON "issue_file_attachments"("file_id");
CREATE INDEX "issue_file_attachments_workspace_id_issue_id_created_at_id_idx"
    ON "issue_file_attachments"("workspace_id", "issue_id", "created_at", "id");

CREATE UNIQUE INDEX "api_handoffs_workspace_id_issue_id_id_key"
    ON "api_handoffs"("workspace_id", "issue_id", "id");

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_workspace_id_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "comments"
    ADD CONSTRAINT "comments_workspace_id_author_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "author_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mentions"
    ADD CONSTRAINT "mentions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mentions"
    ADD CONSTRAINT "mentions_workspace_id_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentions"
    ADD CONSTRAINT "mentions_workspace_id_issue_id_comment_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id", "comment_id")
    REFERENCES "comments"("workspace_id", "issue_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mentions"
    ADD CONSTRAINT "mentions_workspace_id_mentioned_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "mentioned_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "files"
    ADD CONSTRAINT "files_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "files"
    ADD CONSTRAINT "files_uploaded_by_user_id_fkey"
    FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "users"
    ADD CONSTRAINT "users_avatar_file_id_fkey"
    FOREIGN KEY ("avatar_file_id") REFERENCES "files"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_id_issue_id_fkey"
    FOREIGN KEY ("workspace_id", "issue_id")
    REFERENCES "issues"("workspace_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_id_file_id_fkey"
    FOREIGN KEY ("workspace_id", "file_id")
    REFERENCES "files"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_issue_comment_fkey"
    FOREIGN KEY ("workspace_id", "issue_id", "comment_id")
    REFERENCES "comments"("workspace_id", "issue_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_issue_handoff_fkey"
    FOREIGN KEY ("workspace_id", "issue_id", "api_handoff_id")
    REFERENCES "api_handoffs"("workspace_id", "issue_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "issue_file_attachments"
    ADD CONSTRAINT "issue_file_attachments_workspace_creator_fkey"
    FOREIGN KEY ("workspace_id", "created_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "notifications"
    ADD CONSTRAINT "notifications_workspace_issue_comment_fkey"
    FOREIGN KEY ("workspace_id", "issue_id", "comment_id")
    REFERENCES "comments"("workspace_id", "issue_id", "id")
    ON DELETE CASCADE ON UPDATE CASCADE;

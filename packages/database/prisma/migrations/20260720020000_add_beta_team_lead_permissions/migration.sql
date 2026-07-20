CREATE TYPE "TeamMemberRole" AS ENUM ('MEMBER', 'LEAD');

ALTER TABLE "teams"
    ADD COLUMN "description" VARCHAR(500);

ALTER TABLE "team_members"
    ADD COLUMN "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER';

ALTER TABLE "team_members"
    ADD CONSTRAINT "team_members_removed_not_lead"
    CHECK ("removed_at" IS NULL OR "role" = 'MEMBER'::"TeamMemberRole");

CREATE INDEX "team_members_workspace_id_membership_id_role_idx"
    ON "team_members"("workspace_id", "membership_id", "role")
    WHERE "removed_at" IS NULL;

ALTER TABLE "workflow_states"
    ADD COLUMN "disabled_at" TIMESTAMPTZ(3);

CREATE INDEX "workflow_states_workspace_id_team_id_disabled_at_idx"
    ON "workflow_states"("workspace_id", "team_id", "disabled_at");

CREATE TABLE "workspace_invitation_teams" (
    "workspace_id" UUID NOT NULL,
    "invitation_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "invited_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_invitation_teams_pkey" PRIMARY KEY ("invitation_id", "team_id")
);

CREATE UNIQUE INDEX "workspace_invitation_teams_workspace_id_invitation_id_team_id_key"
    ON "workspace_invitation_teams"("workspace_id", "invitation_id", "team_id");

CREATE INDEX "workspace_invitation_teams_workspace_id_team_id_created_at_idx"
    ON "workspace_invitation_teams"("workspace_id", "team_id", "created_at");

ALTER TABLE "workspace_invitation_teams"
    ADD CONSTRAINT "workspace_invitation_teams_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_invitation_teams"
    ADD CONSTRAINT "workspace_invitation_teams_workspace_id_invitation_id_fkey"
    FOREIGN KEY ("workspace_id", "invitation_id")
    REFERENCES "workspace_invitations"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_invitation_teams"
    ADD CONSTRAINT "workspace_invitation_teams_workspace_id_team_id_fkey"
    FOREIGN KEY ("workspace_id", "team_id")
    REFERENCES "teams"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "workspace_invitation_teams"
    ADD CONSTRAINT "workspace_invitation_teams_workspace_id_invited_by_membership_id_fkey"
    FOREIGN KEY ("workspace_id", "invited_by_membership_id")
    REFERENCES "workspace_memberships"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

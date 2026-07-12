ALTER INDEX "export_audits_workspace_id_requested_by_membership_id_reques_id"
    RENAME TO "export_audits_requester_requested_at_id_idx";

ALTER TABLE "notifications"
    DROP CONSTRAINT "notifications_workspace_id_event_id_fkey";

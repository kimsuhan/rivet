import {
  EmailTemplateType,
  FileScope,
  IssueFileKind,
  IssuePriority,
  IssueStatus,
  MembershipRole,
  MembershipStatus,
  StateCategory,
  TokenPurpose,
} from './index';

describe('database enum contract', () => {
  it('exposes the account and workspace invitation token and email purposes', () => {
    expect(TokenPurpose).toEqual({
      EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
      PASSWORD_RESET: 'PASSWORD_RESET',
      WORKSPACE_INVITATION: 'WORKSPACE_INVITATION',
    });
    expect(EmailTemplateType).toEqual({
      EMAIL_VERIFICATION: 'EMAIL_VERIFICATION',
      PASSWORD_RESET: 'PASSWORD_RESET',
      WORKSPACE_INVITATION: 'WORKSPACE_INVITATION',
    });
  });

  it('keeps membership and workflow values aligned with the fixed domain codes', () => {
    expect(MembershipRole).toEqual({ ADMIN: 'ADMIN', MEMBER: 'MEMBER' });
    expect(MembershipStatus).toEqual({ ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE' });
    expect(StateCategory).toEqual({
      BACKLOG: 'BACKLOG',
      CANCELED: 'CANCELED',
      COMPLETED: 'COMPLETED',
      STARTED: 'STARTED',
      UNSTARTED: 'UNSTARTED',
    });
  });

  it('keeps the issue status and priority values aligned with the fixed domain codes', () => {
    expect(IssueStatus).toEqual({
      CANCELED: 'CANCELED',
      DONE: 'DONE',
      IN_PROGRESS: 'IN_PROGRESS',
      PAUSED: 'PAUSED',
      REVIEW: 'REVIEW',
      TODO: 'TODO',
      UNSORTED: 'UNSORTED',
    });
    expect(IssuePriority).toEqual({
      HIGH: 'HIGH',
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      NONE: 'NONE',
      URGENT: 'URGENT',
    });
  });

  it('keeps the M5 file scope and attachment kind values aligned with the fixed domain codes', () => {
    expect(FileScope).toEqual({ USER_PROFILE: 'USER_PROFILE', WORKSPACE: 'WORKSPACE' });
    expect(IssueFileKind).toEqual({
      COMMENT_IMAGE: 'COMMENT_IMAGE',
      DESCRIPTION_IMAGE: 'DESCRIPTION_IMAGE',
      HANDOFF_IMAGE: 'HANDOFF_IMAGE',
      ISSUE_ATTACHMENT: 'ISSUE_ATTACHMENT',
    });
  });
});

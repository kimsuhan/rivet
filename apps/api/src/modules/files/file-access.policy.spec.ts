import { FileScope, IssueFileKind } from '@rivet/database';

import { bodyAttachmentWhere, canAccessFile } from './file-access.policy';
import type { FileAccessRow } from './file-response.mapper';

describe('file access policy', () => {
  const userId = '2e0792d5-eac3-44c1-87c7-56f07ebaa620';
  const workspaceId = '3dc0b213-eafa-450c-ad12-49a7d927c7b8';
  const file = {
    avatarUser: null,
    createdAt: new Date('2026-07-17T00:00:00.000Z'),
    detectedMimeType: 'image/png',
    id: '953685f0-4921-41cd-8422-d8a1ccc3f547',
    issueAttachments: [],
    originalName: 'image.png',
    scope: FileScope.WORKSPACE,
    sizeBytes: 100n,
    storageKey: 'objects/953685f0-4921-41cd-8422-d8a1ccc3f547',
    uploadedByUserId: userId,
  } satisfies FileAccessRow;

  it('allows an uploader to read an unlinked file and rejects another user', () => {
    expect(canAccessFile(file, { userId, workspaceId })).toBe(true);
    expect(
      canAccessFile(file, {
        userId: 'dd151af4-f97e-4cf2-ab03-43be72bb2782',
        workspaceId,
      }),
    ).toBe(false);
  });

  it('allows a linked issue file only inside the current workspace', () => {
    const linked = { ...file, issueAttachments: [{ workspaceId }] } satisfies FileAccessRow;
    expect(canAccessFile(linked, { userId: 'other-user', workspaceId })).toBe(true);
    expect(
      canAccessFile(linked, {
        userId: 'other-user',
        workspaceId: '05ed9724-f207-447d-9f18-7026f493d3fd',
      }),
    ).toBe(false);
  });

  it('builds a description image scope and rejects conflicting anchors', () => {
    expect(
      bodyAttachmentWhere(workspaceId, 'issue-id', IssueFileKind.DESCRIPTION_IMAGE, {}),
    ).toEqual({
      apiHandoffId: null,
      commentId: null,
      issueId: 'issue-id',
      kind: IssueFileKind.DESCRIPTION_IMAGE,
      workspaceId,
    });
    expect(() =>
      bodyAttachmentWhere(workspaceId, 'issue-id', IssueFileKind.DESCRIPTION_IMAGE, {
        commentId: 'comment-id',
      }),
    ).toThrow(expect.objectContaining({ response: expect.objectContaining({ code: 'FILE_REFERENCE_INVALID' }) }));
  });
});

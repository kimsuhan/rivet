import { HttpStatus } from '@nestjs/common';

import { MembershipStatus, Prisma } from '@rivet/database';

import { ApiError } from '../errors/api-error';

const UUID_V4_SOURCE = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const FILE_REFERENCE_PATTERN = new RegExp(`^/files/(${UUID_V4_SOURCE})$`, 'iu');
const MENTION_REFERENCE_PATTERN = new RegExp(`^rivet-member:(${UUID_V4_SOURCE})$`, 'iu');
const INLINE_LINK_PATTERN = /(!?)\[([^\]\r\n]*)\]\(([^)\r\n]*)\)/gu;

export type ParsedMarkdown = {
  bodyMarkdown: string;
  fileIds: string[];
  mentionedMembershipIds: string[];
};

export type ParsedOptionalMarkdown = Omit<ParsedMarkdown, 'bodyMarkdown'> & {
  bodyMarkdown: string | null;
};

function invalidMarkdown(message = '안전하지 않은 Markdown은 저장할 수 없습니다.'): never {
  throw new ApiError({
    code: 'MARKDOWN_INVALID',
    message,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
}

function isSafeHttpUrl(value: string): boolean {
  if (value.trim() !== value || /\s/u.test(value)) return false;

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function parseMarkdown(value: string, maxLength: number): ParsedMarkdown {
  const bodyMarkdown = value.normalize('NFC').trim();
  if (bodyMarkdown.length === 0) {
    invalidMarkdown('Markdown 내용을 입력해 주세요.');
  }
  if ([...bodyMarkdown].length > maxLength) {
    invalidMarkdown(`Markdown은 ${maxLength.toLocaleString('en-US')}자 이하여야 합니다.`);
  }

  const hasUnsafeControl = [...bodyMarkdown].some((character) => {
    const code = character.codePointAt(0)!;
    return (code < 32 && code !== 9 && code !== 10 && code !== 13) || (code >= 127 && code <= 159);
  });
  if (
    hasUnsafeControl ||
    /<!--|-->|<\/?[a-z][^>]*>/iu.test(bodyMarkdown) ||
    /\b(?:javascript|vbscript|data)\s*:/iu.test(bodyMarkdown) ||
    /!\[[^\]\r\n]*\]\s*\[[^\]\r\n]*\]/u.test(bodyMarkdown) ||
    /^[ ]{0,3}\[[^\]\r\n]+\]:/mu.test(bodyMarkdown)
  ) {
    invalidMarkdown();
  }

  const fileIds = new Set<string>();
  const mentionedMembershipIds = new Set<string>();
  for (const match of bodyMarkdown.matchAll(INLINE_LINK_PATTERN)) {
    const isImage = match[1] === '!';
    const label = match[2] ?? '';
    const target = match[3] ?? '';
    const mentionPrefixIndex = (match.index ?? 0) - 1;
    const hasMentionPrefix =
      !isImage &&
      mentionPrefixIndex >= 0 &&
      bodyMarkdown[mentionPrefixIndex] === '@' &&
      bodyMarkdown[mentionPrefixIndex - 1] !== '\\';

    if (isImage) {
      const fileReference = FILE_REFERENCE_PATTERN.exec(target);
      if (!fileReference) invalidMarkdown('본문 이미지는 업로드한 파일만 사용할 수 있습니다.');
      fileIds.add(fileReference[1]!.toLowerCase());
      continue;
    }

    const mentionReference = MENTION_REFERENCE_PATTERN.exec(target);
    if (hasMentionPrefix || mentionReference) {
      if (!hasMentionPrefix || !mentionReference || label.trim().length === 0) {
        invalidMarkdown('멘션 형식이 올바르지 않습니다.');
      }
      mentionedMembershipIds.add(mentionReference[1]!.toLowerCase());
      continue;
    }

    if (!isSafeHttpUrl(target)) {
      invalidMarkdown('링크는 사용자 정보가 없는 HTTP(S) URL만 사용할 수 있습니다.');
    }
  }

  return {
    bodyMarkdown,
    fileIds: [...fileIds].sort(),
    mentionedMembershipIds: [...mentionedMembershipIds].sort(),
  };
}

export function parseOptionalMarkdown(
  value: string | null | undefined,
  maxLength: number,
): ParsedOptionalMarkdown {
  if (value === null || value === undefined || value.normalize('NFC').trim().length === 0) {
    return { bodyMarkdown: null, fileIds: [], mentionedMembershipIds: [] };
  }
  return parseMarkdown(value, maxLength);
}

export async function assertActiveMentionMemberships(
  transaction: Prisma.TransactionClient,
  workspaceId: string,
  membershipIds: string[],
): Promise<void> {
  if (membershipIds.length === 0) return;

  const stableIds = [...new Set(membershipIds)].sort();
  const rows = await transaction.$queryRaw<Array<{ id: string; status: MembershipStatus }>>(
    Prisma.sql`
      SELECT "id", "status"
      FROM "workspace_memberships"
      WHERE "workspace_id" = ${workspaceId}::uuid
        AND "id" IN (${Prisma.join(stableIds.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY "id"
      FOR UPDATE
    `,
  );
  if (
    rows.length !== stableIds.length ||
    rows.some(({ status }) => status !== MembershipStatus.ACTIVE)
  ) {
    throw new ApiError({
      code: 'MENTION_INVALID',
      message: '멘션 대상은 현재 워크스페이스의 활성 멤버여야 합니다.',
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  }
}

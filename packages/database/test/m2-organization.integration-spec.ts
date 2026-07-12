import { randomBytes, randomUUID } from 'node:crypto';

import { createPrismaClient, MembershipRole, TokenPurpose } from '../src';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL 환경 변수가 필요합니다.');
}

const prisma = createPrismaClient({
  connectionTimeoutMs: 5_000,
  databaseUrl,
  idleTimeoutMs: 10_000,
  poolMax: 2,
});

let userIds: string[] = [];
let workspaceIds: string[] = [];

async function createUser(): Promise<string> {
  const userId = randomUUID();
  const email = `${userId}@example.test`;
  userIds.push(userId);
  await prisma.user.create({
    data: {
      displayName: 'M2 테스트 사용자',
      email,
      id: userId,
      normalizedEmail: email,
      passwordHash: '$argon2id$m2-test-fixture',
    },
  });

  return userId;
}

async function createWorkspaceMembership(): Promise<{
  membershipId: string;
  userId: string;
  workspaceId: string;
}> {
  const membershipId = randomUUID();
  const userId = await createUser();
  const workspaceId = randomUUID();
  workspaceIds.push(workspaceId);

  await prisma.$transaction(async (transaction) => {
    await transaction.workspace.create({
      data: {
        createdByUserId: userId,
        id: workspaceId,
        name: 'M2 테스트 워크스페이스',
        normalizedSlug: `m2-${workspaceId}`,
        slug: `m2-${workspaceId}`,
      },
    });
    await transaction.workspaceMembership.create({
      data: {
        id: membershipId,
        role: MembershipRole.ADMIN,
        userId,
        workspaceId,
      },
    });
  });

  return { membershipId, userId, workspaceId };
}

describe('M2 organization database integration', () => {
  beforeEach(() => {
    userIds = [];
    workspaceIds = [];
  });

  afterEach(async () => {
    await prisma.oneTimeToken.deleteMany({
      where: {
        OR: [{ userId: { in: userIds } }, { invitation: { workspaceId: { in: workspaceIds } } }],
      },
    });
    await prisma.workspaceInvitation.deleteMany({
      where: { workspaceId: { in: workspaceIds } },
    });
    await prisma.label.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
    await prisma.workspaceMembership.deleteMany({
      where: { OR: [{ workspaceId: { in: workspaceIds } }, { userId: { in: userIds } }] },
    });
    await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('keeps only one pending invitation per normalized workspace email', async () => {
    const { membershipId, workspaceId } = await createWorkspaceMembership();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
    const invitation = await prisma.workspaceInvitation.create({
      data: {
        email: 'Invitee@Example.com',
        expiresAt,
        invitedByMembershipId: membershipId,
        normalizedEmail: 'invitee@example.com',
        workspaceId,
      },
    });

    await expect(
      prisma.workspaceInvitation.create({
        data: {
          email: 'INVITEE@example.com',
          expiresAt,
          invitedByMembershipId: membershipId,
          normalizedEmail: 'invitee@example.com',
          workspaceId,
        },
      }),
    ).rejects.toThrow();
    await prisma.workspaceInvitation.update({
      data: { canceledAt: new Date() },
      where: { id: invitation.id },
    });
    await expect(
      prisma.workspaceInvitation.create({
        data: {
          email: 'invitee@example.com',
          expiresAt,
          invitedByMembershipId: membershipId,
          normalizedEmail: 'invitee@example.com',
          workspaceId,
        },
      }),
    ).resolves.toBeDefined();
  });

  it('enforces invitation state and workspace-scoped inviter constraints', async () => {
    const first = await createWorkspaceMembership();
    const second = await createWorkspaceMembership();
    const acceptedByUserId = await createUser();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);

    await expect(
      prisma.workspaceInvitation.create({
        data: {
          email: 'cross-workspace@example.com',
          expiresAt,
          invitedByMembershipId: second.membershipId,
          normalizedEmail: 'cross-workspace@example.com',
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.workspaceInvitation.create({
        data: {
          acceptedByUserId,
          email: 'invalid-state@example.com',
          expiresAt,
          invitedByMembershipId: first.membershipId,
          normalizedEmail: 'invalid-state@example.com',
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.workspaceInvitation.create({
        data: {
          acceptedAt: new Date(),
          acceptedByUserId,
          canceledAt: new Date(),
          email: 'conflicting-state@example.com',
          expiresAt,
          invitedByMembershipId: first.membershipId,
          normalizedEmail: 'conflicting-state@example.com',
          workspaceId: first.workspaceId,
        },
      }),
    ).rejects.toThrow();
  });

  it('matches one-time token targets to their purpose and active invitation', async () => {
    const { membershipId, userId, workspaceId } = await createWorkspaceMembership();
    const invitation = await prisma.workspaceInvitation.create({
      data: {
        email: 'token-target@example.com',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000),
        invitedByMembershipId: membershipId,
        normalizedEmail: 'token-target@example.com',
        workspaceId,
      },
    });
    const expiresAt = new Date(Date.now() + 60_000);
    const firstToken = await prisma.oneTimeToken.create({
      data: {
        expiresAt,
        invitationId: invitation.id,
        purpose: TokenPurpose.WORKSPACE_INVITATION,
        tokenHash: randomBytes(32),
      },
    });

    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt,
          invitationId: invitation.id,
          purpose: TokenPurpose.WORKSPACE_INVITATION,
          tokenHash: randomBytes(32),
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt,
          purpose: TokenPurpose.WORKSPACE_INVITATION,
          tokenHash: randomBytes(32),
          userId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt,
          invitationId: invitation.id,
          purpose: TokenPurpose.EMAIL_VERIFICATION,
          tokenHash: randomBytes(32),
        },
      }),
    ).rejects.toThrow();

    await prisma.oneTimeToken.update({
      data: { revokedAt: new Date() },
      where: { id: firstToken.id },
    });
    await expect(
      prisma.oneTimeToken.create({
        data: {
          expiresAt,
          invitationId: invitation.id,
          purpose: TokenPurpose.WORKSPACE_INVITATION,
          tokenHash: randomBytes(32),
        },
      }),
    ).resolves.toBeDefined();
  });

  it('enforces active label names, normalization, color, and version constraints', async () => {
    const { workspaceId } = await createWorkspaceMembership();
    const label = await prisma.label.create({
      data: {
        color: '#D84A4A',
        name: 'Bug',
        normalizedName: 'bug',
        workspaceId,
      },
    });

    await expect(
      prisma.label.create({
        data: {
          color: '#112233',
          name: 'BUG',
          normalizedName: 'bug',
          workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.label.create({
        data: {
          color: 'red',
          name: 'Invalid color',
          normalizedName: 'invalid color',
          workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.label.create({
        data: {
          color: '#112233',
          name: 'Normalized',
          normalizedName: 'NORMALIZED',
          workspaceId,
        },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.label.create({
        data: {
          color: '#112233',
          name: 'Invalid version',
          normalizedName: 'invalid version',
          version: 0,
          workspaceId,
        },
      }),
    ).rejects.toThrow();

    await prisma.label.update({ data: { archivedAt: new Date() }, where: { id: label.id } });
    await expect(
      prisma.label.create({
        data: {
          color: '#112233',
          name: 'BUG',
          normalizedName: 'bug',
          workspaceId,
        },
      }),
    ).resolves.toBeDefined();
  });
});

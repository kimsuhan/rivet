import { createHmac, randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/bootstrap';
import { DatabaseService } from '../src/common/database/database.service';
import { AuthSessionService } from '../src/modules/auth/auth-session.service';
import { createCsrfToken, createOneTimeToken } from '../src/modules/auth/auth-token.crypto';
import { hashPassword } from '../src/modules/auth/password.crypto';

const WEB_ORIGIN = 'http://localhost:3000';
const CSRF_HMAC_KEY = 'test-csrf-hmac-key-with-at-least-32-bytes';
const TOKEN_HMAC_KEY = 'test-token-hmac-key-with-at-least-32-bytes';
const RATE_LIMIT_HMAC_KEY = 'test-rate-hmac-key-with-at-least-32-bytes';
const PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$u5oksZN2qlFVAyszxdWrug$xmy/xfzl6zj7sfdlIBgb2F6zHrOnBcsxDzJEO7QyG0A';
const INVITEE_PASSWORD = 'invitee secure password 2026';
const runId = randomUUID().slice(0, 8);
const emails = {
  admin: `m2.admin.${runId}@example.com`,
  canceled: `m2.canceled.${runId}@example.com`,
  crossList: `m2.cross-list.${runId}@example.com`,
  expired: `m2.expired.${runId}@example.com`,
  invitee: `m2.invitee.${runId}@example.com`,
  mismatch: `m2.mismatch.${runId}@example.com`,
  other: `m2.other.${runId}@example.com`,
  rateLimited: `m2.rate-limited.${runId}@example.com`,
  teamTarget: `m2.team-target.${runId}@example.com`,
  unregistered: `m2.unregistered.${runId}@example.com`,
};

function invitationContinuationCookie(headers: { 'set-cookie'?: string | string[] }): string {
  const setCookie = headers['set-cookie'];
  const cookies = typeof setCookie === 'string' ? [setCookie] : (setCookie ?? []);
  const continuation = cookies.find((cookie) => cookie.startsWith('rivet_invite_flow='));
  if (!continuation) {
    throw new Error('초대 진행 쿠키를 확인할 수 없습니다.');
  }

  return continuation.split(';', 1)[0]!;
}

function sessionCookie(headers: { 'set-cookie'?: string | string[] }): string {
  const setCookie = headers['set-cookie'];
  const cookies = typeof setCookie === 'string' ? [setCookie] : (setCookie ?? []);
  const session = cookies.find((cookie) => cookie.startsWith('rivet_session='));
  if (!session) {
    throw new Error('세션 쿠키를 확인할 수 없습니다.');
  }

  return session.split(';', 1)[0]!;
}

describe('M2 workspace invitations', () => {
  let app: INestApplication;
  let database: DatabaseService;
  let sessions: AuthSessionService;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let adminMembershipId: string;
  let teamId: string;
  let adminSessionToken: string;
  let adminCsrfToken: string;
  let inviteeSessionToken: string;
  let inviteeCsrfToken: string;
  let mismatchSessionToken: string;
  let mismatchCsrfToken: string;
  let otherSessionToken: string;
  let otherCsrfToken: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    configureApplication(app);
    await app.init();
    database = app.get(DatabaseService);
    sessions = app.get(AuthSessionService);
    await database.client.authRateLimitBucket.deleteMany();

    const createUser = (displayName: string, email: string) =>
      database.client.user.create({
        data: {
          displayName,
          email,
          emailVerifiedAt: new Date(),
          normalizedEmail: email,
          passwordHash: PASSWORD_HASH,
        },
        select: { id: true },
      });
    const [admin, invitee, mismatch, other] = await Promise.all([
      createUser('관리자', emails.admin),
      createUser('초대 대상', emails.invitee),
      createUser('다른 계정', emails.mismatch),
      createUser('다른 워크스페이스', emails.other),
    ]);
    userIds.push(admin.id, invitee.id, mismatch.id, other.id);
    await database.client.user.update({
      data: { passwordHash: await hashPassword(INVITEE_PASSWORD) },
      where: { id: invitee.id },
    });

    const workspace = await database.client.workspace.create({
      data: {
        createdByUserId: admin.id,
        name: 'M2 초대 워크스페이스',
        normalizedSlug: `m2-invite-${runId}`,
        slug: `m2-invite-${runId}`,
      },
      select: { id: true },
    });
    workspaceId = workspace.id;
    const adminMembership = await database.client.workspaceMembership.create({
      data: { role: 'ADMIN', status: 'ACTIVE', userId: admin.id, workspaceId },
      select: { id: true },
    });
    adminMembershipId = adminMembership.id;
    const team = await database.client.team.create({
      data: {
        key: 'MTT',
        name: 'M2 초대 팀',
        normalizedName: 'm2 초대 팀',
        workspaceId,
      },
      select: { id: true },
    });
    teamId = team.id;
    await database.client.teamMember.create({
      data: {
        membershipId: adminMembershipId,
        role: 'LEAD',
        teamId,
        workspaceId,
      },
    });

    const otherWorkspace = await database.client.workspace.create({
      data: {
        createdByUserId: other.id,
        name: '다른 워크스페이스',
        normalizedSlug: `m2-other-${runId}`,
        slug: `m2-other-${runId}`,
      },
      select: { id: true },
    });
    otherWorkspaceId = otherWorkspace.id;
    await database.client.workspaceMembership.create({
      data: { role: 'ADMIN', status: 'ACTIVE', userId: other.id, workspaceId: otherWorkspaceId },
    });

    const [adminSession, inviteeSession, mismatchSession, otherSession] = await Promise.all([
      sessions.create(admin.id),
      sessions.create(invitee.id),
      sessions.create(mismatch.id),
      sessions.create(other.id),
    ]);
    adminSessionToken = adminSession.token;
    adminCsrfToken = createCsrfToken(adminSessionToken, CSRF_HMAC_KEY);
    inviteeSessionToken = inviteeSession.token;
    inviteeCsrfToken = createCsrfToken(inviteeSessionToken, CSRF_HMAC_KEY);
    mismatchSessionToken = mismatchSession.token;
    mismatchCsrfToken = createCsrfToken(mismatchSessionToken, CSRF_HMAC_KEY);
    otherSessionToken = otherSession.token;
    otherCsrfToken = createCsrfToken(otherSessionToken, CSRF_HMAC_KEY);
  });

  afterAll(async () => {
    if (database) {
      const workspaceIds = [workspaceId, otherWorkspaceId].filter(Boolean);
      const invitations = await database.client.workspaceInvitation.findMany({
        select: { id: true },
        where: { workspaceId: { in: workspaceIds } },
      });
      const invitationIds = invitations.map(({ id }) => id);
      const outboxEvents = await database.client.outboxEvent.findMany({
        select: { id: true },
        where: {
          OR: [
            { aggregateId: { in: userIds } },
            { aggregateId: { in: invitationIds } },
            { workspaceId: { in: workspaceIds } },
          ],
        },
      });
      const outboxEventIds = outboxEvents.map(({ id }) => id);

      await database.client.emailDelivery.deleteMany({
        where: { outboxEventId: { in: outboxEventIds } },
      });
      await database.client.outboxEvent.deleteMany({ where: { id: { in: outboxEventIds } } });
      await database.client.oneTimeToken.deleteMany({
        where: {
          OR: [{ invitationId: { in: invitationIds } }, { userId: { in: userIds } }],
        },
      });
      await database.client.workspaceInvitationTeam.deleteMany({
        where: { invitationId: { in: invitationIds } },
      });
      await database.client.workspaceInvitation.deleteMany({
        where: { id: { in: invitationIds } },
      });
      await database.client.session.deleteMany({ where: { userId: { in: userIds } } });
      await database.client.teamMember.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workflowState.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.team.deleteMany({ where: { workspaceId: { in: workspaceIds } } });
      await database.client.workspaceMembership.deleteMany({
        where: { workspaceId: { in: workspaceIds } },
      });
      await database.client.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
      await database.client.user.deleteMany({ where: { id: { in: userIds } } });
      await database.client.authRateLimitBucket.deleteMany();
    }
    await app?.close();

    if (process.env.FILE_STORAGE_ROOT) {
      await rm(process.env.FILE_STORAGE_ROOT, { force: true, recursive: true });
    }
  });

  it('creates, previews, accepts, rejects, resends, cancels, and reopens invitations safely', async () => {
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: 'not-an-invitation-token' })
      .expect(422);
    expect(malformed.body.code).toBe('TOKEN_INVALID');

    const displayedInviteeEmail = emails.invitee.toUpperCase();
    const created = await request(app.getHttpServer())
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [displayedInviteeEmail, emails.invitee] })
      .expect(200);
    expect(created.body.items).toEqual([
      { email: displayedInviteeEmail, invitationId: expect.any(String), result: 'INVITED' },
    ]);

    const invitationId = created.body.items[0].invitationId as string;
    const issuedToken = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: { invitationId, purpose: 'WORKSPACE_INVITATION', revokedAt: null, usedAt: null },
    });
    await expect(
      database.client.outboxEvent.findFirst({
        select: { actorMembershipId: true, eventType: true, workspaceId: true },
        where: { aggregateId: invitationId, eventType: 'WORKSPACE_INVITATION_REQUESTED' },
      }),
    ).resolves.toEqual({
      actorMembershipId: adminMembershipId,
      eventType: 'WORKSPACE_INVITATION_REQUESTED',
      workspaceId,
    });
    const token = createOneTimeToken('WORKSPACE_INVITATION', TOKEN_HMAC_KEY, issuedToken.id).token;

    const preview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token })
      .expect(200);
    expect(preview.body).toMatchObject({
      emailMasked: 'M2***@EXAMPLE.COM',
      invitedByDisplayName: '관리자',
      nextAction: 'LOGIN',
      workspaceName: 'M2 초대 워크스페이스',
    });
    expect(preview.body.email).toBeUndefined();
    expect(preview.headers['cache-control']).toContain('no-store');
    expect(preview.headers['referrer-policy']).toBe('no-referrer');
    const continuationCookie = invitationContinuationCookie(preview.headers);

    const continuation = await request(app.getHttpServer())
      .get('/api/v1/auth/invitations/continuation')
      .set('Cookie', continuationCookie)
      .expect(200);
    expect(continuation.body).toMatchObject({
      email: displayedInviteeEmail,
      emailMasked: 'M2***@EXAMPLE.COM',
      nextAction: 'LOGIN',
      workspaceName: 'M2 초대 워크스페이스',
    });
    expect(continuation.headers['cache-control']).toContain('no-store');
    expect(continuation.headers['referrer-policy']).toBe('no-referrer');

    const mismatch = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', `rivet_session=${mismatchSessionToken}; ${continuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', mismatchCsrfToken)
      .expect(409);
    expect(mismatch.body.code).toBe('INVITATION_EMAIL_MISMATCH');

    const loggedIn = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Cookie', continuationCookie)
      .set('Origin', WEB_ORIGIN)
      .send({ email: emails.invitee, password: INVITEE_PASSWORD })
      .expect(200);
    expect(loggedIn.body.onboardingStep).toBe('ACCEPT_INVITATION');
    const boundSessionCookie = sessionCookie(loggedIn.headers);

    const recoveredOnAnotherDevice = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', boundSessionCookie)
      .expect(200);
    expect(recoveredOnAnotherDevice.body.onboardingStep).toBe('ACCEPT_INVITATION');

    const accepted = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', boundSessionCookie)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', String(loggedIn.body.csrfToken))
      .expect(200);
    expect(accepted.body).toMatchObject({
      accepted: true,
      joinedTeamIds: [teamId],
      membership: { role: 'MEMBER', status: 'ACTIVE' },
      workspace: { id: workspaceId, name: 'M2 초대 워크스페이스' },
    });
    expect(
      await database.client.workspaceMembership.count({
        where: { user: { normalizedEmail: emails.invitee } },
      }),
    ).toBe(1);
    await expect(
      database.client.teamMember.findUnique({
        select: { removedAt: true, role: true },
        where: {
          teamId_membershipId: {
            membershipId: accepted.body.membership.id as string,
            teamId,
          },
        },
      }),
    ).resolves.toEqual({ removedAt: null, role: 'MEMBER' });

    const joinedSession = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', boundSessionCookie)
      .expect(200);
    expect(joinedSession.body.membership).toMatchObject({
      ledTeamIds: [],
      teamIds: [teamId],
    });

    await database.client.teamMember.update({
      data: { role: 'LEAD' },
      where: {
        teamId_membershipId: {
          membershipId: accepted.body.membership.id as string,
          teamId,
        },
      },
    });
    const teamLeadCreated = await request(app.getHttpServer())
      .post(`/api/v1/teams/${teamId}/invitations`)
      .set('Cookie', `rivet_session=${inviteeSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', inviteeCsrfToken)
      .send({ emails: [emails.teamTarget] })
      .expect(200);
    expect(teamLeadCreated.body.items).toEqual([
      { email: emails.teamTarget, invitationId: expect.any(String), result: 'INVITED' },
    ]);
    const teamLeadInvitationId = teamLeadCreated.body.items[0].invitationId as string;

    const repeated = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', `rivet_session=${inviteeSessionToken}; ${continuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', inviteeCsrfToken)
      .expect(409);
    expect(repeated.body.code).toBe('TOKEN_ALREADY_USED');

    const memberDenied = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${inviteeSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', inviteeCsrfToken)
      .send({ emails: [emails.canceled] })
      .expect(403);
    expect(memberDenied.body.code).toBe('FORBIDDEN');

    const otherCreated = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [emails.other] })
      .expect(200);
    const otherInvitationId = otherCreated.body.items[0].invitationId as string;
    const otherIssuedToken = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: {
        invitationId: otherInvitationId,
        purpose: 'WORKSPACE_INVITATION',
        revokedAt: null,
        usedAt: null,
      },
    });
    const otherToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      otherIssuedToken.id,
    ).token;
    const otherContinuation = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: otherToken })
      .expect(200);
    const otherContinuationCookie = invitationContinuationCookie(otherContinuation.headers);
    const workspaceLimited = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', `rivet_session=${otherSessionToken}; ${otherContinuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrfToken)
      .expect(409);
    expect(workspaceLimited.body.code).toBe('WORKSPACE_LIMIT_REACHED');
    await request(app.getHttpServer())
      .delete('/api/v1/auth/invitations/continuation')
      .set('Cookie', `rivet_session=${otherSessionToken}; ${otherContinuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrfToken)
      .expect(204);
    const sessionAfterDismiss = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Cookie', `rivet_session=${otherSessionToken}`)
      .expect(200);
    expect(sessionAfterDismiss.body.onboardingStep).toBe('CREATE_TEAM');

    const canceledCreated = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [emails.canceled] })
      .expect(200);
    const canceledInvitationId = canceledCreated.body.items[0].invitationId as string;
    const originalCanceledTokenRow = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: { invitationId: canceledInvitationId, revokedAt: null, usedAt: null },
    });
    const originalCanceledToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      originalCanceledTokenRow.id,
    ).token;
    const originalCanceledOutbox = await database.client.outboxEvent.findFirstOrThrow({
      select: { id: true },
      where: {
        aggregateId: canceledInvitationId,
        canceledAt: null,
        eventType: 'WORKSPACE_INVITATION_REQUESTED',
        processedAt: null,
      },
    });
    const resent = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${canceledInvitationId}/resend`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    expect(resent.body.status).toBe('PENDING');
    expect(
      await database.client.oneTimeToken.count({
        where: { invitationId: canceledInvitationId, revokedAt: null, usedAt: null },
      }),
    ).toBe(1);
    const resentTokenRow = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: { invitationId: canceledInvitationId, revokedAt: null, usedAt: null },
    });
    const resentToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      resentTokenRow.id,
    ).token;
    const supersededPreview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: originalCanceledToken })
      .expect(422);
    expect(supersededPreview.body.code).toBe('TOKEN_INVALID');
    await expect(
      database.client.outboxEvent.findUniqueOrThrow({
        select: { canceledAt: true },
        where: { id: originalCanceledOutbox.id },
      }),
    ).resolves.toEqual({ canceledAt: expect.any(Date) });

    const canceled = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${canceledInvitationId}/cancel`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    expect(canceled.body.status).toBe('CANCELED');
    expect(
      await database.client.oneTimeToken.count({
        where: { invitationId: canceledInvitationId, revokedAt: null, usedAt: null },
      }),
    ).toBe(0);
    const canceledPreview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: resentToken })
      .expect(422);
    expect(canceledPreview.body.code).toBe('TOKEN_INVALID');

    const expiredCreated = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [emails.expired] })
      .expect(200);
    const expiredInvitationId = expiredCreated.body.items[0].invitationId as string;
    await database.client.workspaceInvitation.update({
      data: {
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000),
        expiresAt: new Date(Date.now() - 1_000),
      },
      where: { id: expiredInvitationId },
    });
    const expiredTokenRow = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: { invitationId: expiredInvitationId, revokedAt: null, usedAt: null },
    });
    const expiredToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      expiredTokenRow.id,
    ).token;
    const expiredPreview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: expiredToken })
      .expect(410);
    expect(expiredPreview.body.code).toBe('TOKEN_EXPIRED');
    const expiredBeforeResend = await database.client.workspaceInvitation.findUniqueOrThrow({
      select: { createdAt: true },
      where: { id: expiredInvitationId },
    });
    const reopened = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${expiredInvitationId}/resend`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    expect(reopened.body).toMatchObject({
      createdAt: expiredBeforeResend.createdAt.toISOString(),
      id: expiredInvitationId,
      status: 'PENDING',
    });
    const supersededExpiredPreview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: expiredToken })
      .expect(422);
    expect(supersededExpiredPreview.body.code).toBe('TOKEN_INVALID');

    const crossListCreated = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${otherSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', otherCsrfToken)
      .send({ emails: [emails.crossList] })
      .expect(200);
    const crossListInvitationId = crossListCreated.body.items[0].invitationId as string;

    const firstListPage = await request(app.getHttpServer())
      .get('/api/v1/invitations?limit=2')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200);
    expect(firstListPage.body.items).toHaveLength(2);
    expect(firstListPage.body.nextCursor).toEqual(expect.any(String));

    const secondListPage = await request(app.getHttpServer())
      .get(
        `/api/v1/invitations?limit=2&cursor=${encodeURIComponent(
          String(firstListPage.body.nextCursor),
        )}`,
      )
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200);
    expect(secondListPage.body.items).toHaveLength(2);
    expect(secondListPage.body.nextCursor).toEqual(expect.any(String));

    const thirdListPage = await request(app.getHttpServer())
      .get(
        `/api/v1/invitations?limit=2&cursor=${encodeURIComponent(
          String(secondListPage.body.nextCursor),
        )}`,
      )
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200);
    expect(thirdListPage.body.items).toHaveLength(1);
    expect(thirdListPage.body.nextCursor).toBeNull();

    const listedInvitations = [
      ...firstListPage.body.items,
      ...secondListPage.body.items,
      ...thirdListPage.body.items,
    ];
    expect(new Set(listedInvitations.map((invitation: { id: string }) => invitation.id)).size).toBe(
      5,
    );
    expect(listedInvitations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: invitationId, status: 'ACCEPTED' }),
        expect.objectContaining({ id: canceledInvitationId, status: 'CANCELED' }),
        expect.objectContaining({ id: expiredInvitationId, status: 'PENDING' }),
        expect.objectContaining({ id: teamLeadInvitationId, status: 'PENDING' }),
      ]),
    );
    expect(
      listedInvitations.some(
        (invitation: { id: string }) => invitation.id === crossListInvitationId,
      ),
    ).toBe(false);

    const pendingAndAccepted = await request(app.getHttpServer())
      .get('/api/v1/invitations?limit=100&status=PENDING%2CACCEPTED')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200);
    expect(
      pendingAndAccepted.body.items.every((invitation: { status: string }) =>
        ['PENDING', 'ACCEPTED'].includes(invitation.status),
      ),
    ).toBe(true);
    expect(pendingAndAccepted.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: invitationId, status: 'ACCEPTED' }),
        expect.objectContaining({ id: otherInvitationId, status: 'PENDING' }),
        expect.objectContaining({ id: expiredInvitationId, status: 'PENDING' }),
      ]),
    );
    expect(
      pendingAndAccepted.body.items.some(
        (invitation: { id: string }) => invitation.id === canceledInvitationId,
      ),
    ).toBe(false);

    await database.client.workspaceInvitation.update({
      data: { expiresAt: new Date(Date.now() - 1_000) },
      where: { id: expiredInvitationId },
    });
    const expiredOnly = await request(app.getHttpServer())
      .get('/api/v1/invitations?status=EXPIRED')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(200);
    expect(expiredOnly.body.items).toEqual([
      expect.objectContaining({ id: expiredInvitationId, status: 'EXPIRED' }),
    ]);

    const invalidCursor = await request(app.getHttpServer())
      .get('/api/v1/invitations?cursor=not%2Ba%2Bcursor')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(400);
    expect(invalidCursor.body.code).toBe('INVALID_QUERY');

    const invalidStatus = await request(app.getHttpServer())
      .get('/api/v1/invitations?status=PENDING%2CUNKNOWN')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .expect(400);
    expect(invalidStatus.body.code).toBe('INVALID_QUERY');

    const acceptedReissued = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${invitationId}/resend`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    expect(acceptedReissued.body).toMatchObject({
      acceptedAt: null,
      canceledAt: null,
      email: displayedInviteeEmail,
      id: expect.any(String),
      status: 'PENDING',
    });
    expect(acceptedReissued.body.id).not.toBe(invitationId);
    const acceptedReissuedId = acceptedReissued.body.id as string;
    const acceptedReissuedTokenRow = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: { invitationId: acceptedReissuedId, revokedAt: null, usedAt: null },
    });
    const acceptedReissuedToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      acceptedReissuedTokenRow.id,
    ).token;
    const acceptedReissuedContinuation = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: acceptedReissuedToken })
      .expect(200);
    const acceptedReissuedContinuationCookie = invitationContinuationCookie(
      acceptedReissuedContinuation.headers,
    );
    const acceptedAgain = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', `rivet_session=${inviteeSessionToken}; ${acceptedReissuedContinuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', inviteeCsrfToken)
      .expect(200);
    expect(acceptedAgain.body).toMatchObject({
      accepted: true,
      membership: { id: accepted.body.membership.id, role: 'MEMBER', status: 'ACTIVE' },
      workspace: { id: workspaceId },
    });
    await expect(
      database.client.workspaceInvitation.findUniqueOrThrow({
        select: { acceptedAt: true, acceptedByUserId: true },
        where: { id: acceptedReissuedId },
      }),
    ).resolves.toEqual({ acceptedAt: expect.any(Date), acceptedByUserId: expect.any(String) });
    await expect(
      database.client.oneTimeToken.findUniqueOrThrow({
        select: { usedAt: true },
        where: { id: acceptedReissuedTokenRow.id },
      }),
    ).resolves.toEqual({ usedAt: expect.any(Date) });
    const acceptedAgainRepeated = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation/accept')
      .set('Cookie', `rivet_session=${inviteeSessionToken}; ${acceptedReissuedContinuationCookie}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', inviteeCsrfToken)
      .expect(409);
    expect(acceptedAgainRepeated.body.code).toBe('TOKEN_ALREADY_USED');
    await expect(
      database.client.workspaceMembership.count({
        where: { user: { normalizedEmail: emails.invitee } },
      }),
    ).resolves.toBe(1);
    await expect(
      database.client.workspaceInvitation.count({
        where: { normalizedEmail: emails.invitee, workspaceId },
      }),
    ).resolves.toBe(2);

    const secondCanceledHistory = await request(app.getHttpServer())
      .post(`/api/v1/invitations/${canceledInvitationId}/resend`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/invitations/${String(secondCanceledHistory.body.id)}/cancel`)
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .expect(200);

    const canceledResends = await Promise.all(
      [canceledInvitationId, secondCanceledHistory.body.id as string].map((terminalInvitationId) =>
        request(app.getHttpServer())
          .post(`/api/v1/invitations/${terminalInvitationId}/resend`)
          .set('Cookie', `rivet_session=${adminSessionToken}`)
          .set('Origin', WEB_ORIGIN)
          .set('X-CSRF-Token', adminCsrfToken),
      ),
    );
    expect(canceledResends.map(({ status }) => status).sort()).toEqual([200, 409]);
    const canceledReissued = canceledResends.find(({ status }) => status === 200);
    const duplicateTerminalResend = canceledResends.find(({ status }) => status === 409);
    if (!canceledReissued || !duplicateTerminalResend) {
      throw new Error('종료 초대 동시 재발송 결과를 확인할 수 없습니다.');
    }
    expect(canceledReissued.body).toMatchObject({
      acceptedAt: null,
      canceledAt: null,
      id: expect.any(String),
      status: 'PENDING',
    });
    expect(canceledReissued.body.id).not.toBe(canceledInvitationId);
    await expect(
      database.client.workspaceInvitation.count({
        where: {
          canceledAt: { not: null },
          id: { in: [canceledInvitationId, secondCanceledHistory.body.id as string] },
        },
      }),
    ).resolves.toBe(2);
    await expect(
      database.client.outboxEvent.findFirst({
        select: { aggregateId: true },
        where: {
          aggregateId: canceledReissued.body.id as string,
          eventType: 'WORKSPACE_INVITATION_REQUESTED',
        },
      }),
    ).resolves.toEqual({ aggregateId: canceledReissued.body.id });

    expect(duplicateTerminalResend.body.code).toBe('INVITATION_ALREADY_PENDING');

    const unregisteredCreated = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [emails.unregistered] })
      .expect(200);
    const unregisteredInvitationId = unregisteredCreated.body.items[0].invitationId as string;
    const unregisteredTokenRow = await database.client.oneTimeToken.findFirstOrThrow({
      select: { id: true },
      where: {
        invitationId: unregisteredInvitationId,
        purpose: 'WORKSPACE_INVITATION',
        revokedAt: null,
        usedAt: null,
      },
    });
    const unregisteredToken = createOneTimeToken(
      'WORKSPACE_INVITATION',
      TOKEN_HMAC_KEY,
      unregisteredTokenRow.id,
    ).token;
    const unregisteredPreview = await request(app.getHttpServer())
      .post('/api/v1/auth/invitations/continuation')
      .set('Origin', WEB_ORIGIN)
      .send({ token: unregisteredToken })
      .expect(200);
    expect(unregisteredPreview.body).toMatchObject({
      emailMasked: 'm2***@example.com',
      nextAction: 'SIGN_UP',
      workspaceName: 'M2 초대 워크스페이스',
    });

    const invitationRateLimitKey = createHmac('sha256', RATE_LIMIT_HMAC_KEY)
      .update(`WORKSPACE_INVITATION_EMAIL:${workspaceId}`)
      .digest();
    const primedBuckets = await database.client.authRateLimitBucket.updateMany({
      data: { attemptCount: 100, blockedUntil: null },
      where: {
        keyHash: invitationRateLimitKey,
        scope: 'WORKSPACE_INVITATION_EMAIL',
      },
    });
    expect(primedBuckets.count).toBe(1);

    const limited = await request(app.getHttpServer())
      .post('/api/v1/invitations')
      .set('Cookie', `rivet_session=${adminSessionToken}`)
      .set('Origin', WEB_ORIGIN)
      .set('X-CSRF-Token', adminCsrfToken)
      .send({ emails: [emails.rateLimited] })
      .expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    await expect(
      database.client.workspaceInvitation.count({
        where: { normalizedEmail: emails.rateLimited, workspaceId },
      }),
    ).resolves.toBe(0);
  });
});

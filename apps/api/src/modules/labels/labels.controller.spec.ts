import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';

import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { LabelsController } from './labels.controller';
import { LabelsService } from './labels.service';

describe('LabelsController', () => {
  const membership = {
    id: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const workspace = {
    id: membership.workspaceId,
    name: '제품 개발팀',
    slug: 'product-team',
    version: 1,
  };
  const authentication: AuthenticatedRequestContext = {
    session: {
      membership,
      sessionId: '1f584d67-740d-470b-b354-e3c33a905dea',
      user: {
        avatarFileId: null,
        displayName: '김민수',
        email: 'minsu@example.com',
        emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
        id: '0f2a23cc-196f-4e6e-88a0-71e1272841e0',
      },
      workspace,
    },
    sessionToken: 'session-token',
  };
  const response = {
    archived: false,
    color: '#D84A4A',
    id: '953685f0-4921-41cd-8422-d8a1ccc3f547',
    name: '버그',
    version: 1,
  };
  const labels = {
    archive: jest.fn(),
    create: jest.fn(),
    list: jest.fn(),
    update: jest.fn(),
  };
  let moduleRef: TestingModule;
  let controller: LabelsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    labels.create.mockResolvedValue(response);
    moduleRef = await Test.createTestingModule({
      controllers: [LabelsController],
      providers: [{ provide: LabelsService, useValue: labels }],
    }).compile();
    controller = moduleRef.get(LabelsController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('creates a label in the authenticated workspace with status 201', async () => {
    const dto = { color: '#D84A4A', name: '버그' };

    await expect(controller.create(authentication, dto)).resolves.toEqual(response);
    expect(labels.create).toHaveBeenCalledWith(workspace.id, dto);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, LabelsController.prototype.create)).toBe(
      HttpStatus.CREATED,
    );
  });

  it.each(['create', 'update', 'archive'] as const)(
    'protects %s with the shared AdminGuard',
    (method) => {
      expect(Reflect.getMetadata(GUARDS_METADATA, LabelsController.prototype[method])).toContain(
        AdminGuard,
      );
    },
  );

  it('rejects a request without an active workspace context', () => {
    const unsafeAuthentication: AuthenticatedRequestContext = {
      ...authentication,
      session: { ...authentication.session, membership: null, workspace: null },
    };

    expect(() =>
      controller.list(unsafeAuthentication, {
        archivedOnly: false,
        includeArchived: false,
        limit: 50,
      }),
    ).toThrow(expect.objectContaining({ status: HttpStatus.FORBIDDEN }));
    expect(labels.list).not.toHaveBeenCalled();
  });
});

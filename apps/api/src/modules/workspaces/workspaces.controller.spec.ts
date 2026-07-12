import { HttpStatus } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';

import type { AuthenticatedRequestContext } from '../auth/authenticated-request';
import { WorkspacesController } from './workspaces.controller';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesController', () => {
  const authentication: AuthenticatedRequestContext = {
    session: {
      membership: null,
      sessionId: '1f584d67-740d-470b-b354-e3c33a905dea',
      user: {
        avatarFileId: null,
        displayName: '김민수',
        email: 'minsu@example.com',
        emailVerifiedAt: new Date('2026-07-11T00:00:00.000Z'),
        id: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
      },
      workspace: null,
    },
    sessionToken: 'session-token',
  };
  const response = {
    id: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
    name: '제품 개발팀',
    slug: 'product-team',
    version: 1,
  };
  const workspaces = { create: jest.fn(), getCurrent: jest.fn() };
  let moduleRef: TestingModule;
  let controller: WorkspacesController;

  beforeEach(async () => {
    jest.clearAllMocks();
    workspaces.create.mockResolvedValue(response);
    workspaces.getCurrent.mockResolvedValue(response);
    moduleRef = await Test.createTestingModule({
      controllers: [WorkspacesController],
      providers: [{ provide: WorkspacesService, useValue: workspaces }],
    }).compile();
    controller = moduleRef.get(WorkspacesController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('creates the first workspace for the authenticated user with status 201', async () => {
    const dto = { name: '제품 개발팀', slug: 'product-team' };

    await expect(controller.create(authentication, dto)).resolves.toEqual(response);
    expect(workspaces.create).toHaveBeenCalledWith(authentication.session.user.id, dto);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, WorkspacesController.prototype.create)).toBe(
      HttpStatus.CREATED,
    );
  });

  it('returns the workspace scoped by the active session membership', async () => {
    const activeAuthentication: AuthenticatedRequestContext = {
      ...authentication,
      session: {
        ...authentication.session,
        membership: {
          id: 'a33e222e-9bda-48e2-a34e-0b24df4cbfba',
          role: 'ADMIN',
          status: 'ACTIVE',
          workspaceId: response.id,
        },
        workspace: response,
      },
    };

    await expect(controller.getCurrent(activeAuthentication)).resolves.toEqual(response);
    expect(workspaces.getCurrent).toHaveBeenCalledWith(response.id);
  });

  it('passes a missing workspace scope to the service for a consistent not-found response', async () => {
    await controller.getCurrent(authentication);

    expect(workspaces.getCurrent).toHaveBeenCalledWith(null);
  });
});

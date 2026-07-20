import { HttpStatus } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';

import { AdminGuard } from '../../common/guards/admin.guard';
import type { AuthenticatedRequestContext } from '../auth/authentication.context';
import { TeamQueryService } from './team-query.service';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { WorkflowStatesService } from './workflow-states.service';

describe('TeamsController', () => {
  const membership = {
    id: '2e0792d5-eac3-44c1-87c7-56f07ebaa620',
    role: 'ADMIN' as const,
    status: 'ACTIVE' as const,
    workspaceId: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
  };
  const workspace = {
    id: '3dc0b213-eafa-450c-ad12-49a7d927c7b8',
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
    id: '953685f0-4921-41cd-8422-d8a1ccc3f547',
    key: 'WEB',
    memberIds: [membership.id],
    name: '프론트 웹',
    version: 1,
    workflowStates: [],
  };
  const teamQueries = {};
  const teams = { create: jest.fn() };
  const workflowStates = {
    createWorkflowState: jest.fn(),
    setDefaultWorkflowState: jest.fn(),
  };
  let moduleRef: TestingModule;
  let controller: TeamsController;

  beforeEach(async () => {
    jest.clearAllMocks();
    teams.create.mockResolvedValue(response);
    moduleRef = await Test.createTestingModule({
      controllers: [TeamsController],
      providers: [
        { provide: TeamQueryService, useValue: teamQueries },
        { provide: TeamsService, useValue: teams },
        { provide: WorkflowStatesService, useValue: workflowStates },
      ],
    }).compile();
    controller = moduleRef.get(TeamsController);
  });

  afterEach(async () => {
    await moduleRef.close();
  });

  it('creates a team in the authenticated admin workspace with status 201', async () => {
    const dto = {
      key: 'WEB',
      memberIds: [membership.id],
      name: '프론트 웹',
    };

    await expect(controller.create(authentication, dto)).resolves.toEqual(response);
    expect(teams.create).toHaveBeenCalledWith(
      {
        membershipId: membership.id,
        workspaceId: workspace.id,
      },
      dto,
    );
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, TeamsController.prototype.create)).toBe(
      HttpStatus.CREATED,
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, TeamsController.prototype.create)).toContain(
      AdminGuard,
    );
  });

  it('creates a workflow state and allows any category to become the default', async () => {
    const state = {
      category: 'COMPLETED' as const,
      id: '05ed9724-f207-447d-9f18-7026f493d3fd',
      isDefault: false,
      name: '검증 완료',
      position: 7,
      version: 1,
    };
    workflowStates.createWorkflowState.mockResolvedValue(state);
    workflowStates.setDefaultWorkflowState.mockResolvedValue({
      items: [{ ...state, isDefault: true, version: 2 }],
      nextCursor: null,
    });

    await expect(
      controller.createWorkflowState(authentication, response.id, {
        category: 'COMPLETED' as never,
        name: '검증 완료',
      }),
    ).resolves.toEqual(state);
    await expect(
      controller.setDefaultWorkflowState(authentication, state.id, { version: 1 }),
    ).resolves.toMatchObject({ items: [expect.objectContaining({ isDefault: true })] });
    expect(workflowStates.createWorkflowState).toHaveBeenCalledWith(workspace.id, response.id, {
      category: 'COMPLETED',
      name: '검증 완료',
    });
    expect(workflowStates.setDefaultWorkflowState).toHaveBeenCalledWith(workspace.id, state.id, {
      version: 1,
    });
    expect(
      Reflect.getMetadata(HTTP_CODE_METADATA, TeamsController.prototype.createWorkflowState),
    ).toBe(HttpStatus.CREATED);
    expect(
      Reflect.getMetadata(GUARDS_METADATA, TeamsController.prototype.setDefaultWorkflowState),
    ).toContain(AdminGuard);
  });

  const unsafeSessionPatches: Array<[string, Partial<AuthenticatedRequestContext['session']>]> = [
    ['membership missing', { membership: null }],
    ['workspace missing', { workspace: null }],
    ['membership is inactive', { membership: { ...membership, status: 'INACTIVE' } }],
    [
      'workspace does not match membership',
      {
        workspace: {
          ...workspace,
          id: 'dd151af4-f97e-4cf2-ab03-43be72bb2782',
        },
      },
    ],
  ];

  it.each(unsafeSessionPatches)(
    'rejects unsafe workspace context when %s',
    (_condition, sessionPatch) => {
      const unsafeAuthentication: AuthenticatedRequestContext = {
        ...authentication,
        session: { ...authentication.session, ...sessionPatch },
      };

      expect(() =>
        controller.create(unsafeAuthentication, {
          key: 'WEB',
          memberIds: [membership.id],
          name: '프론트 웹',
        }),
      ).toThrow(
        expect.objectContaining({ response: expect.objectContaining({ code: 'FORBIDDEN' }) }),
      );
      expect(teams.create).not.toHaveBeenCalled();
    },
  );
});

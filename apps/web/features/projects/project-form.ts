import { z } from 'zod';

import type { CreateProjectDto, ProjectResponseDto, UpdateProjectDto } from '@rivet/api-client';

export const PROJECT_ROLES = ['BACKEND', 'WEB_FRONTEND', 'APP_FRONTEND'] as const;
export const PROJECT_FORM_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'] as const;

export function projectFormSchema(labels: {
  dateOrder: string;
  nameRequired: string;
  nameTooLong: string;
  descriptionTooLong: string;
  roleRequired: string;
}) {
  return z
    .object({
      APP_FRONTEND: z.string(),
      BACKEND: z.string(),
      WEB_FRONTEND: z.string(),
      description: z.string().trim().max(5000, labels.descriptionTooLong),
      leadMembershipId: z.string(),
      name: z.string().trim().min(1, labels.nameRequired).max(200, labels.nameTooLong),
      startDate: z.string(),
      status: z.enum(PROJECT_FORM_STATUSES),
      targetDate: z.string(),
    })
    .superRefine((values, context) => {
      if (!PROJECT_ROLES.some((role) => values[role])) {
        context.addIssue({ code: 'custom', message: labels.roleRequired, path: ['BACKEND'] });
      }

      if (values.startDate && values.targetDate && values.startDate > values.targetDate) {
        context.addIssue({ code: 'custom', message: labels.dateOrder, path: ['startDate'] });
        context.addIssue({ code: 'custom', message: labels.dateOrder, path: ['targetDate'] });
      }
    });
}

export type ProjectFormValues = z.infer<ReturnType<typeof projectFormSchema>>;

export function projectFormDefaults(project?: ProjectResponseDto): ProjectFormValues {
  const roleTeams = new Map(project?.roleTeams.map(({ role, team }) => [role, team.id]));

  return {
    APP_FRONTEND: roleTeams.get('APP_FRONTEND') ?? '',
    BACKEND: roleTeams.get('BACKEND') ?? '',
    WEB_FRONTEND: roleTeams.get('WEB_FRONTEND') ?? '',
    description: project?.description ?? '',
    leadMembershipId: project?.lead?.id ?? '',
    name: project?.name ?? '',
    startDate: project?.startDate ?? '',
    status: project?.status ?? 'PLANNED',
    targetDate: project?.targetDate ?? '',
  };
}

export function createProjectPayload(values: ProjectFormValues): CreateProjectDto {
  return {
    description: values.description || null,
    leadMembershipId: values.leadMembershipId || null,
    name: values.name,
    roleTeams: PROJECT_ROLES.flatMap((role) =>
      values[role] ? [{ role, teamId: values[role] }] : [],
    ),
    startDate: values.startDate || null,
    status: values.status,
    targetDate: values.targetDate || null,
  };
}

export function updateProjectPayload(values: ProjectFormValues, version: number): UpdateProjectDto {
  return { ...createProjectPayload(values), status: values.status, version };
}

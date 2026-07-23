import { z } from 'zod';

import type { CreateProjectDto, ProjectResponseDto, UpdateProjectDto } from '@rivet/api-client';

export const PROJECT_FORM_STATUSES = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED'] as const;

export function projectFormSchema(labels: {
  dateOrder: string;
  nameRequired: string;
  nameTooLong: string;
  descriptionTooLong: string;
}) {
  return z
    .object({
      description: z.string().trim().max(5000, labels.descriptionTooLong),
      deploymentTrackingTeamIds: z.array(z.string().uuid()).max(100),
      leadMembershipId: z.string(),
      logoFileId: z.union([z.string().uuid(), z.literal('')]),
      name: z.string().trim().min(1, labels.nameRequired).max(200, labels.nameTooLong),
      startDate: z.string(),
      status: z.enum(PROJECT_FORM_STATUSES),
      targetDate: z.string(),
      teamIds: z.array(z.string().uuid()).max(100),
    })
    .superRefine((values, context) => {
      if (values.startDate && values.targetDate && values.startDate > values.targetDate) {
        context.addIssue({ code: 'custom', message: labels.dateOrder, path: ['startDate'] });
        context.addIssue({ code: 'custom', message: labels.dateOrder, path: ['targetDate'] });
      }
    });
}

export type ProjectFormValues = z.infer<ReturnType<typeof projectFormSchema>>;

export function projectFormDefaults(project?: ProjectResponseDto): ProjectFormValues {
  return {
    description: project?.description ?? '',
    deploymentTrackingTeamIds:
      project?.projectTeams
        .filter(({ active, deploymentTrackingEnabled }) => active && deploymentTrackingEnabled)
        .map(({ team }) => team.id) ?? [],
    leadMembershipId: project?.lead?.id ?? '',
    logoFileId: project?.logoFileId ?? '',
    name: project?.name ?? '',
    startDate: project?.startDate ?? '',
    status: project?.status ?? 'PLANNED',
    targetDate: project?.targetDate ?? '',
    teamIds: project?.projectTeams.filter(({ active }) => active).map(({ team }) => team.id) ?? [],
  };
}

export function createProjectPayload(values: ProjectFormValues): CreateProjectDto {
  return {
    description: values.description || null,
    deploymentTrackingTeamIds: values.deploymentTrackingTeamIds,
    leadMembershipId: values.leadMembershipId || null,
    logoFileId: values.logoFileId || null,
    name: values.name,
    startDate: values.startDate || null,
    status: values.status,
    targetDate: values.targetDate || null,
    teamIds: values.teamIds,
  };
}

export function updateProjectPayload(values: ProjectFormValues, version: number): UpdateProjectDto {
  return { ...createProjectPayload(values), status: values.status, version };
}

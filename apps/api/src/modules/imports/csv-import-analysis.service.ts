import { Injectable } from '@nestjs/common';

import {
  IssuePriority,
  Prisma,
  type PrismaClient,
  ProjectRole,
  StateCategory,
} from '@rivet/database';

import { parseOptionalMarkdown } from '../../common/validation/markdown';
import { isFormulaCell, type ParsedCsvImport, splitLabelValues } from './csv-import.parser';
import {
  type CsvImportMapping,
  csvImportMappingEntryMap,
  csvImportMappingKey,
  csvImportPreview,
  hashCsvImportSource,
  normalizeCsvImportValue,
} from './csv-import-mapping.policy';
import type { CsvImportTargetSnapshot } from './csv-import-target.repository';
import type { CsvImportPreviewErrorDto } from './dto/csv-import-response.dto';

type DatabaseClient = Prisma.TransactionClient | PrismaClient;

export type CsvImportPreparedRow = {
  assigneeMembershipId: string | null;
  descriptionMarkdown: string | null;
  labelSources: string[];
  priority: IssuePriority;
  projectRole: ProjectRole;
  projectSource: string;
  sourceKeyHash: string;
  sourceReference: string;
  stateCategory: StateCategory;
  teamId: string;
  title: string;
  workflowStateId: string;
};

export type CsvImportAnalysis = {
  errors: CsvImportPreviewErrorDto[];
  excludedRowCount: number;
  preparedRows: CsvImportPreparedRow[];
  projectTeams: Map<string, string>;
  summary: {
    connectionCreateCount: number;
    errorCount: number;
    excludedRowCount: number;
    issueCreateCount: number;
    projectCreateCount: number;
    warningCount: number;
  };
  warnings: CsvImportPreviewErrorDto[];
};

@Injectable()
export class CsvImportAnalysisService {
  async analyze(
    client: DatabaseClient,
    workspaceId: string,
    parsed: ParsedCsvImport,
    mapping: CsvImportMapping,
    targets: CsvImportTargetSnapshot,
  ): Promise<CsvImportAnalysis> {
    const errors: CsvImportPreviewErrorDto[] = parsed.structureErrors.map((error) => ({
      ...error,
      severity: 'ERROR',
    }));
    const warnings: CsvImportPreviewErrorDto[] = [];
    const teamMappings = csvImportMappingEntryMap(mapping.teams);
    const stateMappings = csvImportMappingEntryMap(mapping.states);
    const memberMappings = csvImportMappingEntryMap(mapping.members);
    const projectMappings = csvImportMappingEntryMap(mapping.projects);
    const priorityMappings = csvImportMappingEntryMap(mapping.priorities);
    const labelMappings = csvImportMappingEntryMap(mapping.labels);
    const teams = new Map(targets.teams.map((team) => [team.id, team]));
    const states = new Map(targets.states.map((state) => [state.id, state]));
    const members = new Map(targets.members.map((member) => [member.id, member]));
    const projects = new Map(targets.projects.map((project) => [project.id, project]));
    const labels = new Map(targets.labels.map((label) => [label.id, label]));
    const activeLabelNames = new Set(targets.labels.map((label) => label.normalizedName));
    const createdLabelNames = new Map<string, string>();
    const seenKeys = new Map<string, number>();
    const keyHashes = parsed.rows
      .map((row) => normalizeCsvImportValue(row[mapping.columns.sourceKey] ?? ''))
      .filter(Boolean)
      .map(hashCsvImportSource);
    const existingKeys = new Set(
      (
        await client.importSourceRow.findMany({
          select: { sourceKeyHash: true },
          where: { sourceKeyHash: { in: [...new Set(keyHashes)] }, workspaceId },
        })
      ).map(({ sourceKeyHash }) => sourceKeyHash),
    );
    const preparedRows: CsvImportPreparedRow[] = [];
    const projectTeams = new Map<string, string>();
    let excludedRowCount = 0;

    for (const [index, row] of parsed.rows.entries()) {
      const rowNumber = index + 2;
      let invalid = parsed.structureErrors.some((error) => error.rowNumber === rowNumber);
      const addError = (code: string, field?: string): void => {
        errors.push(csvImportPreview(code, rowNumber, field, 'ERROR'));
        invalid = true;
      };
      for (const [column, value] of Object.entries(row)) {
        if (value.length > 0 && isFormulaCell(value)) addError('IMPORT_FORMULA_VALUE', column);
      }

      const sourceReference = normalizeCsvImportValue(row[mapping.columns.sourceKey] ?? '');
      const title = normalizeCsvImportValue(row[mapping.columns.title] ?? '');
      const teamSource = normalizeCsvImportValue(row[mapping.columns.team] ?? '');
      const stateSource = normalizeCsvImportValue(row[mapping.columns.status] ?? '');
      const projectSource = normalizeCsvImportValue(row[mapping.columns.project] ?? '');
      const descriptionSource = mapping.columns.description
        ? normalizeCsvImportValue(row[mapping.columns.description] ?? '')
        : '';
      const memberSource = mapping.columns.assignee
        ? normalizeCsvImportValue(row[mapping.columns.assignee] ?? '')
        : '';
      const prioritySource = mapping.columns.priority
        ? normalizeCsvImportValue(row[mapping.columns.priority] ?? '')
        : '';
      const labelSources = mapping.columns.labels
        ? splitLabelValues(row[mapping.columns.labels] ?? '')
        : [];

      if (sourceReference.length < 1 || [...sourceReference].length > 255) {
        addError('IMPORT_SOURCE_KEY_INVALID', 'sourceKey');
      }
      if (title.length < 1 || [...title].length > 500) addError('IMPORT_TITLE_INVALID', 'title');
      if (!teamSource) addError('IMPORT_TEAM_REQUIRED', 'team');
      if (!stateSource) addError('IMPORT_STATE_REQUIRED', 'status');
      if (!projectSource) addError('IMPORT_PROJECT_REQUIRED', 'project');
      if ([...descriptionSource].length > 100_000) {
        addError('IMPORT_DESCRIPTION_TOO_LONG', 'description');
      }

      let descriptionMarkdown: string | null = null;
      if (descriptionSource && !invalid) {
        try {
          const parsedMarkdown = parseOptionalMarkdown(descriptionSource, 100_000);
          if (parsedMarkdown.fileIds.length || parsedMarkdown.mentionedMembershipIds.length) {
            addError('IMPORT_DESCRIPTION_REFERENCE_UNSUPPORTED', 'description');
          }
          descriptionMarkdown = parsedMarkdown.bodyMarkdown;
        } catch {
          addError('IMPORT_DESCRIPTION_INVALID', 'description');
        }
      }

      const sourceKeyHash = sourceReference ? hashCsvImportSource(sourceReference) : '';
      if (sourceKeyHash) {
        const previous = seenKeys.get(sourceKeyHash);
        if (previous !== undefined) {
          addError('IMPORT_SOURCE_KEY_DUPLICATE', 'sourceKey');
          errors.push(
            csvImportPreview('IMPORT_SOURCE_KEY_DUPLICATE', previous, 'sourceKey', 'ERROR'),
          );
        } else {
          seenKeys.set(sourceKeyHash, rowNumber);
        }
      }

      const teamMapping = teamMappings.get(csvImportMappingKey(teamSource));
      const stateMapping = stateMappings.get(csvImportMappingKey(stateSource, teamSource));
      const projectMapping = projectMappings.get(csvImportMappingKey(projectSource));
      if (!teamMapping) addError('IMPORT_TEAM_MAPPING_REQUIRED', 'team');
      if (!stateMapping) addError('IMPORT_STATE_MAPPING_REQUIRED', 'status');
      if (!projectMapping) addError('IMPORT_PROJECT_MAPPING_REQUIRED', 'project');
      if (
        teamMapping?.mode === 'EXCLUDE' ||
        stateMapping?.mode === 'EXCLUDE' ||
        projectMapping?.mode === 'EXCLUDE'
      ) {
        excludedRowCount += 1;
        continue;
      }

      const teamId = teamMapping?.targetId;
      const workflowStateId = stateMapping?.targetId;
      const team = teamId ? teams.get(teamId) : undefined;
      const state = workflowStateId ? states.get(workflowStateId) : undefined;
      if (!team) addError('IMPORT_TEAM_TARGET_INVALID', 'team');
      if (!state || state.teamId !== teamId) addError('IMPORT_STATE_TARGET_INVALID', 'status');

      let assigneeMembershipId: string | null = null;
      if (memberSource) {
        const memberMapping = memberMappings.get(csvImportMappingKey(memberSource, teamSource));
        if (!memberMapping) addError('IMPORT_MEMBER_MAPPING_REQUIRED', 'assignee');
        if (memberMapping?.mode === 'MAP') {
          const member = memberMapping.targetId ? members.get(memberMapping.targetId) : undefined;
          if (!member || !teamId || !member.teamIds.includes(teamId)) {
            addError('IMPORT_MEMBER_TARGET_INVALID', 'assignee');
          } else {
            assigneeMembershipId = member.id;
          }
        }
      }

      let priority: IssuePriority = IssuePriority.NONE;
      if (prioritySource) {
        const priorityMapping = priorityMappings.get(csvImportMappingKey(prioritySource));
        if (!priorityMapping?.targetValue) addError('IMPORT_PRIORITY_MAPPING_REQUIRED', 'priority');
        else priority = priorityMapping.targetValue;
      }

      for (const labelSource of labelSources) {
        const labelMapping = labelMappings.get(csvImportMappingKey(labelSource));
        if (!labelMapping) {
          addError('IMPORT_LABEL_MAPPING_REQUIRED', 'labels');
        } else if (
          labelMapping.mode === 'MAP' &&
          (!labelMapping.targetId || !labels.has(labelMapping.targetId))
        ) {
          addError('IMPORT_LABEL_TARGET_INVALID', 'labels');
        } else if (labelMapping.mode === 'CREATE' && [...labelSource].length > 50) {
          addError('IMPORT_LABEL_NAME_INVALID', 'labels');
        } else if (labelMapping.mode === 'CREATE') {
          const normalizedName = labelSource.toLowerCase();
          const previousSource = createdLabelNames.get(normalizedName);
          if (activeLabelNames.has(normalizedName)) {
            addError('IMPORT_LABEL_ALREADY_EXISTS', 'labels');
          } else if (previousSource && previousSource !== labelSource) {
            addError('IMPORT_LABEL_NAME_DUPLICATE', 'labels');
          } else {
            createdLabelNames.set(normalizedName, labelSource);
          }
        }
      }

      let projectRole: ProjectRole = ProjectRole.BACKEND;
      if (projectMapping?.mode === 'MAP') {
        const project = projectMapping.targetId ? projects.get(projectMapping.targetId) : undefined;
        if (!project) addError('IMPORT_PROJECT_TARGET_INVALID', 'project');
        else {
          const roles = project.roleTeams
            .filter((roleTeam) => roleTeam.teamId === teamId)
            .map(({ role }) => role)
            .sort((left, right) =>
              left === ProjectRole.BACKEND
                ? -1
                : right === ProjectRole.BACKEND
                  ? 1
                  : left.localeCompare(right),
            );
          if (!roles[0]) addError('IMPORT_PROJECT_TEAM_NOT_CONNECTED', 'project');
          else projectRole = roles[0];
        }
      } else if (projectMapping?.mode === 'CREATE' && teamId) {
        const previousTeamId = projectTeams.get(projectSource);
        if (previousTeamId && previousTeamId !== teamId) {
          addError('IMPORT_PROJECT_TEAM_AMBIGUOUS', 'project');
        } else {
          projectTeams.set(projectSource, teamId);
        }
        if ([...projectSource].length > 200) addError('IMPORT_PROJECT_NAME_INVALID', 'project');
      }

      if (sourceKeyHash && existingKeys.has(sourceKeyHash)) {
        excludedRowCount += 1;
        warnings.push(
          csvImportPreview('IMPORT_SOURCE_ALREADY_IMPORTED', rowNumber, 'sourceKey', 'WARNING'),
        );
        continue;
      }
      if (!invalid && teamId && workflowStateId && state) {
        preparedRows.push({
          assigneeMembershipId,
          descriptionMarkdown,
          labelSources,
          priority,
          projectRole,
          projectSource,
          sourceKeyHash,
          sourceReference,
          stateCategory: state.category,
          teamId,
          title,
          workflowStateId,
        });
      }
    }

    const createProjects = new Set(
      mapping.projects
        .filter(({ mode, source }) => mode === 'CREATE' && projectTeams.has(source))
        .map(({ source }) => source),
    );
    const connectionCreateCount = preparedRows.reduce(
      (count, row) =>
        count +
        1 +
        row.labelSources.filter(
          (source) => labelMappings.get(csvImportMappingKey(source))?.mode !== 'IGNORE',
        ).length,
      createProjects.size,
    );
    return {
      errors,
      excludedRowCount,
      preparedRows,
      projectTeams,
      summary: {
        connectionCreateCount,
        errorCount: errors.length,
        excludedRowCount,
        issueCreateCount: preparedRows.length,
        projectCreateCount: createProjects.size,
        warningCount: warnings.length,
      },
      warnings,
    };
  }
}

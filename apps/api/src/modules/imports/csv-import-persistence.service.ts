import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { ImportRunStatus, Prisma, ProjectStatus } from '@rivet/database';

import type { CsvImportContext } from './csv-import.context';
import type { CsvImportAnalysis } from './csv-import-analysis.service';
import { csvImportIssueStatus, type CsvImportMapping } from './csv-import-mapping.policy';

const CSV_IMPORT_BATCH_SIZE = 500;

@Injectable()
export class CsvImportPersistenceService {
  async persist(
    transaction: Prisma.TransactionClient,
    context: CsvImportContext,
    executionId: string,
    mapping: CsvImportMapping,
    analysis: CsvImportAnalysis,
  ): Promise<void> {
    const run = await transaction.importRun.findUniqueOrThrow({
      select: { id: true },
      where: { workspaceId_executionId: { executionId, workspaceId: context.workspaceId } },
    });
    const writeBatches = async <Row>(
      rows: Row[],
      write: (batch: Row[]) => Promise<unknown>,
    ): Promise<void> => {
      for (let offset = 0; offset < rows.length; offset += CSV_IMPORT_BATCH_SIZE) {
        await write(rows.slice(offset, offset + CSV_IMPORT_BATCH_SIZE));
      }
    };

    const labelIds = new Map<string, string>();
    const usedLabelSources = new Set(analysis.preparedRows.flatMap((row) => row.labelSources));
    const labelsToCreate: Prisma.LabelCreateManyInput[] = [];
    for (const entry of mapping.labels) {
      if (entry.mode === 'MAP' && entry.targetId) labelIds.set(entry.source, entry.targetId);
      if (entry.mode === 'CREATE' && usedLabelSources.has(entry.source)) {
        const id = randomUUID();
        labelsToCreate.push({
          color: '#5E6AD2',
          id,
          name: entry.source,
          normalizedName: entry.source.toLocaleLowerCase('ko-KR'),
          workspaceId: context.workspaceId,
        });
        labelIds.set(entry.source, id);
      }
    }
    await writeBatches(labelsToCreate, (data) => transaction.label.createMany({ data }));

    const projectIds = new Map<string, string>();
    const projectTeamIds = new Map<string, string>();
    const createdProjectSources = new Set<string>();
    const projectsToCreate: Prisma.ProjectCreateManyInput[] = [];
    const projectTeamsToCreate: Prisma.ProjectTeamCreateManyInput[] = [];
    const activityEventsToCreate: Prisma.ActivityEventCreateManyInput[] = [];
    for (const entry of mapping.projects) {
      if (entry.mode === 'MAP' && entry.targetId) projectIds.set(entry.source, entry.targetId);
      const teamIds = analysis.projectTeams.get(entry.source);
      if (entry.mode === 'CREATE' && teamIds && teamIds.size > 0) {
        const projectId = randomUUID();
        projectsToCreate.push({
          id: projectId,
          name: entry.source,
          status: ProjectStatus.PLANNED,
          workspaceId: context.workspaceId,
        });
        for (const teamId of [...teamIds].sort()) {
          const projectTeamId = randomUUID();
          projectTeamsToCreate.push({
            id: projectTeamId,
            projectId,
            teamId,
            workspaceId: context.workspaceId,
          });
          projectTeamIds.set(`${entry.source}:${teamId}`, projectTeamId);
        }
        activityEventsToCreate.push({
          actorMembershipId: context.membershipId,
          afterData: { importRunId: run.id },
          eventType: 'PROJECT_IMPORTED',
          projectId,
          workspaceId: context.workspaceId,
        });
        projectIds.set(entry.source, projectId);
        createdProjectSources.add(entry.source);
      }
    }
    await writeBatches(projectsToCreate, (data) => transaction.project.createMany({ data }));
    await writeBatches(projectTeamsToCreate, (data) =>
      transaction.projectTeam.createMany({ data }),
    );

    const workspace = await transaction.workspace.findUniqueOrThrow({
      select: { nextIssueNumber: true },
      where: { id: context.workspaceId },
    });
    const teamCounts = new Map<string, number>();
    for (const row of analysis.preparedRows) {
      teamCounts.set(row.teamId, (teamCounts.get(row.teamId) ?? 0) + 1);
    }
    const teams =
      teamCounts.size === 0
        ? []
        : await transaction.$queryRaw<Array<{ id: string; key: string; nextIssueNumber: number }>>(
            Prisma.sql`
              SELECT "id", "key", "next_issue_number" AS "nextIssueNumber"
              FROM "teams"
              WHERE "workspace_id" = ${context.workspaceId}::uuid
                AND "id" IN (${Prisma.join(
                  [...teamCounts.keys()].map((id) => Prisma.sql`${id}::uuid`),
                )})
              ORDER BY "id"
              FOR UPDATE
            `,
          );
    const teamSequences = new Map(teams.map((team) => [team.id, team]));
    await transaction.workspace.update({
      data: { nextIssueNumber: { increment: analysis.preparedRows.length } },
      where: { id: context.workspaceId },
    });
    const teamCounterUpdates = [...teamCounts].map(([teamId, count]) => ({ count, teamId }));
    for (let offset = 0; offset < teamCounterUpdates.length; offset += CSV_IMPORT_BATCH_SIZE) {
      const batch = teamCounterUpdates.slice(offset, offset + CSV_IMPORT_BATCH_SIZE);
      await transaction.$executeRaw(
        Prisma.sql`
          UPDATE "teams" AS team
          SET "next_issue_number" = team."next_issue_number" + increments."count",
              "updated_at" = NOW()
          FROM (VALUES ${Prisma.join(
            batch.map(({ count, teamId }) => Prisma.sql`(${teamId}::uuid, ${count}::integer)`),
          )}) AS increments("id", "count")
          WHERE team."workspace_id" = ${context.workspaceId}::uuid
            AND team."id" = increments."id"
        `,
      );
    }

    const nextTeamOffset = new Map<string, number>();
    const ignoredLabelSources = new Set(
      mapping.labels.filter(({ mode }) => mode === 'IGNORE').map(({ source }) => source),
    );
    const issuesToCreate: Prisma.IssueCreateManyInput[] = [];
    const teamWorksToCreate: Prisma.TeamWorkCreateManyInput[] = [];
    const issueLabelsToCreate: Prisma.IssueLabelCreateManyInput[] = [];
    const sourceRowsToCreate: Prisma.ImportSourceRowCreateManyInput[] = [];
    for (const [index, row] of analysis.preparedRows.entries()) {
      const projectId = projectIds.get(row.projectSource);
      const team = teamSequences.get(row.teamId);
      if (!projectId || !team) throw new Error('IMPORT_RESOLVED_TARGET_MISSING');
      const projectTeamId =
        row.projectTeamId ?? projectTeamIds.get(`${row.projectSource}:${row.teamId}`);
      if (!projectTeamId) throw new Error('IMPORT_PROJECT_TEAM_TARGET_MISSING');
      const issueNumber = workspace.nextIssueNumber + index;
      const teamOffset = nextTeamOffset.get(row.teamId) ?? 0;
      nextTeamOffset.set(row.teamId, teamOffset + 1);
      const teamWorkNumber = team.nextIssueNumber + teamOffset;
      const issueId = randomUUID();
      const teamWorkId = randomUUID();
      issuesToCreate.push({
        createdByMembershipId: context.membershipId,
        descriptionMarkdown: row.descriptionMarkdown,
        id: issueId,
        identifier: `F-${issueNumber}`,
        priority: row.priority,
        projectId,
        sequenceNumber: issueNumber,
        status: csvImportIssueStatus(row.stateCategory),
        title: row.title,
        workspaceId: context.workspaceId,
      });
      teamWorksToCreate.push({
        assigneeMembershipId: row.assigneeMembershipId,
        createdByMembershipId: context.membershipId,
        id: teamWorkId,
        identifier: `${team.key}-${teamWorkNumber}`,
        issueId,
        projectTeamId,
        sequenceNumber: teamWorkNumber,
        teamId: row.teamId,
        workflowStateId: row.workflowStateId,
        workspaceId: context.workspaceId,
      });
      const resolvedLabelIds = row.labelSources.flatMap((source) => {
        if (ignoredLabelSources.has(source)) return [];
        const labelId = labelIds.get(source);
        return labelId ? [labelId] : [];
      });
      issueLabelsToCreate.push(
        ...resolvedLabelIds.map((labelId) => ({
          issueId,
          labelId,
          workspaceId: context.workspaceId,
        })),
      );
      sourceRowsToCreate.push({
        importRunId: run.id,
        issueId,
        projectId,
        projectCreated: createdProjectSources.has(row.projectSource),
        sourceKeyHash: row.sourceKeyHash,
        sourceReference: row.sourceReference,
        workspaceId: context.workspaceId,
      });
      activityEventsToCreate.push({
        actorMembershipId: context.membershipId,
        afterData: { importRunId: run.id, sourceReference: row.sourceReference },
        eventType: 'ISSUE_IMPORTED',
        issueId,
        teamWorkId,
        workspaceId: context.workspaceId,
      });
    }

    await writeBatches(issuesToCreate, (data) => transaction.issue.createMany({ data }));
    await writeBatches(teamWorksToCreate, (data) => transaction.teamWork.createMany({ data }));
    await writeBatches(issueLabelsToCreate, (data) => transaction.issueLabel.createMany({ data }));
    await writeBatches(sourceRowsToCreate, (data) =>
      transaction.importSourceRow.createMany({ data }),
    );
    await writeBatches(activityEventsToCreate, (data) =>
      transaction.activityEvent.createMany({ data }),
    );

    await transaction.importRun.update({
      data: {
        completedAt: new Date(),
        connectionCreatedCount: analysis.summary.connectionCreateCount,
        errorCount: 0,
        errorDetails: Prisma.JsonNull,
        excludedRowCount: analysis.summary.excludedRowCount,
        failedAt: null,
        issueCreatedCount: analysis.summary.issueCreateCount,
        lastErrorCode: null,
        projectCreatedCount: analysis.summary.projectCreateCount,
        status: ImportRunStatus.SUCCEEDED,
      },
      where: { id: run.id },
    });
  }
}

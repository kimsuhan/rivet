import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  MembershipStatus,
  Prisma,
  type PrismaClient,
  StateCategory,
} from '@rivet/database';

type DatabaseClient = Prisma.TransactionClient | PrismaClient;

export type CsvImportTargetSnapshot = {
  fingerprint: string;
  labels: Array<{
    color: string;
    id: string;
    name: string;
    normalizedName: string;
    version: number;
  }>;
  members: Array<{
    displayName: string;
    email: string;
    id: string;
    role: 'ADMIN' | 'MEMBER';
    teamIds: string[];
  }>;
  projects: Array<{
    id: string;
    name: string;
    projectTeams: Array<{ active: boolean; id: string; teamId: string }>;
    version: number;
  }>;
  states: Array<{
    category: StateCategory;
    id: string;
    name: string;
    teamId: string;
    version: number;
  }>;
  teams: Array<{ id: string; key: string; name: string; version: number }>;
};

@Injectable()
export class CsvImportTargetRepository {
  async load(client: DatabaseClient, workspaceId: string): Promise<CsvImportTargetSnapshot> {
    const [teams, memberships, projects, labels] = await Promise.all([
      client.team.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          key: true,
          name: true,
          version: true,
          workflowStates: {
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { category: true, id: true, name: true, version: true },
          },
        },
        where: { archivedAt: null, workspaceId },
      }),
      client.workspaceMembership.findMany({
        orderBy: [{ user: { displayName: 'asc' } }, { id: 'asc' }],
        select: {
          id: true,
          role: true,
          teamMemberships: {
            select: { teamId: true },
            where: { removedAt: null, team: { archivedAt: null } },
          },
          user: { select: { displayName: true, email: true } },
        },
        where: { status: MembershipStatus.ACTIVE, workspaceId },
      }),
      client.project.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          projectTeams: {
            orderBy: [{ team: { name: 'asc' } }, { id: 'asc' }],
            select: { id: true, isActive: true, teamId: true },
          },
          version: true,
        },
        where: { archivedAt: null, deletedAt: null, workspaceId },
      }),
      client.label.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { color: true, id: true, name: true, normalizedName: true, version: true },
        where: { archivedAt: null, workspaceId },
      }),
    ]);
    const snapshot = {
      labels,
      members: memberships.map(({ id, role, teamMemberships, user }) => ({
        displayName: user.displayName,
        email: user.email,
        id,
        role,
        teamIds: teamMemberships.map(({ teamId }) => teamId).sort(),
      })),
      projects: projects.map(({ projectTeams, ...project }) => ({
        ...project,
        projectTeams: projectTeams.map(({ isActive, ...projectTeam }) => ({
          ...projectTeam,
          active: isActive,
        })),
      })),
      states: teams.flatMap((team) =>
        team.workflowStates.map((state) => ({ ...state, teamId: team.id })),
      ),
      teams: teams.map(({ id, key, name, version }) => ({ id, key, name, version })),
    };
    const fingerprint = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    return { ...snapshot, fingerprint };
  }
}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { DatabaseModule } from './common/database/database.module';
import { ApiExceptionFilter } from './common/errors/api-exception.filter';
import { JsonBodyGuard } from './common/guards/json-body.guard';
import { OriginGuard } from './common/guards/origin.guard';
import { createLoggerOptions } from './common/logging/pino-http.options';
import { ObservabilityModule } from './common/observability/observability.module';
import { apiConfig } from './config/api.config';
import { validateApiEnvironment } from './config/api-environment';
import { AuthModule } from './modules/auth/auth.module';
import { IssueCollaborationModule } from './modules/collaboration/issue-collaboration.module';
import { EventsModule } from './modules/events/events.module';
import { ExportsModule } from './modules/exports/exports.module';
import { FilesModule } from './modules/files/files.module';
import { HealthModule } from './modules/health/health.module';
import { InvitationsModule } from './modules/invitations/invitations.module';
import { IssuesModule } from './modules/issues/issues.module';
import { LabelsModule } from './modules/labels/labels.module';
import { MembersModule } from './modules/members/members.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { SearchModule } from './modules/search/search.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TrashModule } from './modules/trash/trash.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';

const environmentFiles =
  process.env.NODE_ENV === 'test' ? ['../../.env.test.local'] : ['../../.env.local', '../../.env'];

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      envFilePath: environmentFiles,
      isGlobal: true,
      load: [apiConfig],
      validate: validateApiEnvironment,
    }),
    LoggerModule.forRootAsync({
      inject: [apiConfig.KEY],
      useFactory: createLoggerOptions,
    }),
    ObservabilityModule,
    DatabaseModule,
    AuthModule,
    IssueCollaborationModule,
    EventsModule,
    ExportsModule,
    FilesModule,
    HealthModule,
    InvitationsModule,
    IssuesModule,
    LabelsModule,
    MembersModule,
    NotificationsModule,
    ProjectsModule,
    SearchModule,
    WorkspacesModule,
    TeamsModule,
    TrashModule,
  ],
  providers: [
    ApiExceptionFilter,
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: JsonBodyGuard },
  ],
})
export class AppModule {}

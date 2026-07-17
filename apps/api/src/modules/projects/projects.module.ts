import { Module } from '@nestjs/common';

import { ProjectRepository } from './project.repository';
import { ProjectQueryService } from './project-query.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectQueryService, ProjectRepository, ProjectsService],
})
export class ProjectsModule {}

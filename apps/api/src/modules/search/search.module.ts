import { Module } from '@nestjs/common';

import { IssuesModule } from '../issues/issues.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController],
  imports: [IssuesModule],
  providers: [SearchService],
})
export class SearchModule {}

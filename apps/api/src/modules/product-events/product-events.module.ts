import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { ProductEventsController } from './product-events.controller';
import { ProductEventsService } from './product-events.service';

@Module({
  controllers: [ProductEventsController],
  imports: [AuthModule],
  providers: [ProductEventsService],
})
export class ProductEventsModule {}

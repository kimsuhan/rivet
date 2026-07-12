import { Module } from '@nestjs/common';

import { EmailDeliveryService } from './email-delivery.service';
import { EmailSenderService } from './email-sender.service';

@Module({
  exports: [EmailDeliveryService],
  providers: [EmailDeliveryService, EmailSenderService],
})
export class EmailModule {}

import { Module } from '@nestjs/common';

import { WebPushDeliveryService } from './web-push-delivery.service';

@Module({ exports: [WebPushDeliveryService], providers: [WebPushDeliveryService] })
export class WebPushModule {}

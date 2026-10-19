import { Module } from '@nestjs/common';
import { SendNotificationProcessor } from './infrastructure/jobs/send-notification.processor';

@Module({
  providers: [SendNotificationProcessor],
})
export class NotificationsModule {}

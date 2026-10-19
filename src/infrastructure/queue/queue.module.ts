import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { DEFAULT_JOB_OPTIONS, QUEUE_PRIORITY, QUEUES } from './queue.constants';
import { TenantAwareJobService } from './tenant-aware-job.service';

// Chaque file hérite des options par défaut (racine, ci-dessous) + sa priorité.
const queues = Object.values(QUEUES).map((name) => ({
  name,
  defaultJobOptions: { priority: QUEUE_PRIORITY[name] },
}));

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        connection: { url: config.redis.url, maxRetriesPerRequest: null },
        prefix: `${config.redis.keyPrefix}:bull`,
        // Retry + backoff exponentiel appliqués à TOUS les jobs, sans que le
        // moindre `queue.add()` ait à s'en soucier.
        defaultJobOptions: DEFAULT_JOB_OPTIONS,
      }),
    }),
    BullModule.registerQueue(...queues),
  ],
  providers: [TenantAwareJobService],
  exports: [BullModule, TenantAwareJobService],
})
export class QueueModule {}

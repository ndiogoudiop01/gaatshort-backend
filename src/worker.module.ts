import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';

import { AppConfigModule } from '@config/config.module';
import { SystemModule } from '@infra/system/system.module';
import { PrismaModule } from '@infra/persistence/prisma/prisma.module';
import { TenancyModule } from '@infra/tenancy/tenancy.module';
import { CacheModule } from '@infra/cache/cache.module';
import { QueueModule } from '@infra/queue/queue.module';
import { EventsModule } from '@infra/events/events.module';
import { StorageModule } from '@infra/storage/storage.module';
import { MailModule } from '@infra/mail/mail.module';
import { ObservabilityModule } from '@infra/observability/observability.module';

import { NotificationsModule } from '@modules/notifications/notifications.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';

/**
 * Contexte du process WORKER : mêmes modules métier, aucun contrôleur HTTP.
 *
 * Le module de tenancy est chargé sans son middleware : les workers
 * reconstruisent le contexte depuis le payload du job (TenantAwareJobService),
 * pas depuis une requête.
 *
 * DIMENSIONNEMENT : l'API scale sur la latence p95, les workers sur la
 * profondeur des files. Deux signaux différents, deux déploiements séparés.
 */
@Module({
  imports: [
    AppConfigModule,
    SystemModule,
    ObservabilityModule,
    PrismaModule,
    CacheModule,
    TenancyModule,
    QueueModule,
    EventsModule,
    StorageModule,
    MailModule,
    ScheduleModule.forRoot(),

    ComplianceModule,
    NotificationsModule,
  ],
})
export class WorkerModule {}

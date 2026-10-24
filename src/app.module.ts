import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

// ─── Socle technique ────────────────────────────────────────────────────
import { AppConfigModule } from '@config/config.module';
import { AppConfigService } from '@config/app-config.service';
import { SystemModule } from '@infra/system/system.module';
import { PrismaModule } from '@infra/persistence/prisma/prisma.module';
import { TenancyModule } from '@infra/tenancy/tenancy.module';
import { CacheModule } from '@infra/cache/cache.module';
import { QueueModule } from '@infra/queue/queue.module';
import { EventsModule } from '@infra/events/events.module';
import { StorageModule } from '@infra/storage/storage.module';
import { MailModule } from '@infra/mail/mail.module';
import { ObservabilityModule } from '@infra/observability/observability.module';
import { SecurityModule } from '@infra/security/security.module';

// ─── Contextes métier ───────────────────────────────────────────────────
import { IamModule } from '@modules/iam/iam.module';
import { TenantAdminModule } from '@modules/tenancy/tenant-admin.module';
import { LocalizationModule } from '@modules/localization/localization.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { WalletModule } from '@modules/wallet/wallet.module';
import { LibraryModule } from '@modules/library/library.module';
import { BillingModule } from '@modules/billing/billing.module';
import { AudienceModule } from '@modules/audience/audience.module';
import { ViewerContextModule } from '@infra/viewer/viewer-context.service';

// ─── Transverses HTTP ───────────────────────────────────────────────────
import { JwtAuthGuard } from '@shared/guards/jwt-auth.guard';
import { PermissionsGuard } from '@shared/guards/permissions.guard';
import { TenantMemberGuard } from '@shared/guards/tenant-member.guard';
import { TenantThrottlerGuard } from '@infra/ratelimit/tenant-throttler.guard';
import { LoggingInterceptor } from '@shared/interceptors/logging.interceptor';
import { LogCorrelationInterceptor } from '@infra/observability/logger/log-correlation.interceptor';
import { HttpMetricsInterceptor } from '@infra/observability/metrics/http-metrics.interceptor';
import { IdempotencyInterceptor } from '@infra/idempotency/idempotency.interceptor';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  MONOLITHE MODULAIRE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Pourquoi PAS des microservices dès le départ ?
 * Parce qu'à ce stade du produit, le coût d'exploitation (réseau, traçage
 * distribué, cohérence éventuelle, cinq pipelines de déploiement) dépasserait
 * de loin le bénéfice. On garde donc UN déployable, mais des frontières de
 * modules aussi strictes que celles de services distincts :
 *   • chaque module a son domaine, ses ports, sa façade publique ;
 *   • aucun accès direct aux entrailles d'un autre module (ESLint + CI) ;
 *   • la communication inter-contextes passe par des événements ;
 *   • aucune requête SQL ne traverse deux contextes.
 *
 * Conséquence : le jour où `simulation` ou `analytics` doit devenir un
 * service autonome, on l'extrait en remplaçant sa façade par un client HTTP.
 * L'architecture prépare la sortie sans en payer le prix aujourd'hui.
 *
 * ORDRE DES GUARDS GLOBAUX (il est significatif) :
 *   1. Throttler      — on rejette l'abus avant de dépenser du CPU
 *   2. JwtAuthGuard   — qui es-tu ?
 *   3. TenantMember   — es-tu bien dans CE tenant ?
 *   4. Permissions    — as-tu le droit d'appeler cette route ?
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
    SecurityModule,
    ViewerContextModule,
    ScheduleModule.forRoot(),

    IamModule,
    TenantAdminModule,
    LocalizationModule,
    ComplianceModule,
    NotificationsModule,
    CatalogModule,
    WalletModule,
    LibraryModule,
    BillingModule,
    AudienceModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: TenantThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantMemberGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    // Ordre significatif : la corrélation des logs d'abord (l'`assign` doit
    // précéder tout log), puis la mesure HTTP, puis l'access-log métier.
    { provide: APP_INTERCEPTOR, useClass: LogCorrelationInterceptor },
    { provide: APP_INTERCEPTOR, useClass: HttpMetricsInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    {
      provide: APP_FILTER,
      useFactory: (config: AppConfigService) => new AllExceptionsFilter(config.app.isProduction),
      inject: [AppConfigService],
    },
  ],
})
export class AppModule {}

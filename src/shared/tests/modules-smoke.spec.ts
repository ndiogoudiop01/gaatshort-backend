/**
 * Smoke test : chaque module Nest doit se charger sans erreur d'import ni de
 * décorateur mal formé. On ne compile PAS l'arbre d'injection (ce serait un
 * test d'intégration) — seule la définition de la classe est vérifiée ici.
 */
import { AppModule } from '@/app.module';
import { WorkerModule } from '@/worker.module';
import { AppConfigModule } from '@config/config.module';
import { CacheModule } from '@infra/cache/cache.module';
import { EventsModule } from '@infra/events/events.module';
import { MailModule } from '@infra/mail/mail.module';
import { ObservabilityModule } from '@infra/observability/observability.module';
import { PrismaModule } from '@infra/persistence/prisma/prisma.module';
import { QueueModule } from '@infra/queue/queue.module';
import { SecurityModule } from '@infra/security/security.module';
import { StorageModule } from '@infra/storage/storage.module';
import { SystemModule } from '@infra/system/system.module';
import { TenancyModule } from '@infra/tenancy/tenancy.module';
import { ComplianceModule } from '@modules/compliance/compliance.module';
import { IamModule } from '@modules/iam/iam.module';
import { LocalizationModule } from '@modules/localization/localization.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { TenantAdminModule } from '@modules/tenancy/tenant-admin.module';

describe('Modules Nest', () => {
  it.each([
    ['AppModule', AppModule],
    ['WorkerModule', WorkerModule],
    ['AppConfigModule', AppConfigModule],
    ['CacheModule', CacheModule],
    ['EventsModule', EventsModule],
    ['MailModule', MailModule],
    ['ObservabilityModule', ObservabilityModule],
    ['PrismaModule', PrismaModule],
    ['QueueModule', QueueModule],
    ['SecurityModule', SecurityModule],
    ['StorageModule', StorageModule],
    ['SystemModule', SystemModule],
    ['TenancyModule', TenancyModule],
    ['ComplianceModule', ComplianceModule],
    ['IamModule', IamModule],
    ['LocalizationModule', LocalizationModule],
    ['NotificationsModule', NotificationsModule],
    ['TenantAdminModule', TenantAdminModule],
  ])('%s se charge et est bien une classe définie', (_name, moduleClass) => {
    expect(moduleClass).toBeDefined();
    expect(typeof moduleClass).toBe('function');
  });
});

describe('WorkerModule — process autonome', () => {
  const imports = (m: unknown): string[] =>
    ((Reflect.getMetadata('imports', m as object) as unknown[]) ?? []).map(
      (i) => (i as { name?: string }).name ?? String(i),
    );

  it('ne déclare AUCUN contrôleur HTTP (le worker n’expose pas de serveur)', () => {
    const controllers = (Reflect.getMetadata('controllers', WorkerModule) as unknown[]) ?? [];
    expect(controllers).toHaveLength(0);
  });

  it('partage les modules métier « à jobs » avec l’API', () => {
    const worker = imports(WorkerModule);
    const app = imports(AppModule);
    for (const shared of ['NotificationsModule', 'ComplianceModule']) {
      expect(worker).toContain(shared);
      expect(app).toContain(shared);
    }
  });
});

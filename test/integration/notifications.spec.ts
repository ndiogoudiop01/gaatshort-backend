import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { TenantContextData } from '@shared/kernel/ports/tenant-context.port';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { TransactionHost } from '@infra/persistence/prisma/transaction-host.service';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { TemplateRenderer } from '@infra/mail/template-renderer.service';
import { TenantTestContext } from '../utils/tenant-test-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Gabarits de notification — cascade tenant → défaut, contre un vrai Postgres.
 *
 *  Ce qu'un test unitaire (Prisma mocké) ne peut PAS prouver, et qui était le
 *  bug corrigé par ce ticket : `notification_templates` porte `tenant_id` et
 *  subit `FORCE ROW LEVEL SECURITY`. Lu via le client BRUT (l'ancien
 *  `TemplateRenderer`), `app.current_tenant_id` n'est jamais posé → 0 ligne →
 *  la surcharge par tenant est silencieusement ignorée.
 *
 *  On rend donc via `TenantPrismaService`, sur la connexion `gaatshort_app`
 *  (NOBYPASSRLS) : les DEUX remparts (injection applicative + RLS) sont
 *  réellement exercés. Le seed passe par la connexion propriétaire.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const A = randomUUID();
const B = randomUUID();

const ctxData = (tenantId: string, slug: string): TenantContextData => ({
  tenantId,
  slug,
  isolation: 'SHARED_RLS',
  defaultLocale: 'fr',
  defaultCountry: 'SN',
  defaultCurrency: 'XOF',
  timezone: 'Africa/Dakar',
  featureFlags: {},
});

describe('Gabarits de notification (Postgres réel + RLS)', () => {
  const ctx = new TenantTestContext();
  let owner: PrismaClient; // rôle propriétaire — seed / cleanup privilégiés
  let app: PrismaClient; // rôle gaatshort_app — NOBYPASSRLS, subit les politiques
  let tenantCtx: TenantContextService;
  let renderer: TemplateRenderer;

  const bypass = <T>(fn: (tx: PrismaClient) => Promise<T>): Promise<T> =>
    owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return fn(tx as unknown as PrismaClient);
    });

  beforeAll(async () => {
    const env = await ctx.start();
    owner = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
    app = new PrismaClient({ datasources: { db: { url: env.appDatabaseUrl } } });
    tenantCtx = new TenantContextService();
    renderer = new TemplateRenderer(
      new TenantPrismaService(app as unknown as PrismaService, tenantCtx, new TransactionHost()),
    );

    // Le tenant A surcharge auth.otp (EMAIL + SMS) ; B ne surcharge rien.
    await bypass(async (tx) => {
      await tx.tenant.createMany({
        data: [
          { id: A, slug: 'asso-a', name: 'Asso A' },
          { id: B, slug: 'asso-b', name: 'Asso B' },
        ],
      });
      await tx.notificationTemplate.createMany({
        data: [
          { tenantId: A, key: 'auth.otp', channel: 'EMAIL', locale: 'fr', subject: 'Code A : {{code}}', body: '<b>{{code}}</b> — Asso A' },
          { tenantId: A, key: 'auth.otp', channel: 'SMS', locale: 'fr', body: 'Asso A : {{code}}' },
        ],
      });
    });
  }, 180_000);

  afterAll(async () => {
    if (owner) {
      await bypass(async (tx) => {
        await tx.notificationTemplate.deleteMany({ where: { tenantId: { in: [A, B] } } });
        await tx.tenant.deleteMany({ where: { id: { in: [A, B] } } });
      }).catch(() => undefined);
      await owner.$disconnect();
    }
    if (app) await app.$disconnect();
    await ctx.stop();
  });

  it('EMAIL : le gabarit personnalisé du tenant A prime sur le défaut plateforme', async () => {
    const rendered = await tenantCtx.runWith(ctxData(A, 'asso-a'), () =>
      renderer.render('auth.otp', 'EMAIL', 'fr', { code: '999' }),
    );
    expect(rendered.subject).toBe('Code A : 999');
    expect(rendered.body).toBe('<b>999</b> — Asso A');
  });

  it('EMAIL : le tenant B, sans surcharge, obtient le gabarit par défaut', async () => {
    const rendered = await tenantCtx.runWith(ctxData(B, 'asso-b'), () =>
      renderer.render('auth.otp', 'EMAIL', 'fr', { code: '999', ttlMinutes: 5 }),
    );
    expect(rendered.subject).toBe('Votre code de vérification');
    expect(rendered.body).toContain('999');
  });

  it('SMS : la surcharge tenant s’applique aussi (canal de première classe)', async () => {
    const a = await tenantCtx.runWith(ctxData(A, 'asso-a'), () =>
      renderer.render('auth.otp', 'SMS', 'fr', { code: '42' }),
    );
    const b = await tenantCtx.runWith(ctxData(B, 'asso-b'), () =>
      renderer.render('auth.otp', 'SMS', 'fr', { code: '42', ttlMinutes: 5 }),
    );
    expect(a.body).toBe('Asso A : 42'); // gabarit SMS du tenant
    expect(b.body).toBe('Code de vérification : 42 (valable 5 min). Ne le partagez pas.'); // défaut SMS
    expect(a.body).not.toContain('<'); // texte brut, pas de HTML
  });

  it('un tenant ne récupère jamais le gabarit d’un autre (RLS, pas seulement l’injection applicative)', async () => {
    const rendered = await tenantCtx.runWith(ctxData(B, 'asso-b'), () =>
      renderer.render('auth.otp', 'EMAIL', 'fr', { code: '1' }),
    );
    expect(rendered.subject).not.toContain('Asso A');
    expect(rendered.subject).toBe('Votre code de vérification');
  });
});

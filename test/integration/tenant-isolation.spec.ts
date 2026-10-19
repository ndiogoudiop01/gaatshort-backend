import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { TenantTestContext } from '../utils/tenant-test-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LE TEST LE PLUS IMPORTANT DU DÉPÔT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Il vérifie que la Row Level Security tient VRAIMENT, indépendamment de
 * toute logique applicative. Il attaque Postgres en SQL direct, sans passer
 * par l'extension Prisma qui filtre normalement.
 *
 * Si ce test tombe, on ne livre pas. Une fuite entre tenants n'est pas un
 * bug fonctionnel : c'est une violation de données.
 *
 * PRÉ-REQUIS : la connexion utilise le rôle NON privilégié `gaatshort_app`
 * (fourni par TenantTestContext via `appDatabaseUrl`), sinon Postgres
 * contourne silencieusement toutes les politiques et le test passerait en
 * donnant une fausse assurance.
 */
describe('Isolation multi-tenant (RLS Postgres)', () => {
  const ctx = new TenantTestContext();
  // `prisma`  : rôle applicatif `gaatshort_app` (NOBYPASSRLS) — ce que les tests
  //             d'attaque DOIVENT utiliser.
  // `owner`   : rôle propriétaire — sème et nettoie les fixtures ; `gaatshort_app`
  //             n'écrit `tenants` qu'en `$privileged` (politique RLS dédiée).
  let prisma: PrismaClient;
  let owner: PrismaClient;

  const tenantA = randomUUID();
  const tenantB = randomUUID();

  beforeAll(async () => {
    const env = await ctx.start();
    prisma = new PrismaClient({ datasources: { db: { url: env.appDatabaseUrl } } });
    owner = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });

    // Amorçage avec le rôle owner : `bypass_rls` local + inserts dans la MÊME
    // transaction (un `set_config` de session ne suivrait pas le pool Prisma).
    // `FORCE ROW LEVEL SECURITY` s'applique même à l'owner, d'où le bypass.
    await owner.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      await tx.tenant.createMany({
        data: [
          { id: tenantA, slug: `a-${tenantA.slice(0, 8)}`, name: 'Tenant A' },
          { id: tenantB, slug: `b-${tenantB.slice(0, 8)}`, name: 'Tenant B' },
        ],
      });
      await tx.user.createMany({
        data: [
          { id: randomUUID(), tenantId: tenantA, email: 'a@example.test', status: 'ACTIVE' },
          { id: randomUUID(), tenantId: tenantB, email: 'b@example.test', status: 'ACTIVE' },
        ],
      });
    });
  }, 180_000);

  afterAll(async () => {
    if (owner) {
      await owner
        .$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
          await tx.user.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
          await tx.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
        })
        .catch(() => undefined);
      await owner.$disconnect();
    }
    if (prisma) await prisma.$disconnect();
    await ctx.stop();
  });

  it('ne renvoie que les lignes du tenant positionné en session', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
      const rows = await tx.$queryRaw<
        { id: string; tenant_id: string }[]
      >`SELECT id, tenant_id FROM users`;
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((r) => r.tenant_id === tenantA)).toBe(true);
    });
  });

  it('renvoie ZÉRO ligne quand aucun tenant n’est positionné (fail-closed)', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', '', TRUE)`;
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM users`;
      expect(rows).toHaveLength(0);
    });
  });

  it('bloque une lecture ciblée sur un identifiant d’un AUTRE tenant', async () => {
    const foreign = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantB}::text, TRUE)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM users LIMIT 1`;
    });

    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM users WHERE id = ${foreign[0].id}::uuid
      `;
      // Même en connaissant l'UUID exact, la ligne reste invisible.
      expect(rows).toHaveLength(0);
    });
  });

  it('interdit d’INSÉRER une ligne pour le compte d’un autre tenant', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
        await tx.$executeRaw`
          INSERT INTO users (id, tenant_id, email, status, locale, created_at, updated_at)
          VALUES (gen_random_uuid(), ${tenantB}::uuid, 'intrus@example.test', 'ACTIVE', 'fr', NOW(), NOW())
        `;
      }),
    ).rejects.toThrow();
  });

  it('interdit d’UPDATE une ligne d’un autre tenant', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
      const affected = await tx.$executeRaw`
        UPDATE users SET status = 'SUSPENDED' WHERE tenant_id = ${tenantB}::uuid
      `;
      // Aucune ligne touchée : la politique filtre AVANT la mise à jour.
      expect(affected).toBe(0);
    });
  });

  it('le registre `tenants` est lisible mais NON modifiable hors `$privileged`', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
      const visible = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM tenants WHERE id = ${tenantB}::uuid`;
      // Lecture libre : l'annuaire résout le tenant AVANT tout contexte.
      expect(visible).toHaveLength(1);
      const updated =
        await tx.$executeRaw`UPDATE tenants SET name = 'Piraté' WHERE id = ${tenantB}::uuid`;
      const deleted = await tx.$executeRaw`DELETE FROM tenants WHERE id = ${tenantB}::uuid`;
      expect(updated).toBe(0);
      expect(deleted).toBe(0);
    });
    await expect(
      prisma.$executeRaw`INSERT INTO tenants (id, slug, name, updated_at) VALUES (gen_random_uuid(), ${`x-${tenantA.slice(0, 8)}`}, 'Intrus', NOW())`,
    ).rejects.toThrow();
  });

  it('le registre `tenants` s’écrit en `$privileged` (administration SUPER_ADMIN)', async () => {
    const id = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      await tx.$executeRaw`INSERT INTO tenants (id, slug, name, updated_at) VALUES (${id}::uuid, ${`p-${id.slice(0, 8)}`}, 'Créé', NOW())`;
      expect(await tx.$executeRaw`UPDATE tenants SET name = 'Renommé' WHERE id = ${id}::uuid`).toBe(
        1,
      );
      expect(await tx.$executeRaw`DELETE FROM tenants WHERE id = ${id}::uuid`).toBe(1);
    });
  });

  it('interdit de SUPPRIMER une ligne d’un autre tenant', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantA}::text, TRUE)`;
      const affected = await tx.$executeRaw`
        DELETE FROM users WHERE tenant_id = ${tenantB}::uuid
      `;
      // La politique filtre la ligne AVANT la suppression : rien n'est touché.
      expect(affected).toBe(0);
    });
  });

  // Garde-fou du découpage « RLS sur toutes les tables métier » : la liste
  // n'étant plus codée en dur (rls-policies.sql la dérive de information_schema),
  // ce test échoue si une table portant `tenant_id` échappe à la protection.
  it('chaque table portant tenant_id a RLS + FORCE + policy tenant_isolation', async () => {
    const gaps = await owner.$queryRaw<{ relname: string; issue: string }[]>`
      SELECT c.relname,
             concat_ws(', ',
               CASE WHEN NOT c.relrowsecurity      THEN 'RLS désactivée' END,
               CASE WHEN NOT c.relforcerowsecurity THEN 'FORCE désactivé' END,
               CASE WHEN p.policyname IS NULL      THEN 'policy tenant_isolation absente' END
             ) AS issue
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_policies p
        ON p.schemaname = 'public' AND p.tablename = c.relname AND p.policyname = 'tenant_isolation'
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND EXISTS (
          SELECT 1 FROM information_schema.columns col
          WHERE col.table_schema = 'public'
            AND col.table_name = c.relname
            AND col.column_name = 'tenant_id'
        )
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity OR p.policyname IS NULL)
      ORDER BY c.relname
    `;
    expect(gaps).toEqual([]);
  });

  // Le socle comptait ≥ 40 tables métier (SOOBA) ; Gaatshort en a moins et le nombre grandira à
  // chaque phase. On vérifie donc l'égalité « une policy par table portant tenant_id » et qu'elle
  // n'est pas vide, plutôt qu'un seuil codé en dur.
  it('la policy tenant_isolation existe pour chaque table métier, et seulement pour elles', async () => {
    const [row] = await owner.$queryRaw<{ policies: bigint; tables: bigint }[]>`
      SELECT
        (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'tenant_isolation') AS policies,
        (SELECT count(DISTINCT table_name) FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'tenant_id'
            AND table_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public')) AS tables
    `;
    expect(Number(row.tables)).toBeGreaterThan(0);
    expect(Number(row.policies)).toBe(Number(row.tables));
  });
});

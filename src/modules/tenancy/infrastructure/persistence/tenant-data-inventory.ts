import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { TenantDataInventoryPort } from '../../domain/ports/tenant-data-inventory.port';
import type { TenantDataUsage } from '../../domain/services/tenant-admin-rules';

/** Identifiant de table tel que le catalogue le renvoie : on n'accepte rien d'autre. */
const SAFE_TABLE = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Inventaire des données d'un tenant, lu dans le CATALOGUE Postgres.
 *
 * Même principe que `prisma/sql/rls-policies.sql` : la liste des tables n'est
 * pas codée en dur. Toute table `public` portant une colonne `tenant_id`
 * (y compris celles qu'ajouteront l'Academy et les Process 03 à 08) est
 * inspectée automatiquement — impossible d'oublier une table et de supprimer
 * un tenant qui a des données.
 *
 * Les tables partitionnées sont lues par leur table mère (`relkind = 'p'`),
 * jamais partition par partition.
 *
 * À appeler dans une transaction `$privileged()` : sans `app.bypass_rls`, la
 * RLS masquerait les lignes du tenant inspecté et l'inventaire serait vide.
 */
@Injectable()
export class PrismaTenantDataInventory implements TenantDataInventoryPort<Prisma.TransactionClient> {
  public async tablesWithTenantColumn(tx: Prisma.TransactionClient): Promise<string[]> {
    const rows = await tx.$queryRaw<{ table: string }[]>`
      SELECT c.relname AS "table"
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      WHERE n.nspname = 'public'
        AND c.relkind IN ('r', 'p')
        AND NOT c.relispartition
      ORDER BY c.relname
    `;
    return rows.map((r) => r.table).filter((t) => SAFE_TABLE.test(t));
  }

  /** Nombre de lignes du tenant, table par table — seules les tables non vides reviennent. */
  public async usage(tx: Prisma.TransactionClient, tenantId: string, tables: readonly string[]): Promise<TenantDataUsage[]> {
    const safe = tables.filter((t) => SAFE_TABLE.test(t));
    if (!safe.length) return [];
    const rows = await tx.$queryRaw<{ table: string; rows: number }[]>(PrismaTenantDataInventory.usageQuery(tenantId, safe));
    return rows.map((r) => ({ table: r.table, rows: Number(r.rows) })).filter((r) => r.rows > 0);
  }

  /** Supprime les lignes techniques du tenant (tables de `TENANT_TECHNICAL_TABLES.purge`). */
  public async purge(tx: Prisma.TransactionClient, tenantId: string, tables: readonly string[]): Promise<void> {
    for (const table of tables.filter((t) => SAFE_TABLE.test(t))) {
      await tx.$executeRaw`DELETE FROM ${Prisma.raw(`"public"."${table}"`)} WHERE tenant_id = ${tenantId}::uuid`;
    }
  }

  /**
   * Une seule requête : `UNION ALL` d'un `COUNT(*)` par table. Les noms de
   * table viennent du catalogue et sont revalidés (`SAFE_TABLE`) avant d'être
   * interpolés ; l'identifiant du tenant reste un paramètre lié.
   */
  public static usageQuery(tenantId: string, tables: readonly string[]): Prisma.Sql {
    const parts = tables.map(
      (table) =>
        Prisma.sql`SELECT ${table}::text AS "table", COUNT(*)::int AS "rows" FROM ${Prisma.raw(`"public"."${table}"`)} WHERE tenant_id = ${tenantId}::uuid`,
    );
    return Prisma.join(parts, ' UNION ALL ');
  }
}

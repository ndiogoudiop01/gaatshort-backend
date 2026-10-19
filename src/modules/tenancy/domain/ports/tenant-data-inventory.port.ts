import type { TenantDataUsage } from '../services/tenant-admin-rules';

export const TENANT_DATA_INVENTORY = Symbol('TENANT_DATA_INVENTORY');

/**
 * Inventaire des données d'un tenant (règle « pas de données = supprimable »).
 *
 * `Tx` reste opaque pour le domaine : l'implémentation reçoit la transaction
 * `$privileged()` ouverte par le cas d'usage, afin que verrou, inventaire et
 * suppression soient ATOMIQUES.
 */
export interface TenantDataInventoryPort<Tx = unknown> {
  /** Tables `public` portant une colonne `tenant_id` (lues dans le catalogue). */
  tablesWithTenantColumn(tx: Tx): Promise<string[]>;
  /** Lignes du tenant par table — seules les tables non vides reviennent. */
  usage(tx: Tx, tenantId: string, tables: readonly string[]): Promise<TenantDataUsage[]>;
  /** Supprime les lignes techniques du tenant dans les tables données. */
  purge(tx: Tx, tenantId: string, tables: readonly string[]): Promise<void>;
}

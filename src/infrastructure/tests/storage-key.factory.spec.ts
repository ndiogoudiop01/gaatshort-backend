import { MissingTenantContextError } from '@shared/kernel/errors/tenant.error';
import { TenantContextService } from '../tenancy/context/tenant-context.service';
import { StorageKeyFactory } from '../storage/storage-key.factory';

function buildFactory(tenantId = 'tenant-1'): StorageKeyFactory {
  return new StorageKeyFactory({ tenantId } as unknown as TenantContextService);
}

describe('StorageKeyFactory', () => {
  it('préfixe la clé d’un document de candidature par le tenant', () => {
    const key = buildFactory().forApplicationDocument('app-1', 'piece.pdf');
    expect(key).toMatch(/^tenants\/tenant-1\/applications\/app-1\/[0-9a-f-]{36}\.pdf$/);
  });

  it('préfixe la clé d’une pièce jointe partenaire', () => {
    const key = buildFactory().forPartnerAttachment('lead-1', 'plaquette.png');
    expect(key).toMatch(/^tenants\/tenant-1\/partners\/lead-1\/[0-9a-f-]{36}\.png$/);
  });

  it('préfixe la clé d’un export', () => {
    const key = buildFactory().forExport('pool', 'export.csv');
    expect(key).toMatch(/^tenants\/tenant-1\/exports\/pool\/[0-9a-f-]{36}\.csv$/);
  });

  it('ne réutilise jamais le nom d’origine — un nouvel UUID est généré à chaque appel', () => {
    const factory = buildFactory();
    const a = factory.forApplicationDocument('app-1', 'piece.pdf');
    const b = factory.forApplicationDocument('app-1', 'piece.pdf');
    expect(a).not.toBe(b);
  });

  it('ignore une extension malformée plutôt que de la propager telle quelle', () => {
    const key = buildFactory().forApplicationDocument('app-1', 'piece.<script>');
    expect(key.endsWith('.pdf')).toBe(false);
    expect(key).not.toContain('<script>');
  });

  /**
   * NON-RÉGRESSION : `PoolExportProcessor` promet qu'un rejeu réécrit le
   * MÊME objet. Avec `forExport()` (nom jeté + `randomUUID()`, cf. le test
   * ci-dessus), un job rejoué 5 fois par BullMQ déposait 5 CSV nominatifs
   * orphelins. La propriété est vérifiée ici sur la VRAIE fabrique, jamais
   * sur un mock — c'est un mock trop complaisant qui masquait le défaut.
   */
  it('dérive une clé d’export DÉTERMINISTE : deux appels, une seule clé', () => {
    const factory = buildFactory();

    const first = factory.forDeterministicExport('pool', 'pool-job-1.csv');
    const second = factory.forDeterministicExport('pool', 'pool-job-1.csv');

    expect(first).toBe('tenants/tenant-1/exports/pool/pool-job-1.csv');
    expect(second).toBe(first);
  });

  it('assainit le nom pour qu’aucune valeur de job ne sorte du préfixe du tenant', () => {
    const key = buildFactory().forDeterministicExport('pool', '../../secrets/pool.csv');

    expect(key).toBe('tenants/tenant-1/exports/pool/..-..-secrets-pool.csv');
    expect(key.startsWith('tenants/tenant-1/exports/pool/')).toBe(true);
  });

  it('deux tenants n’ont jamais le même préfixe', () => {
    const a = buildFactory('tenant-A').forExport('pool', 'x.csv');
    const b = buildFactory('tenant-B').forExport('pool', 'x.csv');
    expect(a.startsWith('tenants/tenant-A/')).toBe(true);
    expect(b.startsWith('tenants/tenant-B/')).toBe(true);
  });

  it('impossible de fabriquer une clé hors de tout contexte tenant', () => {
    // Le vrai TenantContextService : son getter `tenantId` jette si l'ALS est vide.
    const factory = new StorageKeyFactory(new TenantContextService());
    expect(() => factory.forApplicationDocument('app-1', 'piece.pdf')).toThrow(MissingTenantContextError);
  });
});

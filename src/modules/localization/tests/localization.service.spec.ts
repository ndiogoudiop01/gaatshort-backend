import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import type { CachePort } from '@shared/kernel/ports/cache.port';
import type { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import type { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { LocalizationService } from '../application/services/localization.service';

/** Cache « passe-plat » — même helper que les autres suites de ce dépôt. */
function passThroughCache(): CachePort {
  return {
    get: () => Promise.resolve(null),
    set: () => Promise.resolve(undefined),
    del: () => Promise.resolve(undefined),
    delByPattern: () => Promise.resolve(0),
    remember: (_key, _ttlSeconds, factory) => factory(),
  };
}

function fakeTenantPrisma(overrides: Record<string, unknown>): TenantPrismaService {
  return { client: overrides } as unknown as TenantPrismaService;
}

function fakeTenantContext(tenant: Record<string, unknown>): TenantContextService {
  return { get: () => tenant } as unknown as TenantContextService;
}

describe('LocalizationService', () => {
  describe('availableCountries — référentiel global filtré par l’activation du tenant (US-IG-029)', () => {
    it('ne lit les activations que via le client tenant-scopé (RLS) — jamais le Prisma brut', async () => {
      const findManyTenantCountry = jest.fn((_args: unknown) => {
        void _args;
        return Promise.resolve([{ countryCode: 'SN' }]);
      });
      const findManyCountry = jest.fn(() =>
        Promise.resolve([
          { code: 'SN', nameFr: 'Sénégal', dialCode: '+221', currencyCode: 'XOF', flagEmoji: '🇸🇳' },
        ]),
      );
      const prisma = fakeTenantPrisma({
        tenantCountry: { findMany: findManyTenantCountry },
        country: { findMany: findManyCountry },
      });
      const tenantContext = fakeTenantContext({ tenantId: 'tenant-1', defaultCountry: 'SN' });
      const service = new LocalizationService(prisma, tenantContext, passThroughCache());

      const result = await service.availableCountries();

      expect(findManyTenantCountry).toHaveBeenCalledWith({ where: { isActive: true } });
      expect(result).toEqual([
        { code: 'SN', name: 'Sénégal', dialCode: '+221', currencyCode: 'XOF', flagEmoji: '🇸🇳', isDefault: true },
      ]);
    });

    it('marque isDefault uniquement sur le pays par défaut du tenant', async () => {
      const prisma = fakeTenantPrisma({
        tenantCountry: { findMany: () => Promise.resolve([{ countryCode: 'CI' }]) },
        country: {
          findMany: () =>
            Promise.resolve([{ code: 'CI', nameFr: 'Côte d’Ivoire', dialCode: '+225', currencyCode: 'XOF', flagEmoji: '🇨🇮' }]),
        },
      });
      const tenantContext = fakeTenantContext({ tenantId: 'tenant-1', defaultCountry: 'SN' });
      const service = new LocalizationService(prisma, tenantContext, passThroughCache());

      const [country] = await service.availableCountries();

      expect(country.isDefault).toBe(false);
    });

    it('met la réponse en cache pendant 1 heure (3600 s)', async () => {
      const remember = jest.fn((_key: string, _ttl: number, factory: () => Promise<unknown>) => factory());
      const cache: CachePort = { ...passThroughCache(), remember: remember as unknown as CachePort['remember'] };
      const prisma = fakeTenantPrisma({
        tenantCountry: { findMany: () => Promise.resolve([]) },
        country: { findMany: () => Promise.resolve([]) },
      });
      const tenantContext = fakeTenantContext({ tenantId: 'tenant-1', defaultCountry: 'SN' });
      const service = new LocalizationService(prisma, tenantContext, cache);

      await service.availableCountries();

      expect(remember).toHaveBeenCalledWith('localization:countries', 3_600, expect.any(Function));
    });
  });

  describe('currencies', () => {
    it('liste les devises, triées par code', async () => {
      const findMany = jest.fn((_args: unknown) => {
        void _args;
        return Promise.resolve([{ code: 'XOF' }]);
      });
      const prisma = fakeTenantPrisma({ currency: { findMany } });
      const service = new LocalizationService(prisma, fakeTenantContext({}), passThroughCache());

      expect(await service.currencies()).toEqual([{ code: 'XOF' }]);
      expect(findMany).toHaveBeenCalledWith({ orderBy: { code: 'asc' } });
    });
  });

  describe('toE164 — normalisation avant stockage (US-IG-029)', () => {
    it('lève une erreur catalogée pour un pays inconnu', async () => {
      const prisma = fakeTenantPrisma({ country: { findUnique: () => Promise.resolve(null) } });
      const service = new LocalizationService(prisma, fakeTenantContext({}), passThroughCache());

      await expect(service.toE164('771234567', 'XX')).rejects.toThrow(BusinessRuleViolationError);
    });

    it('normalise un numéro local sénégalais avec indicatif national (0 initial retiré)', async () => {
      const prisma = fakeTenantPrisma({
        country: { findUnique: () => Promise.resolve({ code: 'SN', dialCode: '+221' }) },
      });
      const service = new LocalizationService(prisma, fakeTenantContext({}), passThroughCache());

      expect(await service.toE164('077 123 45 67', 'SN')).toBe('+221771234567');
    });

    it('laisse passer un numéro déjà au format E.164', async () => {
      const prisma = fakeTenantPrisma({
        country: { findUnique: () => Promise.resolve({ code: 'SN', dialCode: '+221' }) },
      });
      const service = new LocalizationService(prisma, fakeTenantContext({}), passThroughCache());

      expect(await service.toE164('+221771234567', 'SN')).toBe('+221771234567');
    });

    it('rejette (jamais un 500 silencieux) un numéro qui ne devient pas un E.164 valide', async () => {
      const prisma = fakeTenantPrisma({
        country: { findUnique: () => Promise.resolve({ code: 'SN', dialCode: '+221' }) },
      });
      const service = new LocalizationService(prisma, fakeTenantContext({}), passThroughCache());

      // Déjà préfixé « + » (donc non recomposé avec l'indicatif du pays), mais
      // un zéro juste après le « + » est interdit par E.164 (le premier chiffre
      // doit être 1-9) — un cas réel de numéro mal saisi, pas un cas fabriqué.
      await expect(service.toE164('+0771234567', 'SN')).rejects.toThrow(BusinessRuleViolationError);
    });
  });
});

import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import {
  TENANT_EDITABLE_FIELDS,
  TenantAdminRules,
  type TenantCurrent,
} from '../domain/services/tenant-admin-rules';

/**
 * BSG-13 — règles de domaine d'administration d'un tenant, testées sans
 * contrôleur ni Prisma (le seuil de couverture `domain/**` est de 90 %).
 */
describe('TenantAdminRules (BSG-13)', () => {
  const tenant = (over: Partial<TenantCurrent> = {}): TenantCurrent => ({
    id: 't-1',
    status: 'ACTIVE',
    branding: { primaryColor: '#000000', logoUrl: 'https://cdn/logo.png', watermark: true },
    featureFlags: { news: true, legacyFlag: true },
    ...over,
  });

  const codeOf = (fn: () => void): string | undefined => {
    try {
      fn();
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(BusinessRuleViolationError);
      return (error as BusinessRuleViolationError).code;
    }
  };

  describe('assertNotEmpty', () => {
    it('refuse un patch sans aucun champ modifiable', () => {
      expect(codeOf(() => TenantAdminRules.assertNotEmpty({}))).toBe('TENANT_PATCH_EMPTY');
    });

    it.each(TENANT_EDITABLE_FIELDS.map((f) => [f]))(
      'accepte un patch ne contenant que « %s »',
      (field) => {
        const value =
          field === 'branding'
            ? {}
            : field === 'featureFlags'
              ? {}
              : field === 'legalName'
                ? null
                : 'x';
        expect(codeOf(() => TenantAdminRules.assertNotEmpty({ [field]: value }))).toBeUndefined();
      },
    );
  });

  describe('assertNotSelfLockout', () => {
    it.each(['SUSPENDED', 'ARCHIVED'] as const)(
      'refuse de passer son propre tenant en %s',
      (status) => {
        expect(
          codeOf(() => TenantAdminRules.assertNotSelfLockout('t-1', tenant(), { status })),
        ).toBe('TENANT_SELF_LOCKOUT');
      },
    );

    it('autorise ACTIVE sur son propre tenant, et tout statut sur un autre tenant', () => {
      expect(
        codeOf(() => TenantAdminRules.assertNotSelfLockout('t-1', tenant(), { status: 'ACTIVE' })),
      ).toBeUndefined();
      expect(
        codeOf(() => TenantAdminRules.assertNotSelfLockout('t-1', tenant(), { name: 'X' })),
      ).toBeUndefined();
      expect(
        codeOf(() =>
          TenantAdminRules.assertNotSelfLockout('t-2', tenant(), { status: 'SUSPENDED' }),
        ),
      ).toBeUndefined();
    });
  });

  describe('toTenantUpdate', () => {
    it('recopie champ par champ et normalise name / legalName', () => {
      expect(
        TenantAdminRules.toTenantUpdate(tenant(), {
          name: '  Gaatshort  ',
          legalName: '   ',
          status: 'SUSPENDED',
          defaultLocale: 'fr',
          defaultCountry: 'SN',
          defaultCurrency: 'XOF',
          timezone: 'Africa/Dakar',
        }),
      ).toEqual({
        name: 'Gaatshort',
        legalName: null,
        status: 'SUSPENDED',
        defaultLocale: 'fr',
        defaultCountry: 'SN',
        defaultCurrency: 'XOF',
        timezone: 'Africa/Dakar',
      });
      expect(TenantAdminRules.toTenantUpdate(tenant(), { legalName: ' Gaatshort ' })).toEqual({
        legalName: 'Gaatshort',
      });
      expect(TenantAdminRules.toTenantUpdate(tenant(), { legalName: null })).toEqual({
        legalName: null,
      });
    });

    it("n'écrit rien pour un patch vide", () => {
      expect(TenantAdminRules.toTenantUpdate(tenant(), {})).toEqual({});
    });

    it("fusionne branding avec l'existant sans effacer les clés inconnues", () => {
      expect(
        TenantAdminRules.toTenantUpdate(tenant(), { branding: { primaryColor: '#ffffff' } }),
      ).toEqual({
        branding: { primaryColor: '#ffffff', logoUrl: 'https://cdn/logo.png', watermark: true },
      });
      expect(TenantAdminRules.toTenantUpdate(tenant(), { branding: { logoUrl: null } })).toEqual({
        branding: { primaryColor: '#000000', logoUrl: null, watermark: true },
      });
    });

    it('part d’un objet vide si branding / featureFlags existants ne sont pas des objets', () => {
      for (const junk of [null, 'texte', ['a']]) {
        const current = tenant({ branding: junk, featureFlags: junk });
        expect(
          TenantAdminRules.toTenantUpdate(current, {
            branding: { primaryColor: '#123456' },
            featureFlags: { news: true },
          }),
        ).toEqual({ branding: { primaryColor: '#123456' }, featureFlags: { news: true } });
      }
    });

    it('fusionne featureFlags et force des booléens stricts', () => {
      const flags = { news: false, beta: 'oui' } as unknown as Record<string, boolean>;
      expect(TenantAdminRules.toTenantUpdate(tenant(), { featureFlags: flags })).toEqual({
        featureFlags: { news: false, legacyFlag: true, beta: false },
      });
    });

    it('ne mute pas les objets du tenant courant', () => {
      const current = tenant();
      TenantAdminRules.toTenantUpdate(current, {
        branding: { primaryColor: '#fff' },
        featureFlags: { x: true },
      });
      expect(current.branding).toEqual({
        primaryColor: '#000000',
        logoUrl: 'https://cdn/logo.png',
        watermark: true,
      });
      expect(current.featureFlags).toEqual({ news: true, legacyFlag: true });
    });
  });

  describe('isValidTimezone', () => {
    it.each(['Africa/Dakar', 'America/Argentina/Buenos_Aires', 'Etc/GMT+1', 'UTC'])(
      'accepte %s',
      (tz) => {
        expect(TenantAdminRules.isValidTimezone(tz)).toBe(true);
      },
    );

    it.each(['Pas/UneZone', 'GMT', 'africa dakar', ''])('refuse %s', (tz) => {
      expect(TenantAdminRules.isValidTimezone(tz)).toBe(false);
    });
  });
});

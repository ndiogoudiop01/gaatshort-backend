import { Inject, Injectable } from '@nestjs/common';
import { CACHE, type CachePort } from '@shared/kernel/ports/cache.port';
import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';

export interface CountryOption {
  readonly code: string;
  readonly name: string;
  readonly dialCode: string;
  readonly currencyCode: string;
  readonly flagEmoji: string | null;
  readonly isDefault: boolean;
}

/**
 * US-IG-029 — multi-pays léger : Sénégal, Côte d'Ivoire, Cameroun, Maroc…
 *
 * Les pays et devises sont des référentiels GLOBAUX (hors RLS) ; ce que
 * chaque tenant choisit d'activer est, lui, scopé (`tenant_countries`).
 * On évite ainsi de dupliquer 250 pays par client.
 *
 * `tenant_countries` porte `tenant_id` : on passe par `TenantPrismaService`
 * (jamais le client brut) pour que le filtre ET le `set_config` soient posés —
 * sinon la RLS renvoie zéro activation et le service retombe silencieusement
 * sur la liste globale.
 *
 * Attention aux devises à 0 décimale (XOF, XAF) : la conversion et le
 * formatage passent par le VO Money, jamais par une multiplication à la main.
 *
 * `tenant_countries` est sous RLS (référentiel d'ACTIVATION, propre à
 * chaque tenant) : la lecture passe par `TenantPrismaService`, jamais par
 * le client Prisma brut — sinon la variable de session
 * `app.current_tenant_id` n'est jamais posée et le second rempart RLS
 * (cf. `tenant-prisma.service.ts`) ne s'applique pas à cette requête.
 * `Country`/`Currency` restent des référentiels GLOBAUX (`GLOBAL_MODELS`) :
 * le même client les traverse sans scoping, à raison.
 */
@Injectable()
export class LocalizationService {
  // E.164 : « + » suivi de 1 à 15 chiffres, le premier non nul (ITU-T E.164 §6).
  private static readonly E164_PATTERN = /^\+[1-9]\d{1,14}$/;

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly tenantContext: TenantContextService,
    @Inject(CACHE) private readonly cache: CachePort,
  ) {}

  public async availableCountries(): Promise<CountryOption[]> {
    const tenant = this.tenantContext.get();
    return this.cache.remember(`localization:countries`, 3_600, async () => {
      const activations = await this.prisma.client.tenantCountry.findMany({
        where: { isActive: true },
      });
      const codes = activations.map((a) => a.countryCode);
      const countries = await this.prisma.client.country.findMany({
        where: codes.length ? { code: { in: codes } } : { isActive: true },
        orderBy: { nameFr: 'asc' },
      });
      return countries.map((c) => ({
        code: c.code,
        name: c.nameFr,
        dialCode: c.dialCode,
        currencyCode: c.currencyCode,
        flagEmoji: c.flagEmoji,
        isDefault: c.code === tenant.defaultCountry,
      }));
    });
  }

  public async currencies() {
    return this.cache.remember('localization:currencies', 3_600, () =>
      this.prisma.client.currency.findMany({ orderBy: { code: 'asc' } }),
    );
  }

  /**
   * Normalisation E.164 : « 77 123 45 67 » saisi au Sénégal devient
   * « +221771234567 ». Sans normalisation à l'entrée, l'unicité du
   * téléphone ne veut rien dire et l'envoi de SMS échoue silencieusement.
   *
   * `normalisé avant stockage` implique une forme garantie, pas seulement
   * une meilleure tentative : le résultat est validé contre le format E.164
   * (RFC 3966 / ITU-T) avant d'être renvoyé — un numéro qui ne s'y conforme
   * toujours pas après normalisation est une erreur catalogée, jamais une
   * valeur bancale écrite en base.
   */
  public async toE164(rawPhone: string, countryCode: string): Promise<string> {
    const country = await this.prisma.client.country.findUnique({ where: { code: countryCode.toUpperCase() } });
    if (!country) {
      throw new BusinessRuleViolationError('UNKNOWN_COUNTRY', `Pays inconnu : ${countryCode}`);
    }
    const digits = rawPhone.replace(/[^\d+]/g, '');
    const normalized = digits.startsWith('+') ? digits : `${country.dialCode}${digits.replace(/^0+/, '')}`;
    if (!LocalizationService.E164_PATTERN.test(normalized)) {
      throw new BusinessRuleViolationError('INVALID_PHONE_NUMBER', `Numéro de téléphone invalide : ${rawPhone}`);
    }
    return normalized;
  }
}

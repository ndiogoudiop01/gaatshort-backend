/**
 * Règles d'accès à un épisode (D-05, D-06) — pur, sans dépendance.
 *
 *  • Les N premiers épisodes d'une série sont gratuits (N = 5 par défaut, réglable
 *    par série, surchargeable par marque).
 *  • Les suivants coûtent un prix en crédits (série, surcharge d'épisode, surcharge marque).
 *  • La gratuité est CALCULÉE à chaque lecture : une marque peut changer N sans
 *    migration de données (05-BACKEND-SCHEMA §5.2).
 */
export interface SeriesPricing {
  readonly freeEpisodes: number;
  readonly episodePriceCoins: number;
}

export interface TenantPricingOverride {
  readonly freeEpisodesOverride: number | null;
  readonly episodePriceCoinsOverride: number | null;
}

export interface EpisodePricing {
  readonly number: number;
  readonly priceCoinsOverride: number | null;
}

export interface EffectiveAccess {
  readonly isFree: boolean;
  readonly priceCoins: number;
}

export function effectiveFreeEpisodes(series: SeriesPricing, tenant?: TenantPricingOverride | null): number {
  return Math.max(0, tenant?.freeEpisodesOverride ?? series.freeEpisodes);
}

export function effectiveAccess(
  series: SeriesPricing,
  episode: EpisodePricing,
  tenant?: TenantPricingOverride | null,
): EffectiveAccess {
  const free = effectiveFreeEpisodes(series, tenant);
  if (episode.number <= free) return { isFree: true, priceCoins: 0 };
  const price = tenant?.episodePriceCoinsOverride ?? episode.priceCoinsOverride ?? series.episodePriceCoins;
  // Un prix nul fait de l'épisode un épisode gratuit (jamais de déblocage à 0 crédit).
  if (price <= 0) return { isFree: true, priceCoins: 0 };
  return { isFree: false, priceCoins: price };
}

/** Licence de diffusion (R-02) : couvre-t-elle ce pays à cet instant, pour cette marque ? */
export interface LicenseWindow {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly territories: readonly string[];
  readonly sublicensingAllowed: boolean;
}

export function isLicensed(
  licenses: readonly LicenseWindow[],
  countryCode: string,
  at: Date,
  isFirstParty: boolean,
): boolean {
  return licenses.some(
    (l) =>
      l.territories.includes(countryCode) &&
      at >= l.startsAt &&
      at < l.endsAt &&
      (isFirstParty || l.sublicensingAllowed),
  );
}

/** Slug d'URL : minuscules, sans accents, tirets. */
export function slugify(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

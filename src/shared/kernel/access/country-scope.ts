import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * BSG-12 — périmètre PAYS d'un utilisateur : « une personne du Sénégal ne
 * voit pas les entrepreneurs du Maroc, sauf si un SUPER_ADMIN le lui accorde ».
 *
 * Il vit dans le kernel pour la même raison que `application-scope.ts` :
 * candidatures, entretiens, pièces et vivier doivent appliquer la MÊME règle,
 * et aucun de ces modules n'a le droit d'importer les entrailles d'un autre.
 *
 * `null` = aucun filtre (tous les pays du tenant). Un tableau = liste blanche,
 * éventuellement VIDE (l'utilisateur ne voit alors aucune donnée pays).
 * Fermé par défaut : une donnée SANS pays n'est visible que sans restriction.
 */
export type CountryScope = readonly string[] | null;

export function countryScopeOf(user: Pick<AuthenticatedUser, 'countries'>): CountryScope {
  return user.countries ?? null;
}

export function canSeeCountry(scope: CountryScope, countryCode: string | null | undefined): boolean {
  if (scope === null) return true;
  return !!countryCode && scope.includes(countryCode);
}

/**
 * Filtre pays à appliquer à une recherche : le filtre DEMANDÉ, borné au
 * périmètre. Un utilisateur restreint qui demande un pays hors périmètre
 * obtient une liste vide — jamais le filtre ignoré, jamais une erreur qui
 * confirmerait que ce pays a des données.
 *
 * `undefined` = pas de filtre ; `[]` = rien ne doit sortir.
 */
export function restrictCountries(scope: CountryScope, requested?: readonly string[]): string[] | undefined {
  if (scope === null) return requested?.length ? [...requested] : undefined;
  if (!requested?.length) return [...scope];
  return requested.filter((code) => scope.includes(code));
}

/**
 * Périmètre effectif à sceller dans le jeton, calculé à l'émission.
 * SUPER_ADMIN et `allCountries` → tous ; sinon pays de rattachement + pays accordés.
 */
export function effectiveCountryScope(user: {
  readonly roles: readonly string[];
  readonly allCountries: boolean;
  readonly countryCode: string | null;
  readonly countryScope: readonly string[];
}): CountryScope {
  if (user.allCountries || user.roles.includes('SUPER_ADMIN')) return null;
  // `?? []` : colonne ajoutée par BSG-12, défensif pour un enregistrement partiel.
  return [...new Set([user.countryCode, ...(user.countryScope ?? [])].filter((c): c is string => !!c))].sort();
}

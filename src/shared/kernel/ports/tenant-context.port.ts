export const TENANT_CONTEXT = Symbol('TENANT_CONTEXT');

export interface TenantContextData {
  readonly tenantId: string;
  readonly slug: string;
  readonly isolation: 'SHARED_RLS' | 'SCHEMA';
  readonly schemaName?: string;
  readonly defaultLocale: string;
  readonly defaultCountry: string;
  readonly defaultCurrency: string;
  readonly timezone: string;
  /** Marque maison (D-13) : pas d'exigence de sous-licence pour diffuser une série. */
  readonly isFirstParty?: boolean;
  readonly featureFlags: Readonly<Record<string, boolean>>;
}

/**
 * Contexte de tenant porté par AsyncLocalStorage : accessible depuis
 * n'importe quelle couche sans le faire transiter en paramètre, et sans
 * l'anti-pattern du provider REQUEST-scoped (qui recrée tout l'arbre
 * d'injection à chaque requête et détruit les performances).
 */
export interface TenantContextPort {
  get(): TenantContextData;
  getOrNull(): TenantContextData | null;
  get tenantId(): string;
  runWith<T>(tenant: TenantContextData, fn: () => Promise<T>): Promise<T>;
  /** Exécution cross-tenant explicite, réservée aux jobs plateforme. */
  runPrivileged<T>(reason: string, fn: () => Promise<T>): Promise<T>;
  isPrivileged(): boolean;
}

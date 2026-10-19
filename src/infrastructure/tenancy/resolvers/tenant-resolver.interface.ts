import type { Request } from 'express';

export const TENANT_RESOLVERS = Symbol('TENANT_RESOLVERS');

/**
 * Open/Closed : ajouter un mode de résolution (clé d'API partenaire,
 * chemin /t/{slug}/…) = ajouter une classe, sans toucher au middleware.
 */
export interface TenantResolver {
  /** Nom déclaré dans TENANCY_RESOLVERS ; définit aussi l'ordre de priorité. */
  readonly name: string;
  resolve(request: Request): Promise<string | null> | string | null;
}

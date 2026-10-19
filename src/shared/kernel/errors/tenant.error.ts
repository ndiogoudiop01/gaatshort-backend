import { DomainError } from './domain.error';
import { ErrorCode } from './error-catalog';

/**
 * Erreurs de résolution du tenant. Elles vivent dans le kernel — et non dans
 * `src/infrastructure/tenancy` — parce que le traducteur HTTP central
 * (`AllExceptionsFilter`, couche partagée) doit les reconnaître sans dépendre
 * de l'infrastructure.
 */
export class MissingTenantContextError extends DomainError {
  public readonly code = ErrorCode.TENANT_NOT_RESOLVED;
  constructor() {
    super(
      'Contexte de tenant absent. La requête a échappé au TenantMiddleware, ' +
        'ou un job s’exécute hors de runWith()/runPrivileged().',
    );
  }
}

export class TenantNotFoundError extends DomainError {
  public readonly code = ErrorCode.TENANT_NOT_RESOLVED;
  constructor(hint: string) {
    super(`Aucun tenant ne correspond à « ${hint} »`, { hint });
  }
}

export class TenantSuspendedError extends DomainError {
  public readonly code = ErrorCode.TENANT_SUSPENDED;
  constructor(slug: string) {
    super(`Le tenant « ${slug} » est suspendu`, { slug });
  }
}

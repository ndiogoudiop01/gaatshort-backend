/**
 * Erreur métier. Le domaine ne connaît PAS HTTP : il lève une DomainError,
 * et le filtre d'exception fait la traduction en code HTTP.
 * `code` est un identifiant stable, contractuel avec le frontend.
 */
export abstract class DomainError extends Error {
  public abstract readonly code: string;
  public readonly details: Record<string, unknown>;

  protected constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.details = details;
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/** Une règle métier est violée → 422 */
export class BusinessRuleViolationError extends DomainError {
  public readonly code: string;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

/** La ressource n'existe pas dans le tenant courant → 404 */
export class ResourceNotFoundError extends DomainError {
  public readonly code = 'RESOURCE_NOT_FOUND';
  constructor(resource: string, identifier: string) {
    super(`${resource} introuvable : ${identifier}`, { resource, identifier });
  }
}

/** Transition d'état interdite par la machine à états → 409 */
export class InvalidStateTransitionError extends DomainError {
  public readonly code = 'INVALID_STATE_TRANSITION';
  constructor(aggregate: string, from: string, to: string, allowed: readonly string[]) {
    super(`Transition interdite sur ${aggregate} : ${from} → ${to}`, {
      aggregate,
      from,
      to,
      allowedTransitions: allowed,
    });
  }
}

/** Conflit de concurrence optimiste → 409 */
export class ConcurrencyError extends DomainError {
  public readonly code = 'CONCURRENCY_CONFLICT';
  constructor(aggregate: string, id: string) {
    super(`${aggregate} ${id} a été modifié entre-temps`, { aggregate, id });
  }
}

/** Accès refusé par une policy ABAC → 403 */
export class ForbiddenActionError extends DomainError {
  public readonly code = 'FORBIDDEN_ACTION';
  constructor(action: string, resource: string, reason?: string) {
    super(`Action « ${action} » refusée sur ${resource}`, { action, resource, reason });
  }
}

/** Fuite de tenant détectée → 404 exposé au client, ALERTE côté logs */
export class TenantMismatchError extends DomainError {
  public readonly code = 'TENANT_MISMATCH';
  constructor(resource: string, id: string) {
    super(`Ressource ${resource}#${id} hors du tenant courant`, { resource, id });
  }
}

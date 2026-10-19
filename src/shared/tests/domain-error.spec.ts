import {
  BusinessRuleViolationError,
  ConcurrencyError,
  ForbiddenActionError,
  InvalidStateTransitionError,
  ResourceNotFoundError,
  TenantMismatchError,
} from '@shared/kernel/errors/domain.error';

describe('Erreurs de domaine', () => {
  it('BusinessRuleViolationError porte un code personnalisé et des détails', () => {
    const error = new BusinessRuleViolationError('CODE_X', 'message', { foo: 'bar' });
    expect(error.code).toBe('CODE_X');
    expect(error.message).toBe('message');
    expect(error.details).toEqual({ foo: 'bar' });
    expect(error.name).toBe('BusinessRuleViolationError');
  });

  it('ResourceNotFoundError construit un message et des détails standards', () => {
    const error = new ResourceNotFoundError('Candidature', 'app-1');
    expect(error.code).toBe('RESOURCE_NOT_FOUND');
    expect(error.message).toContain('Candidature');
    expect(error.details).toEqual({ resource: 'Candidature', identifier: 'app-1' });
  });

  it('InvalidStateTransitionError liste les transitions permises', () => {
    const error = new InvalidStateTransitionError('Application', 'DRAFT', 'PRESELECTED', ['SUBMITTED']);
    expect(error.code).toBe('INVALID_STATE_TRANSITION');
    expect(error.details.allowedTransitions).toEqual(['SUBMITTED']);
  });

  it('ConcurrencyError identifie l’agrégat en conflit', () => {
    const error = new ConcurrencyError('Application', 'app-1');
    expect(error.code).toBe('CONCURRENCY_CONFLICT');
    expect(error.details).toEqual({ aggregate: 'Application', id: 'app-1' });
  });

  it('ForbiddenActionError décrit l’action et la ressource refusées', () => {
    const error = new ForbiddenActionError('update', 'Application', 'statut non modifiable');
    expect(error.code).toBe('FORBIDDEN_ACTION');
    expect(error.details.reason).toBe('statut non modifiable');
  });

  it('TenantMismatchError signale une ressource hors du tenant courant', () => {
    const error = new TenantMismatchError('Application', 'app-1');
    expect(error.code).toBe('TENANT_MISMATCH');
    expect(error.message).toContain('app-1');
  });

  it('toutes les erreurs de domaine sont de vraies instances Error', () => {
    const error = new ResourceNotFoundError('X', 'y');
    expect(error).toBeInstanceOf(Error);
    expect(error.stack).toBeDefined();
  });
});

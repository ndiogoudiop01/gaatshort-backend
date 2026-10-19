import {
  BadRequestException,
  ConflictException,
  type ArgumentsHost,
  HttpStatus,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  BusinessRuleViolationError,
  DomainError,
  ForbiddenActionError,
  InvalidStateTransitionError,
  ResourceNotFoundError,
  TenantMismatchError,
} from '@shared/kernel/errors/domain.error';
import { TenantNotFoundError } from '@shared/kernel/errors/tenant.error';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

interface ErrorPayload {
  success: boolean;
  error: { code: string; message: string; details?: Record<string, unknown> };
  requestId: string | null;
  timestamp: string;
}

function fakeHost() {
  const json = jest.fn((_body: ErrorPayload) => undefined);
  const status = jest.fn(() => ({ json }));
  const response = { status };
  const request = { url: '/x', method: 'GET', id: 'req-1' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('traduit une ressource introuvable en 404 générique', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new ResourceNotFoundError('Candidature', 'app-1'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }) }));
  });

  it('traduit un conflit de transition en 409 avec ses détails', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new InvalidStateTransitionError('Application', 'DRAFT', 'REJECTED', ['SUBMITTED']), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0].error.details?.allowedTransitions).toEqual(['SUBMITTED']);
  });

  it('traduit un refus d’accès en 403', () => {
    const { host, status } = fakeHost();
    filter.catch(new ForbiddenActionError('read', 'Application'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
  });

  it('traduit un tenant introuvable en 400', () => {
    const { host, status } = fakeHost();
    filter.catch(new TenantNotFoundError('inconnu'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('traduit une règle métier violée en 422', () => {
    const { host, status } = fakeHost();
    filter.catch(new BusinessRuleViolationError('X', 'message'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
  });

  it('traduit une HttpException standard en conservant son statut', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new BadRequestException('Requête invalide'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json.mock.calls[0][0].error.code).toBe('VALIDATION_FAILED');
  });

  it('retombe sur 500 pour une erreur totalement inattendue', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json.mock.calls[0][0].error.code).toBe('INTERNAL_ERROR');
  });

  it('inclut toujours l’identifiant de requête et un horodatage', () => {
    const { host, json } = fakeHost();
    filter.catch(new ResourceNotFoundError('X', 'y'), host);
    expect(json.mock.calls[0][0].requestId).toBe('req-1');
    expect(json.mock.calls[0][0].timestamp).toEqual(expect.any(String));
  });

  it('traduit une violation de contrainte unique Prisma (P2002) en conflit', () => {
    const { host, status, json } = fakeHost();
    const error = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '6.19.3',
      meta: { target: ['email'] },
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0].error.code).toBe('DUPLICATE_RESOURCE');
  });

  it('traduit un enregistrement Prisma introuvable (P2025) en 404', () => {
    const { host, status } = fakeHost();
    const error = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '6.19.3',
    });
    filter.catch(error, host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
  });

  it('remplace un message de validation multi-lignes par un message générique', () => {
    const { host, json } = fakeHost();
    filter.catch(new BadRequestException(['champ requis', 'format invalide']), host);
    expect(json.mock.calls[0][0].error.message).toBe('Requête invalide');
  });

  it('traduit une DomainError générique via son code propre', () => {
    class CustomDomainError extends DomainError {
      public readonly code = 'CUSTOM_ERROR';
      constructor() {
        super('erreur personnalisée');
      }
    }
    const { host, status, json } = fakeHost();
    filter.catch(new CustomDomainError(), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.UNPROCESSABLE_ENTITY);
    expect(json.mock.calls[0][0].error.code).toBe('CUSTOM_ERROR');
  });

  it('une ressource d’un autre tenant renvoie 404 générique, jamais 403', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new TenantMismatchError('Application', 'app-99'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    // On ne révèle PAS qu'il s'agissait d'un problème de tenant.
    expect(json.mock.calls[0][0].error.code).toBe('RESOURCE_NOT_FOUND');
    expect(status).not.toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
  });

  it('préserve un `code` explicite du catalogue passé à une HttpException', () => {
    const { host, status, json } = fakeHost();
    filter.catch(
      new ConflictException({
        code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
        message: 'Cette clé a déjà été utilisée avec un contenu différent',
      }),
      host,
    );
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    // Le code choisi par l'appelant fait foi — surtout pas INTERNAL_ERROR.
    expect(json.mock.calls[0][0].error.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
  });

  it('mappe une 409 sans code explicite sur CONCURRENCY_CONFLICT (pas INTERNAL_ERROR)', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new ConflictException('conflit'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json.mock.calls[0][0].error.code).toBe('CONCURRENCY_CONFLICT');
  });

  it('mappe une 503 sur UPSTREAM_UNAVAILABLE (dépendance externe, pas un bug interne)', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new ServiceUnavailableException(), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json.mock.calls[0][0].error.code).toBe('UPSTREAM_UNAVAILABLE');
  });

  it('range les messages de validation dans details.issues, pas dans message', () => {
    const { host, json } = fakeHost();
    filter.catch(new BadRequestException(['email invalide', 'firstName trop long']), host);
    const body = json.mock.calls[0][0];
    expect(body.error.message).toBe('Requête invalide');
    expect(body.error.details?.issues).toEqual(['email invalide', 'firstName trop long']);
  });
});

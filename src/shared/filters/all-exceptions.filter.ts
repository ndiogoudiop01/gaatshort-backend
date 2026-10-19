import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import {
  BusinessRuleViolationError,
  ConcurrencyError,
  DomainError,
  ForbiddenActionError,
  InvalidStateTransitionError,
  ResourceNotFoundError,
  TenantMismatchError,
} from '@shared/kernel/errors/domain.error';
import { ErrorCode } from '@shared/kernel/errors/error-catalog';
import {
  MissingTenantContextError,
  TenantNotFoundError,
  TenantSuspendedError,
} from '@shared/kernel/errors/tenant.error';

/**
 * Traducteur unique domaine → HTTP.
 * Le domaine ignore HTTP ; les contrôleurs ne font pas de try/catch ;
 * le format d'erreur est identique sur les 100 % des endpoints.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  /**
   * `isProduction` est passé explicitement (par `main.ts` et le provider
   * `APP_FILTER`) : ce filtre est instancié hors DI par `useGlobalFilters`,
   * et lire `process.env` ici violerait le confinement dans `src/config/`.
   */
  constructor(private readonly isProduction: boolean = false) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const { status, code, message, details } = this.translate(exception);

    if (status >= 500) {
      this.logger.error({
        msg: 'Erreur non gérée',
        path: request.url,
        method: request.method,
        requestId: request.id,
        err: exception,
      });
    } else {
      this.logger.debug({ msg: message, code, path: request.url, requestId: request.id });
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        // Aucun détail interne exposé en production sur une 5xx.
        details: status >= 500 && this.isProduction ? undefined : details,
      },
      requestId: request.id ?? null,
      timestamp: new Date().toISOString(),
    });
  }

  private translate(exception: unknown): {
    status: number;
    code: string;
    message: string;
    details?: Record<string, unknown>;
  } {
    if (exception instanceof ResourceNotFoundError || exception instanceof TenantMismatchError) {
      // Un tenant mismatch se présente comme un 404 : on ne confirme jamais
      // l'existence d'une ressource appartenant à un autre tenant.
      return { status: HttpStatus.NOT_FOUND, code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Ressource introuvable' };
    }
    if (exception instanceof InvalidStateTransitionError || exception instanceof ConcurrencyError) {
      return { status: HttpStatus.CONFLICT, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof ForbiddenActionError) {
      return { status: HttpStatus.FORBIDDEN, code: exception.code, message: exception.message, details: exception.details };
    }
    if (exception instanceof TenantNotFoundError || exception instanceof MissingTenantContextError) {
      return { status: HttpStatus.BAD_REQUEST, code: exception.code, message: exception.message };
    }
    if (exception instanceof TenantSuspendedError) {
      return { status: HttpStatus.FORBIDDEN, code: exception.code, message: exception.message };
    }
    if (exception instanceof BusinessRuleViolationError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof DomainError) {
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, code: exception.code, message: exception.message, details: exception.details };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          code: ErrorCode.DUPLICATE_RESOURCE,
          message: 'Cette ressource existe déjà',
          details: { fields: exception.meta?.target },
        };
      }
      if (exception.code === 'P2025') {
        return { status: HttpStatus.NOT_FOUND, code: ErrorCode.RESOURCE_NOT_FOUND, message: 'Ressource introuvable' };
      }
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const asObject =
        typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : undefined;

      // Un `code` explicite passé au constructeur — `new ConflictException({ code,
      // message })` — vient déjà du catalogue : il fait foi. Sinon on dérive du
      // statut HTTP. Objectif : jamais de `INTERNAL_ERROR` sur une 4xx maîtrisée.
      const explicitCode = typeof asObject?.code === 'string' ? asObject.code : undefined;

      // `ValidationPipe` renvoie un tableau de messages : texte libre, non
      // contractuel → il part dans `details.issues`, pas dans `message`.
      const messageValue = asObject?.message;
      const issues =
        Array.isArray(messageValue) && messageValue.every((m) => typeof m === 'string')
          ? (messageValue)
          : undefined;
      const message =
        typeof payload === 'string'
          ? payload
          : typeof messageValue === 'string'
            ? messageValue
            : exception.message;
      const explicitDetails =
        asObject && typeof asObject.details === 'object' && asObject.details !== null
          ? (asObject.details as Record<string, unknown>)
          : undefined;

      return {
        status,
        code: explicitCode ?? this.httpStatusToCode(status),
        message: issues ? 'Requête invalide' : message,
        details: issues ? { issues } : explicitDetails,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: 'Une erreur interne est survenue',
    };
  }

  private httpStatusToCode(status: number): string {
    switch (status) {
      case 400: return ErrorCode.VALIDATION_FAILED;
      case 401: return ErrorCode.UNAUTHENTICATED;
      case 403: return ErrorCode.FORBIDDEN_ACTION;
      case 404: return ErrorCode.RESOURCE_NOT_FOUND;
      case 409: return ErrorCode.CONCURRENCY_CONFLICT;
      case 413: return ErrorCode.FILE_TOO_LARGE;
      case 415: return ErrorCode.UNSUPPORTED_MEDIA_TYPE;
      case 422: return ErrorCode.VALIDATION_FAILED;
      case 429: return ErrorCode.RATE_LIMIT_EXCEEDED;
      case 502:
      case 503:
      case 504: return ErrorCode.UPSTREAM_UNAVAILABLE;
      default: return ErrorCode.INTERNAL_ERROR;
    }
  }
}

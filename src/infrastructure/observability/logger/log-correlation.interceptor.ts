import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { PinoLogger } from 'nestjs-pino';
import type { Observable } from 'rxjs';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';

/**
 * Attache `requestId` + `tenantId` + `userId` au logger de la requête.
 *
 * POURQUOI UN INTERCEPTOR ET PAS `customProps` ?
 * `customProps` (pino-http) s'exécute à la création du child logger, AVANT le
 * middleware tenant et les guards : `tenantId` et `userId` n'existent pas
 * encore. Ici on est APRÈS les guards — le tenant est résolu, `req.user` est
 * peuplé. `PinoLogger.assign()` écrit dans le contexte ALS du logger : toutes
 * les lignes émises ensuite pendant la requête (access-log ET logs des use
 * cases) portent les trois champs.
 *
 * Enregistré en TÊTE des `APP_INTERCEPTOR` pour que l'`assign` précède tout
 * autre log applicatif.
 */
@Injectable()
export class LogCorrelationInterceptor implements NestInterceptor {
  constructor(
    private readonly logger: PinoLogger,
    @Inject(TENANT_CONTEXT) private readonly tenantContext: TenantContextPort,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType?.();
    if (type && type !== 'http') return next.handle();

    const req = context.switchToHttp().getRequest<Request & { id?: string; user?: { id?: string } }>();
    this.logger.assign({
      requestId: req.id,
      tenantId: this.tenantContext.getOrNull()?.tenantId,
      userId: req.user?.id,
    });

    return next.handle();
  }
}

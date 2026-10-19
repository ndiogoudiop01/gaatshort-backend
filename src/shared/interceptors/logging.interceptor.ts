import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { tap, type Observable } from 'rxjs';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';

/**
 * Chaque ligne de log porte tenantId + requestId + userId.
 * Sans le tenantId, un incident en production devient impossible à
 * circonscrire : on ne sait pas quel client est impacté.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  constructor(@Inject(TENANT_CONTEXT) private readonly tenantContext: TenantContextPort) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType?.();
    if (type && type !== 'http') return next.handle();

    const request = context.switchToHttp().getRequest<Request & { id?: string; user?: { id: string } }>();
    // Sondes Kubernetes et scrape Prometheus : très fréquents, sans intérêt
    // pour le diagnostic → hors access-log.
    if (/^\/(api\/)?(health|metrics)\b/.test(request.url ?? '')) return next.handle();

    const startedAt = process.hrtime.bigint();

    return next.handle().pipe(
      tap({
        next: () => this.log(request, startedAt, 'ok'),
        error: (err: Error) => this.log(request, startedAt, 'error', err.name),
      }),
    );
  }

  private log(
    request: Request & { id?: string; user?: { id: string } },
    startedAt: bigint,
    outcome: string,
    errorName?: string,
  ): void {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // `Request.route` est typé `any` par @types/express : peuplé dynamiquement par le routeur.
    const routePath = (request.route as { path?: string } | undefined)?.path;
    this.logger.log({
      method: request.method,
      path: routePath ?? request.url,
      durationMs: Math.round(durationMs * 100) / 100,
      outcome,
      errorName,
      requestId: request.id,
      tenantId: this.tenantContext.getOrNull()?.tenantId,
      userId: request.user?.id,
    });
  }
}

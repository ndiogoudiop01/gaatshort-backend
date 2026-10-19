import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { tap, type Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Alimente `http_request_duration_seconds{method,route,status}`.
 *
 * DEUX RÈGLES DE CARDINALITÉ, non négociables :
 *  1. `route` est le PATRON de route (`/users/:id`), jamais l'URL réelle
 *     (`/users/6f3c…`) — sinon chaque identifiant crée une série temporelle
 *     et la mémoire de Prometheus explose.
 *  2. AUCUN label `tenant`. Avec 200 tenants × 80 routes × 6 statuts on
 *     obtient 96 000 séries pour une seule métrique. Le tenant vit dans les
 *     logs et les traces, où il est cherchable sans coût de stockage.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const type = context.getType?.();
    if (type && type !== 'http') return next.handle();

    const http = context.switchToHttp();
    const req = http.getRequest<Request>();
    const route = normalizeRoute(req);
    if (route === null) return next.handle(); // sondes / scrape : non mesurés

    const stopTimer = this.metrics.httpDuration.startTimer();
    const record = (status: number): void => {
      stopTimer({ method: req.method, route, status: String(status) });
    };

    return next.handle().pipe(
      tap({
        next: () => record(http.getResponse<Response>().statusCode),
        error: (err: { status?: number; statusCode?: number }) =>
          record(err?.status ?? err?.statusCode ?? 500),
      }),
    );
  }
}

/**
 * Patron de route stable, ou `null` pour les endpoints d'infra qu'on ne
 * veut pas mesurer (sondes Kubernetes, scrape Prometheus).
 */
function normalizeRoute(req: Request): string | null {
  // `Request.route` est typé `any` par @types/express (peuplé par le routeur).
  const routePath = (req.route as { path?: string } | undefined)?.path ?? '';
  const path = `${req.baseUrl ?? ''}${routePath}` || req.path || req.url || '';
  if (/^\/(api\/)?(health|metrics)\b/.test(path)) return null;
  // `req.route.path` est déjà paramétré (`/:id`). En dernier recours, on
  // remplace les segments qui ressemblent à des identifiants.
  return (
    path
      .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
      .replace(/\/\d+(?=\/|$)/g, '/:id') || 'unknown'
  );
}

import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { map, type Observable } from 'rxjs';
import { PaginatedResult } from '@shared/kernel/application/pagination';

export const RAW_RESPONSE_KEY = 'http:rawResponse';

/**
 * Un `PaginatedResult` qui a transité par le cache Redis revient en objet nu
 * (`JSON.parse`), sans son prototype : `instanceof` échoue alors sur un cache
 * hit et la liste se retrouve emballée dans `data` au lieu d'être `data`. On
 * reconnaît donc la forme, pas la classe. `hasMore` est le seul champ toujours
 * présent dans `meta` (cf. PaginatedResult) : il évite de confondre avec une
 * réponse métier qui aurait par hasard `items` + `meta`.
 */
function isPaginatedShape(
  payload: unknown,
): payload is { items: readonly unknown[]; meta: Record<string, unknown> } {
  if (payload instanceof PaginatedResult) return true;
  if (typeof payload !== 'object' || payload === null) return false;
  const candidate = payload as { items?: unknown; meta?: unknown };
  return (
    Array.isArray(candidate.items) &&
    typeof candidate.meta === 'object' &&
    candidate.meta !== null &&
    'hasMore' in candidate.meta
  );
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}

  public intercept(context: ExecutionContext, next: CallHandler<unknown>): Observable<unknown> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isRaw) return next.handle();

    const request = context.switchToHttp().getRequest<Request & { id?: string }>();

    return next.handle().pipe(
      map((payload) => {
        const body = isPaginatedShape(payload)
          ? { data: payload.items, meta: payload.meta }
          : { data: payload };
        return {
          success: true,
          ...body,
          requestId: request.id ?? null,
          timestamp: new Date().toISOString(),
        };
      }),
    );
  }
}

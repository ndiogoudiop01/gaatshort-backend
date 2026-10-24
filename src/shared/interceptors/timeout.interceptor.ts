import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { catchError, throwError, timeout, TimeoutError, type Observable } from 'rxjs';
import { REQUEST_TIMEOUT_KEY } from '../decorators/request-timeout.decorator';

/**
 * Une requête qui n'aboutit pas en 15 s ne doit pas monopoliser une
 * connexion Postgres et un socket : on coupe. Sans cela, un pic de latence
 * en aval sature le pool et fait tomber toute l'instance.
 *
 * Une route peut déclarer un délai plus long avec `@RequestTimeout(ms)` (import en lot).
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(
    private readonly ms = 15_000,
    private readonly reflector?: Reflector,
  ) {}

  public intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const override = this.reflector?.getAllAndOverride<number | undefined>(REQUEST_TIMEOUT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return next.handle().pipe(
      timeout(override ?? this.ms),
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof TimeoutError ? new RequestTimeoutException('Délai dépassé') : err,
        ),
      ),
    );
  }
}

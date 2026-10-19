import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { catchError, throwError, timeout, TimeoutError, type Observable } from 'rxjs';

/**
 * Une requête qui n'aboutit pas en 15 s ne doit pas monopoliser une
 * connexion Postgres et un socket : on coupe. Sans cela, un pic de latence
 * en aval sature le pool et fait tomber toute l'instance.
 */
@Injectable()
export class TimeoutInterceptor implements NestInterceptor {
  constructor(private readonly ms = 15_000) {}

  public intercept(_: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(this.ms),
      catchError((err: unknown) =>
        throwError(() =>
          err instanceof TimeoutError ? new RequestTimeoutException('Délai dépassé') : err,
        ),
      ),
    );
  }
}

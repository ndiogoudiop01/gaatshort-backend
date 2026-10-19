import {
  BadRequestException,
  type CallHandler,
  ConflictException,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { of, tap, type Observable } from 'rxjs';
import { IDEMPOTENT_KEY } from '@shared/decorators/idempotent.decorator';
import { ErrorCode } from '@shared/kernel/errors/error-catalog';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';

/**
 * Idempotence des créations.
 *
 * Scénario réel : un candidat sur mobile valide sa candidature, le réseau
 * lâche, l'app rejoue la requête. Sans clé d'idempotence : deux dossiers,
 * deux références, un back-office pollué. Avec : la seconde requête reçoit
 * la réponse de la première, à l'octet près.
 *
 * Le hash du corps est vérifié : réutiliser une clé avec un contenu
 * différent est une erreur du client, pas un rejeu.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  public async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const meta = this.reflector.getAllAndOverride<{ ttlSeconds: number }>(IDEMPOTENT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!meta) return next.handle();

    const request = context.switchToHttp().getRequest<Request>();
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8) {
      throw new BadRequestException({
        code: ErrorCode.VALIDATION_FAILED,
        message: "En-tête « Idempotency-Key » requis (8 caractères minimum)",
      });
    }

    const tenantId = this.tenantContext.tenantId;
    // `Request.route` est typé `any` par @types/express : peuplé dynamiquement par le routeur.
    const routePath = (request.route as { path?: string } | undefined)?.path;
    const endpoint = `${request.method} ${routePath ?? request.url}`;
    const requestHash = createHash('sha256').update(JSON.stringify(request.body ?? {})).digest('hex');

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { tenantId_key_endpoint: { tenantId, key, endpoint } },
    });

    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException({
          code: ErrorCode.IDEMPOTENCY_PAYLOAD_MISMATCH,
          message: 'Cette clé a déjà été utilisée avec un contenu différent',
        });
      }
      if (!existing.completedAt) {
        throw new ConflictException({
          code: ErrorCode.IDEMPOTENCY_IN_PROGRESS,
          message: 'Requête identique déjà en cours de traitement',
        });
      }
      return of(existing.responseBody);
    }

    const expiresAt = new Date(Date.now() + meta.ttlSeconds * 1000);
    await this.prisma.idempotencyKey.create({
      data: { tenantId, key, endpoint, requestHash, expiresAt },
    });

    return next.handle().pipe(
      tap({
        next: (body: unknown) => {
          void this.prisma.idempotencyKey
            .update({
              where: { tenantId_key_endpoint: { tenantId, key, endpoint } },
              data: { responseStatus: 201, responseBody: body as object, completedAt: new Date() },
            })
            .catch(() => undefined);
        },
        // En cas d'échec, la clé est libérée : le client peut réessayer.
        error: () => {
          void this.prisma.idempotencyKey
            .delete({ where: { tenantId_key_endpoint: { tenantId, key, endpoint } } })
            .catch(() => undefined);
        },
      }),
    );
  }
}

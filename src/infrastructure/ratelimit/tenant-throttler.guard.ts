import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';

/**
 * Limitation de débit cloisonnée par tenant PUIS par identité.
 *
 * Avec une clé purement IP, un opérateur mobile africain — où des milliers
 * d'abonnés sortent derrière une même IP NAT — verrait ses utilisateurs
 * s'entre-bloquer. On combine donc tenant + utilisateur (ou IP à défaut).
 *
 * Le constructeur doit lister explicitement les dépendances de `ThrottlerGuard`
 * (options, storage, reflector) : un `constructor(...args)` fait perdre à Nest
 * les métadonnées d'injection de la classe parente, et `super()` reçoit alors
 * `undefined` — `this.reflector` casse au premier appel.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    private readonly tenantContext: TenantContextService,
  ) {
    super(options, storageService, reflector);
  }

  protected override getTracker(req: Request & { user?: { id: string } }): Promise<string> {
    const tenant = this.tenantContext.getOrNull()?.tenantId ?? 'anon';
    const identity = req.user?.id ?? req.ip ?? 'unknown';
    return Promise.resolve(`${tenant}:${identity}`);
  }
}

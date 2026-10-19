import { Inject, Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { AppConfigService } from '@config/app-config.service';
import { TenantContextService } from '../context/tenant-context.service';
import { TenantRegistryService } from '../registry/tenant-registry.service';
import { TENANT_RESOLVERS, type TenantResolver } from '../resolvers/tenant-resolver.interface';
import { TenantNotFoundError } from '../tenancy.errors';

/**
 * Premier maillon de la chaîne : résout le tenant AVANT tout guard, tout
 * contrôleur, toute requête SQL. Tout ce qui suit s'exécute à l'intérieur
 * du contexte ALS ouvert ici.
 *
 * Détection de fuite : si le JWT porte un tenant et qu'un en-tête en réclame
 * un autre, on refuse et on journalise en `warn` — c'est le signal d'une
 * tentative de traversée de tenant.
 */
@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly logger = new Logger(TenantMiddleware.name);
  private readonly orderedResolvers: TenantResolver[];

  constructor(
    private readonly context: TenantContextService,
    private readonly registry: TenantRegistryService,
    private readonly config: AppConfigService,
    @Inject(TENANT_RESOLVERS) resolvers: TenantResolver[],
  ) {
    const order = this.config.tenancy.resolvers;
    this.orderedResolvers = order
      .map((name) => resolvers.find((r) => r.name === name))
      .filter((r): r is TenantResolver => Boolean(r));
  }

  public async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const candidates: { name: string; value: string }[] = [];
      for (const resolver of this.orderedResolvers) {
        const value = await resolver.resolve(req);
        if (value) candidates.push({ name: resolver.name, value });
      }

      const jwtCandidate = candidates.find((c) => c.name === 'jwt');
      const headerCandidate = candidates.find((c) => c.name === 'header');
      if (jwtCandidate && headerCandidate && headerCandidate.value !== jwtCandidate.value) {
        // Le JWT porte l'UUID du tenant, l'en-tête souvent son slug : deux
        // chaînes différentes peuvent désigner le même tenant. On compare
        // donc les tenants résolus, pas les valeurs brutes. Un en-tête qui
        // ne désigne aucun tenant reste un conflit.
        const [fromJwt, fromHeader] = await Promise.all([
          this.registry.resolve(jwtCandidate.value),
          this.registry.resolve(headerCandidate.value).catch(() => null),
        ]);
        if (fromHeader?.tenantId !== fromJwt.tenantId) {
          this.logger.warn(
            `Tentative de traversée de tenant : jwt=${jwtCandidate.value} header=${headerCandidate.value} ip=${req.ip}`,
          );
          throw new TenantNotFoundError(headerCandidate.value);
        }
      }

      let identifier = candidates[0]?.value ?? null;
      if (!identifier && this.config.tenancy.allowAnonymousFallback) {
        identifier = this.config.tenancy.defaultSlug;
      }
      if (!identifier) throw new TenantNotFoundError('aucun identifiant fourni');

      const tenant = await this.registry.resolve(identifier);
      res.setHeader('x-tenant', tenant.slug);

      await this.context.runWith(tenant, () => {
        next();
        return Promise.resolve();
      });
    } catch (error) {
      next(error);
    }
  }
}

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';

/**
 * Client Prisma brut. Il n'est JAMAIS injecté dans un repository métier :
 * seul TenantPrismaService y donne accès, via un client dérivé qui porte
 * l'isolation. Le cloisonnement est vérifié par dependency-cruiser
 * (`no-raw-prisma-in-modules`) : hors `src/infrastructure/` et du module
 * plateforme `tenancy/`, importer PrismaService fait échouer `pnpm depcruise`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly config: AppConfigService) {
    super({
      log: [
        { emit: 'event', level: 'query' },
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
      errorFormat: 'minimal',
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.$connect();

    const slowMs = this.config.database.slowQueryMs;
    // @ts-expect-error — les événements typés Prisma ne sont pas exposés sur la classe étendue
    this.$on('query', (e: Prisma.QueryEvent) => {
      if (e.duration >= slowMs) {
        this.logger.warn({ msg: 'Requête lente', durationMs: e.duration, query: e.query });
      } else if (this.config.database.logQueries) {
        this.logger.debug({ durationMs: e.duration, query: e.query });
      }
    });

    this.logger.log('Prisma connecté');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Échappatoire cross-tenant. Active `app.bypass_rls` le temps d'une
   * transaction. Réservé au relais outbox, aux purges RGPD et à l'annuaire
   * des tenants. Chaque appel doit être justifiable en revue.
   *
   * Le budget est EXPLICITE, avec les défauts de Prisma comme valeurs de repli
   * (`maxWait: 2000`, `timeout: 5000`). Un traitement cross-tenant qui scanne
   * toutes les lignes de tous les tenants dépasse facilement 5 s et se
   * termine alors en `P2028 Transaction already closed` — une erreur hors
   * catalogue, donc non traduite. Un tel appelant DOIT annoncer son budget
   * plutôt que découvrir la limite en production.
   */
  public async $privileged<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
        return fn(tx);
      },
      { maxWait: options?.maxWait ?? 2_000, timeout: options?.timeout ?? 5_000 },
    );
  }
}

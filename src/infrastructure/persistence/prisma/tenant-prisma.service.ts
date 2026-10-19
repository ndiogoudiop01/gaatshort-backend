import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { PrismaService } from './prisma.service';
import { TransactionHost } from './transaction-host.service';

/** Modèles hors périmètre tenant (référentiels globaux). */
const GLOBAL_MODELS = new Set(['Tenant', 'Country', 'Currency', 'Permission']);

const READ_OPERATIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]);

const WRITE_WITH_DATA = new Set(['create', 'createMany', 'upsert']);

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  LE POINT LE PLUS IMPORTANT DE CETTE ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Deux remparts, indépendants, contre la fuite de données entre tenants :
 *
 *  1. APPLICATIF — l'extension ci-dessous injecte `tenantId` dans le `where`
 *     de toute lecture et dans le `data` de toute écriture. Zéro coût réseau,
 *     et surtout : un développeur ne PEUT PAS oublier le filtre.
 *
 *  2. BASE DE DONNÉES — `set_config('app.current_tenant_id', …, TRUE)` est
 *     émis sur la même connexion, dans la même transaction que la requête.
 *     Les politiques RLS (prisma/sql/rls-policies.sql) s'appliquent donc même
 *     à du SQL brut ou à une requête que l'extension aurait laissé passer.
 *
 * Un seul rempart ne suffit pas : le premier tombe sur un `$queryRaw`, le
 * second tombe si quelqu'un connecte l'app avec un rôle BYPASSRLS. Les deux
 * ensemble tiennent.
 */
@Injectable()
export class TenantPrismaService {
  private readonly logger = new Logger(TenantPrismaService.name);
  private readonly clientCache = new Map<string, TenantClient>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly txHost: TransactionHost,
  ) {}

  /**
   * Client à utiliser dans TOUS les repositories.
   * Renvoie la transaction en cours si elle existe, sinon un client scopé.
   */
  public get client(): TenantClient {
    const tx = this.txHost.current;
    if (tx) return tx as unknown as TenantClient;
    return this.forTenant(this.tenantContext.tenantId);
  }

  /**
   * SQL brut exécuté AVEC le contexte tenant posé en base.
   *
   * Pourquoi ce détour plutôt qu'un `this.client.$queryRaw` direct — c'est le
   * piège le plus coûteux de cette couche :
   *  - l'extension tenant-scopée ci-dessus n'intercepte que les OPÉRATIONS DE
   *    MODÈLE (`findMany`, `create`…) ; `$queryRaw` et `$executeRaw` lui
   *    échappent totalement, aucun `set_config` n'est émis pour eux ;
   *  - la portée `TRUE` de `set_config` vaut `SET LOCAL` : la valeur meurt au
   *    COMMIT. Celle posée par une requête de modèle ne peut donc JAMAIS
   *    couvrir une requête brute ultérieure.
   *
   * Les politiques RLS étant fail-closed, un `$queryRaw` lancé hors
   * transaction sous le rôle applicatif `gaatshort_app` ne lève pas d'erreur :
   * il renvoie silencieusement ZÉRO ligne. Un bug invisible en revue.
   *
   * Ce helper donne aux lectures brutes la garantie que
   * `PrismaUnitOfWork.execute()` donne déjà aux écritures : une transaction
   * qui pose elle-même `app.current_tenant_id`. Formulation identique à
   * dessein (cf. prisma-unit-of-work.ts).
   *
   * Si une transaction est déjà ouverte, on la réutilise — le `set_config` y
   * est déjà posé, et Prisma n'imbrique pas les transactions. Même détection
   * que le getter `client` ci-dessus : `txHost.current`.
   */
  public async runRawInTenantScope<T>(
    run: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    const current = this.txHost.current;
    if (current) return run(current);

    const tenantId = this.tenantContext.tenantId;
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, TRUE)`;
        return this.txHost.run(tx, () => run(tx));
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  }

  public forTenant(tenantId: string): TenantClient {
    const cached = this.clientCache.get(tenantId);
    if (cached) return cached;

    const client = this.buildScopedClient(tenantId);
    // Le cache évite de reconstruire l'arbre d'extensions à chaque requête.
    // Borne haute : au-delà, on évince le plus ancien (LRU pauvre mais suffisant).
    if (this.clientCache.size > 500) {
      const oldest = this.clientCache.keys().next().value;
      if (oldest) this.clientCache.delete(oldest);
    }
    this.clientCache.set(tenantId, client);
    return client;
  }

  private buildScopedClient(tenantId: string): TenantClient {
    const base = this.prisma;
    const logger = this.logger;

    return base.$extends({
      name: `tenant-scope:${tenantId}`,
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            if (GLOBAL_MODELS.has(model)) {
              return query(args);
            }

            const scoped = injectTenantScope(
              args,
              operation,
              tenantId,
              model,
              logger,
            );

            // Rempart 2 : la variable de session doit être posée sur la MÊME
            // connexion. `$transaction([...])` garantit ce couplage.
            const [, result] = await base.$transaction([
              base.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, TRUE)`,
              query(scoped),
            ]);
            return result;
          },
        },
      },
    }) as unknown as TenantClient;
  }
}

/** Injecte `tenantId` dans les filtres et les données selon l'opération. */
function injectTenantScope(
  args: Record<string, unknown>,
  operation: string,
  tenantId: string,
  model: string,
  logger: Logger,
): Record<string, unknown> {
  const next = { ...args };

  if (READ_OPERATIONS.has(operation) || operation.startsWith('update') || operation.startsWith('delete')) {
    const where = (next.where ?? {}) as Record<string, unknown>;
    if (where.tenantId && where.tenantId !== tenantId) {
      // Ne jamais faire confiance à un tenantId venu du client.
      logger.warn(`tenantId incohérent ignoré sur ${model}.${operation}`);
    }
    next.where = { ...where, tenantId };
  }

  if (WRITE_WITH_DATA.has(operation)) {
    const data = next.data;
    if (Array.isArray(data)) {
      next.data = data.map((row) => ({ ...(row as object), tenantId }));
    } else if (data && typeof data === 'object') {
      next.data = { ...(data), tenantId };
    }
    if (operation === 'upsert') {
      // On estampille le `create`. On NE touche PAS au `where` : c'est une clé
      // unique de l'appelant (souvent composite, ex. `tenantId_slug`) — y
      // injecter `tenantId` produirait un sélecteur invalide. La RLS filtre
      // déjà le « find » au tenant courant ; sans correspondance, l'upsert
      // bascule en INSERT avec ce `create` correctement scopé.
      next.create = { ...((next.create ?? {})), tenantId };
    }
  }

  return next;
}

/**
 * Le client scopé expose la même surface que PrismaClient : le code métier
 * ne voit aucune différence, il hérite juste de l'isolation.
 */
export type TenantClient = Omit<
  PrismaService,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends' | '$privileged'
> &
  Prisma.TransactionClient;

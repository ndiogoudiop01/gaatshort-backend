import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Queue } from 'bullmq';
import { LOCK, type LockPort } from '@shared/kernel/ports/lock.port';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { MetricsService } from '@infra/observability/metrics/metrics.service';
import { DEFAULT_JOB_OPTIONS, QUEUES } from '@infra/queue/queue.constants';

const BATCH_SIZE = 200;
const MAX_ATTEMPTS = 10;
const LOCK_TTL_MS = 30_000;

/**
 * Relais outbox : lit les événements non publiés et les pousse sur BullMQ.
 *
 * — **Verrou distribué** (`outbox:relay`) : une seule instance draine à la fois,
 *   même avec 10 pods. C'est LA protection contre le double-relais.
 * — `FOR UPDATE SKIP LOCKED` : posé pour une future parallélisation. Aujourd'hui
 *   il ne protège rien de plus — les lignes sont lues dans une micro-transaction
 *   qui commite aussitôt, donc les verrous de ligne tombent avant la boucle
 *   `queue.add`. Le double-relais éventuel reste sans effet : `jobId = id outbox`
 *   → BullMQ dédoublonne, et `processed_at` est idempotent.
 * — **Privilégié** : le relais traverse tous les tenants, par nature.
 * — Les jauges `outbox_backlog` / `outbox_dead_letters` sont rafraîchies à
 *   CHAQUE passe, par CHAQUE pod, HORS du verrou : cf. docs/34-outbox.md
 *   pour les seuils d'alerte.
 */
@Injectable()
export class OutboxRelayJob {
  private readonly logger = new Logger(OutboxRelayJob.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUES.OUTBOX) private readonly queue: Queue,
    @Inject(LOCK) private readonly lock: LockPort,
    private readonly metrics: MetricsService,
  ) {}

  /**
   * Le rafraîchissement des jauges est dans un `finally` à dessein : il doit
   * avoir lieu même quand le verrou est déjà pris par un autre pod, et même
   * quand le drainage échoue — ce sont exactement les moments où le backlog
   * monte et où l'on a besoin de le voir.
   */
  @Cron(CronExpression.EVERY_5_SECONDS, { name: 'outbox-relay' })
  public async relay(): Promise<void> {
    try {
      await this.lock.withLock('outbox:relay', LOCK_TTL_MS, () => this.drain());
    } finally {
      await this.refreshBacklogMetrics();
    }
  }

  /** Draine un lot. Ne tourne que sous le verrou distribué. */
  private async drain(): Promise<void> {
    const messages = await this.prisma.$privileged((tx) =>
      tx.$queryRaw<
        {
          id: string;
          tenantId: string;
          aggregateId: string;
          aggregateType: string;
          eventName: string;
          payload: unknown;
          metadata: unknown;
          occurredAt: Date;
        }[]
      >`
        SELECT id, tenant_id as "tenantId", aggregate_id as "aggregateId",
               aggregate_type as "aggregateType", event_name as "eventName", payload, metadata,
               occurred_at as "occurredAt"
        FROM outbox_messages
        WHERE processed_at IS NULL AND attempts < ${MAX_ATTEMPTS}
        ORDER BY occurred_at ASC
        LIMIT ${BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      `,
    );

    if (messages.length === 0) return;

    const published: string[] = [];
    for (const message of messages) {
      try {
        // `data` reproduit la forme de DomainEvent attendue par les
        // listeners `@OnEvent()` (aggregateId, payload…) — cf.
        // OutboxDispatchProcessor, seul consommateur de cette file.
        await this.queue.add(
          message.eventName,
          {
            tenantId: message.tenantId,
            data: {
              aggregateId: message.aggregateId,
              aggregateType: message.aggregateType,
              payload: message.payload,
              metadata: message.metadata,
              // Relayée jusqu'au processor pour qu'il puisse écarter un
              // événement trop ancien (cf. `OUTBOX_MAX_EVENT_AGE_MS`) :
              // sans cette date, un backlog accumulé repart intégralement.
              occurredAt: message.occurredAt.toISOString(),
            },
          },
          { ...DEFAULT_JOB_OPTIONS, jobId: message.id }, // jobId = id outbox → dédoublonnage BullMQ
        );
        published.push(message.id);
      } catch (error) {
        await this.prisma.$privileged((tx) =>
          tx.outboxMessage.update({
            where: { id: message.id },
            data: {
              attempts: { increment: 1 },
              lastError: error instanceof Error ? error.message : String(error),
            },
          }),
        );
      }
    }

    if (published.length) {
      await this.prisma.$privileged((tx) =>
        tx.outboxMessage.updateMany({
          where: { id: { in: published } },
          data: { processedAt: new Date() },
        }),
      );
      this.logger.debug(`${published.length} événement(s) relayé(s)`);
    }
  }

  /**
   * `outbox_backlog` = en attente réessayable ; `outbox_dead_letters` = isolés.
   * Requête bornée, tourne sur chaque pod pour que Prometheus voie la même
   * valeur quel que soit le pod scrapé.
   *
   * L'échec est avalé et journalisé : une jauge qu'on n'a pas pu lire ne doit
   * jamais faire échouer le relais lui-même.
   */
  private async refreshBacklogMetrics(): Promise<void> {
    try {
      const [row] = await this.prisma.$privileged((tx) =>
        tx.$queryRaw<{ pending: bigint; dead: bigint }[]>`
          SELECT
            count(*) FILTER (WHERE attempts <  ${MAX_ATTEMPTS}) AS pending,
            count(*) FILTER (WHERE attempts >= ${MAX_ATTEMPTS}) AS dead
          FROM outbox_messages
          WHERE processed_at IS NULL
        `,
      );
      this.metrics.outboxBacklog.set(Number(row?.pending ?? 0));
      this.metrics.outboxDeadLetters.set(Number(row?.dead ?? 0));
    } catch (error) {
      this.logger.warn(
        `Rafraîchissement de outbox_backlog échoué : ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

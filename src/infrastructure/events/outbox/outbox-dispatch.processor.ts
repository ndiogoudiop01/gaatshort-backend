import { Processor } from '@nestjs/bullmq';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import { QUEUE_CONCURRENCY, QUEUES } from '@infra/queue/queue.constants';
import { BaseTenantProcessor } from '@infra/queue/processors/base.processor';
import { TenantAwareJobService, type TenantJobPayload } from '@infra/queue/tenant-aware-job.service';
import { RelayedDomainEvent } from './relayed-domain-event';

interface OutboxJobData {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  /** `outbox_messages.occurred_at`, relayé en ISO 8601 par `OutboxRelayJob`. */
  readonly occurredAt?: string;
}

/**
 * Âge au-delà duquel un événement relayé n'est plus réémis.
 *
 * C'est CE seuil qui empêche un backlog accumulé dans Redis de partir en
 * convocations à des entretiens déjà passés, en accusés de réception de
 * candidatures vieilles de plusieurs mois ou en admissions au vivier
 * rétroactives, le jour où un consommateur apparaît enfin sur cette file.
 * Un événement de domaine plus vieux que 24 h n'a plus de destinataire
 * pertinent : le rejouer nuit davantage que le perdre.
 */
const OUTBOX_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1_000;

/**
 * Dernier maillon du relais outbox : sans lui, `OutboxRelayJob` dépose
 * fidèlement chaque événement sur BullMQ mais RIEN ne le réémet jamais sur
 * l'`EventEmitter2` in-process — tous les `@OnEvent()` de l'application
 * (notifications, admission au vivier…) restent alors du code mort en
 * production, bien que chacun soit testé unitairement en isolation (le
 * test appelle le handler directement, sans jamais passer par ce chemin).
 *
 * Ce processor est le SEUL consommateur de la file `outbox` : il reconstruit
 * un événement (`RelayedDomainEvent`) fidèle à ce qu'un listener attend et
 * le réémet. `job.name` porte le nom d'événement (`OutboxRelayJob` l'a posé
 * ainsi), donc `emitAsync(job.name, …)` route vers le bon `@OnEvent()`.
 */
@Processor(QUEUES.OUTBOX, { concurrency: QUEUE_CONCURRENCY[QUEUES.OUTBOX] })
export class OutboxDispatchProcessor extends BaseTenantProcessor<OutboxJobData> {
  constructor(
    tenantJobs: TenantAwareJobService,
    private readonly emitter: EventEmitter2,
  ) {
    super(tenantJobs);
  }

  protected async handle(data: OutboxJobData, job: Job<TenantJobPayload<OutboxJobData>>): Promise<unknown> {
    if (!data || typeof data.aggregateId !== 'string') {
      // Job déposé par une version du relais antérieure à SIB-40 : la forme du
      // payload était `{ tenantId, data: payload, meta }`, sans `aggregateId`
      // ni `payload` imbriqué. On l'ignore explicitement plutôt que de le
      // laisser échouer 5 fois sur un `undefined` (`payload.userId` →
      // TypeError côté listener, `where: { applicationId: undefined }` →
      // erreur Prisma).
      this.logger.warn({ jobId: job.id, name: job.name, msg: 'Payload outbox hérité, ignoré' });
      return { skipped: 'LEGACY_PAYLOAD' };
    }

    const occurredAt = data.occurredAt ? new Date(data.occurredAt) : null;
    const ageMs =
      occurredAt && !Number.isNaN(occurredAt.getTime()) ? Date.now() - occurredAt.getTime() : null;
    if (ageMs !== null && ageMs > OUTBOX_MAX_EVENT_AGE_MS) {
      this.logger.warn({
        jobId: job.id,
        name: job.name,
        ageMs,
        msg: 'Événement outbox trop ancien, ignoré',
      });
      return { skipped: 'EVENT_TOO_OLD' };
    }

    const event = new RelayedDomainEvent(
      job.name,
      job.data.tenantId,
      data.aggregateId,
      data.aggregateType,
      data.payload,
      data.metadata,
      job.id ?? undefined,
      occurredAt && !Number.isNaN(occurredAt.getTime()) ? occurredAt : undefined,
    );
    await this.emitter.emitAsync(job.name, event);
    return { dispatched: job.name };
  }
}

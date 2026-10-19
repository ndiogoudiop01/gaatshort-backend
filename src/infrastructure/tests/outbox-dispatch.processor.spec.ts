import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { Job } from 'bullmq';
import type { TenantAwareJobService, TenantJobPayload } from '@infra/queue/tenant-aware-job.service';
import { OutboxDispatchProcessor } from '../events/outbox/outbox-dispatch.processor';
import type { RelayedDomainEvent } from '../events/outbox/relayed-domain-event';

interface JobData {
  readonly aggregateId: string;
  readonly aggregateType: string;
  readonly payload: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt?: string;
}

function callHandle(
  processor: OutboxDispatchProcessor,
  data: JobData,
  job: Partial<Job<TenantJobPayload<JobData>>>,
) {
  return (processor as unknown as { handle(d: JobData, j: typeof job): Promise<unknown> }).handle(data, job);
}

describe('OutboxDispatchProcessor', () => {
  it('réémet un événement relayé sur EventEmitter2, sous le nom du job', async () => {
    const emitAsync = jest.fn(async (_eventName: string, _event: RelayedDomainEvent) => []);
    const processor = new OutboxDispatchProcessor(
      {} as TenantAwareJobService,
      { emitAsync } as unknown as EventEmitter2,
    );

    const data: JobData = {
      aggregateId: 'app-1',
      aggregateType: 'Application',
      payload: { reference: 'IG-2026-000001' },
      metadata: { actorId: 'user-1' },
    };
    const result = await callHandle(processor, data, {
      name: 'application.submitted',
      data: { tenantId: 'tenant-1' } as TenantJobPayload<JobData>,
    });

    expect(emitAsync).toHaveBeenCalledTimes(1);
    const [eventName, event] = emitAsync.mock.calls[0];
    expect(eventName).toBe('application.submitted');
    expect(event.tenantId).toBe('tenant-1');
    expect(event.aggregateId).toBe('app-1');
    expect(event.aggregateType).toBe('Application');
    expect(event.payload()).toEqual({ reference: 'IG-2026-000001' });
    expect(result).toEqual({ dispatched: 'application.submitted' });
  });

  it('porte l’identifiant STABLE du message outbox et l’instant du fait (dédoublonnage côté consommateurs)', async () => {
    const emitAsync = jest.fn(async (_eventName: string, _event: RelayedDomainEvent) => []);
    const processor = new OutboxDispatchProcessor({} as TenantAwareJobService, { emitAsync } as unknown as EventEmitter2);
    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    await callHandle(
      processor,
      { aggregateId: 'app-1', aggregateType: 'Application', payload: {}, metadata: {}, occurredAt },
      { id: 'outbox-42', name: 'application.admitted', data: { tenantId: 'tenant-1' } as TenantJobPayload<JobData> },
    );
    const [, event] = emitAsync.mock.calls[0];
    expect(event.eventId).toBe('outbox-42');
    expect(event.occurredAt?.toISOString()).toBe(occurredAt);
  });

  it('reconstruit un événement exploitable par un listener existant (duck typing, pas instanceof)', async () => {
    const emitAsync = jest.fn(async (_eventName: string, _event: RelayedDomainEvent) => []);
    const processor = new OutboxDispatchProcessor(
      {} as TenantAwareJobService,
      { emitAsync } as unknown as EventEmitter2,
    );

    await callHandle(
      processor,
      { aggregateId: 'lead-1', aggregateType: 'PartnerLead', payload: { reference: 'FIN-2026-00001', contactName: 'Awa', contactEmail: 'awa@banque.example' }, metadata: {} },
      { name: 'partner.lead_submitted', data: { tenantId: 'tenant-1' } as TenantJobPayload<JobData> },
    );

    const [, event] = emitAsync.mock.calls[0];
    // Un listener réel appelle exactement ces membres — cf.
    // PartnerEventsListener.onLeadSubmitted().
    expect(event.payload()).toMatchObject({ contactEmail: 'awa@banque.example', contactName: 'Awa' });
    expect(event.aggregateId).toBe('lead-1');
  });

  it('ignore un payload hérité au lieu de le laisser échouer cinq fois', async () => {
    const emitAsync = jest.fn(async (_eventName: string, _event: RelayedDomainEvent) => []);
    const processor = new OutboxDispatchProcessor(
      {} as TenantAwareJobService,
      { emitAsync } as unknown as EventEmitter2,
    );

    // Forme déposée par le relais AVANT SIB-40 : `data` portait directement le
    // payload métier, sans `aggregateId` ni `payload` imbriqué.
    const legacy = { userId: 'user-1', reference: 'IG-2026-000001' } as unknown as JobData;
    const result = await callHandle(processor, legacy, {
      id: 'msg-legacy',
      name: 'application.submitted',
      data: { tenantId: 'tenant-1' } as TenantJobPayload<JobData>,
    });

    expect(result).toEqual({ skipped: 'LEGACY_PAYLOAD' });
    expect(emitAsync).not.toHaveBeenCalled();
  });

  it('ignore un événement trop ancien plutôt que de rejouer un backlog', async () => {
    const emitAsync = jest.fn(async (_eventName: string, _event: RelayedDomainEvent) => []);
    const processor = new OutboxDispatchProcessor(
      {} as TenantAwareJobService,
      { emitAsync } as unknown as EventEmitter2,
    );

    const result = await callHandle(
      processor,
      {
        aggregateId: 'itw-1',
        aggregateType: 'Interview',
        payload: {},
        metadata: {},
        occurredAt: new Date(Date.now() - 48 * 3_600_000).toISOString(),
      },
      {
        id: 'msg-old',
        name: 'interview.scheduled',
        data: { tenantId: 'tenant-1' } as TenantJobPayload<JobData>,
      },
    );

    // Sans cette garde, la file accumulée depuis des mois partirait en
    // convocations à des entretiens déjà passés.
    expect(result).toEqual({ skipped: 'EVENT_TOO_OLD' });
    expect(emitAsync).not.toHaveBeenCalled();
  });
});

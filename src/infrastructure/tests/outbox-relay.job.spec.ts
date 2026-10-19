import type { Queue } from 'bullmq';
import type { LockPort } from '@shared/kernel/ports/lock.port';
import type { MetricsService } from '@infra/observability/metrics/metrics.service';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { OutboxRelayJob } from '../events/outbox/outbox-relay.job';

const MESSAGE = {
  id: 'msg-1',
  tenantId: 'tenant-1',
  aggregateId: 'app-1',
  aggregateType: 'Application',
  eventName: 'application.submitted',
  payload: { reference: 'IG-2026-000001' },
  metadata: { actorId: 'user-1' },
  occurredAt: new Date('2026-09-17T08:00:00.000Z'),
};

const passThroughLock = (): LockPort => ({
  acquire: async () => null,
  withLock: (_k, _t, fn) => fn(),
});

const heldLock = (): LockPort => ({ acquire: async () => null, withLock: async () => null });

function fakeMetrics() {
  const outboxBacklog = { set: jest.fn() };
  const outboxDeadLetters = { set: jest.fn() };
  return { metrics: { outboxBacklog, outboxDeadLetters } as unknown as MetricsService, outboxBacklog, outboxDeadLetters };
}

/**
 * `prisma.$privileged(fn)` sert 2 requêtes : le SELECT du lot de drain, et le
 * `count(*)` de rafraîchissement de métrique. On distingue par la présence de
 * "count(" dans le SQL taggé.
 */
function fakePrisma(opts: {
  batch?: unknown[];
  add?: jest.Mock;
  update?: jest.Mock;
  updateMany?: jest.Mock;
  counts?: { pending: bigint; dead: bigint };
}): PrismaService {
  const counts = opts.counts ?? { pending: 3n, dead: 1n };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray) =>
      strings.join('').includes('count(') ? [counts] : (opts.batch ?? []),
    outboxMessage: {
      update: opts.update ?? jest.fn(async () => undefined),
      updateMany: opts.updateMany ?? jest.fn(async () => ({ count: 0 })),
    },
  };
  return { $privileged: async (fn: (t: unknown) => unknown) => fn(tx) } as unknown as PrismaService;
}

describe('OutboxRelayJob', () => {
  it('relaie vers BullMQ avec jobId = id outbox (dédoublonnage) et marque traité', async () => {
    const add = jest.fn(async () => undefined);
    const updateMany = jest.fn(async () => ({ count: 1 }));
    const { metrics } = fakeMetrics();
    const job = new OutboxRelayJob(
      fakePrisma({ batch: [MESSAGE], updateMany }),
      { add } as unknown as Queue,
      passThroughLock(),
      metrics,
    );

    await job.relay();

    // `aggregateId`/`aggregateType` doivent être relayés jusqu'à BullMQ :
    // sans eux, OutboxDispatchProcessor ne peut pas reconstruire un
    // événement fidèle à ce qu'attendent les listeners `@OnEvent()`.
    expect(add).toHaveBeenCalledWith(
      'application.submitted',
      expect.objectContaining({
        tenantId: 'tenant-1',
        data: expect.objectContaining({
          aggregateId: 'app-1',
          aggregateType: 'Application',
          payload: { reference: 'IG-2026-000001' },
          metadata: { actorId: 'user-1' },
          // Sans `occurredAt`, le processor ne peut pas écarter un événement
          // périmé et un backlog accumulé repart intégralement.
          occurredAt: '2026-09-17T08:00:00.000Z',
        }),
      }),
      expect.objectContaining({ jobId: 'msg-1' }),
    );
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['msg-1'] } }, data: { processedAt: expect.any(Date) } }),
    );
  });

  it('ne fait rien quand l’outbox est vide (mais rafraîchit quand même la métrique)', async () => {
    const add = jest.fn();
    const { metrics, outboxBacklog } = fakeMetrics();
    const job = new OutboxRelayJob(fakePrisma({ batch: [] }), { add } as unknown as Queue, passThroughLock(), metrics);

    await job.relay();

    expect(add).not.toHaveBeenCalled();
    expect(outboxBacklog.set).toHaveBeenCalled();
  });

  it('sur échec de publication : incrémente attempts + lastError, sans bloquer le lot', async () => {
    const update = jest.fn(async () => undefined);
    const add = jest.fn(async () => {
      throw new Error('queue indisponible');
    });
    const { metrics } = fakeMetrics();
    const job = new OutboxRelayJob(
      fakePrisma({ batch: [MESSAGE], update }),
      { add } as unknown as Queue,
      passThroughLock(),
      metrics,
    );

    await job.relay();

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'msg-1' },
        data: expect.objectContaining({ attempts: { increment: 1 }, lastError: 'queue indisponible' }),
      }),
    );
  });

  it('verrou détenu ailleurs : ne draine pas, mais expose quand même la métrique', async () => {
    const add = jest.fn();
    const { metrics, outboxBacklog, outboxDeadLetters } = fakeMetrics();
    const job = new OutboxRelayJob(
      fakePrisma({ add, counts: { pending: 12n, dead: 2n } }),
      { add } as unknown as Queue,
      heldLock(),
      metrics,
    );

    await job.relay();

    expect(add).not.toHaveBeenCalled();
    expect(outboxBacklog.set).toHaveBeenCalledWith(12);
    expect(outboxDeadLetters.set).toHaveBeenCalledWith(2);
  });

  it('expose outbox_backlog et outbox_dead_letters à chaque passe', async () => {
    const { metrics, outboxBacklog, outboxDeadLetters } = fakeMetrics();
    const job = new OutboxRelayJob(
      fakePrisma({ batch: [], counts: { pending: 7n, dead: 0n } }),
      { add: jest.fn() } as unknown as Queue,
      passThroughLock(),
      metrics,
    );

    await job.relay();

    expect(outboxBacklog.set).toHaveBeenCalledWith(7);
    expect(outboxDeadLetters.set).toHaveBeenCalledWith(0);
  });
});

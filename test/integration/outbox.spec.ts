import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import type { LockPort } from '@shared/kernel/ports/lock.port';
import type { MetricsService } from '@infra/observability/metrics/metrics.service';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import type { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import type { DomainEvent } from '@shared/kernel/domain/domain-event';
import { TransactionHost } from '@infra/persistence/prisma/transaction-host.service';
import { PrismaUnitOfWork } from '@infra/persistence/transaction/prisma-unit-of-work';
import { OutboxRelayJob } from '@infra/events/outbox/outbox-relay.job';
import { QUEUES } from '@infra/queue/queue.constants';
import { TenantTestContext } from '../utils/tenant-test-context';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Outbox transactionnel — contre un vrai Postgres.
 *
 *  Ce que les tests unitaires (Prisma mocké) ne peuvent PAS prouver :
 *   - un ROLLBACK n'écrit AUCUNE ligne dans `outbox_messages` (critère DoD) ;
 *   - le relais lit bien `FOR UPDATE SKIP LOCKED` et respecte `attempts < 10` ;
 *   - la métrique reflète le vrai backlog.
 * ═══════════════════════════════════════════════════════════════════════════
 */
const TENANT = randomUUID();

function fakeEvent(name: string): DomainEvent {
  return {
    tenantId: TENANT,
    aggregateType: 'Application',
    aggregateId: randomUUID(),
    eventName: name,
    eventId: randomUUID(),
    occurredAt: new Date(),
    metadata: {},
    payload: () => ({ ref: name }),
  };
}
const aggregateWith = (...events: DomainEvent[]) => ({ pullDomainEvents: () => events });

const passThroughLock: LockPort = {
  acquire: async () => null,
  withLock: (_key, _ttl, fn) => fn(),
};

describe('Outbox transactionnel (Postgres réel)', () => {
  const ctx = new TenantTestContext();
  let db: PrismaClient; // connexion propriétaire
  let uow: PrismaUnitOfWork;
  let txHost: TransactionHost;

  // Client "PrismaService-like" : ajoute `$privileged` (bypass RLS) sur un
  // PrismaClient nu — ce dont le relais a besoin.
  const asPrismaService = (client: PrismaClient): PrismaService =>
    Object.assign(client, {
      $privileged: (fn: (tx: unknown) => unknown) =>
        client.$transaction(async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
          return fn(tx);
        }),
    }) as unknown as PrismaService;

  const countOutbox = () =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return tx.outboxMessage.count();
    });

  const seedOutbox = (over: { attempts?: number; eventName?: string }) =>
    db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return tx.outboxMessage.create({
        data: {
          tenantId: TENANT,
          aggregateType: 'Application',
          aggregateId: randomUUID(),
          eventName: over.eventName ?? 'application.submitted',
          payload: {},
          attempts: over.attempts ?? 0,
        },
      });
    });

  beforeAll(async () => {
    const env = await ctx.start();
    db = new PrismaClient({ datasources: { db: { url: env.databaseUrl } } });
    txHost = new TransactionHost();
    uow = new PrismaUnitOfWork(
      asPrismaService(db),
      txHost,
      { tenantId: TENANT } as unknown as TenantContextService,
    );
  }, 180_000);

  afterEach(async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      await tx.outboxMessage.deleteMany({ where: { tenantId: TENANT } });
    });
  });

  afterAll(async () => {
    if (db) await db.$disconnect();
    await ctx.stop();
  });

  // ── Unit of Work ────────────────────────────────────────────────────────
  it('un ROLLBACK ne publie AUCUN événement (DoD)', async () => {
    await expect(
      uow.execute(async (c) => {
        c.collect(aggregateWith(fakeEvent('application.submitted')) as never);
        // écriture RÉELLE dans la même transaction, AVANT l'échec
        await (txHost.current as unknown as PrismaClient).$executeRaw`
          INSERT INTO outbox_messages (id, tenant_id, aggregate_type, aggregate_id, event_name, payload, occurred_at)
          VALUES (gen_random_uuid(), ${TENANT}::uuid, 'Manual', gen_random_uuid()::text, 'manual.write', '{}'::jsonb, NOW())`;
        throw new Error('la transaction métier échoue');
      }),
    ).rejects.toThrow('la transaction métier échoue');

    // ni la ligne insérée à la main, ni l'événement collecté : tout a rollback.
    expect(await countOutbox()).toBe(0);
  });

  it('un COMMIT insère l’événement dans la MÊME transaction', async () => {
    await uow.execute(async (c) => {
      c.collect(aggregateWith(fakeEvent('application.preselected')) as never);
      return 'ok';
    });

    expect(await countOutbox()).toBe(1);
    const [row] = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return tx.outboxMessage.findMany({ where: { tenantId: TENANT } });
    });
    expect(row.eventName).toBe('application.preselected');
    expect(row.processedAt).toBeNull();
  });

  it('execute() imbriqué : l’événement interne est bien inséré', async () => {
    await uow.execute(async (outer) => {
      outer.collect(aggregateWith(fakeEvent('outer.evt')) as never);
      await uow.execute(async (inner) => {
        inner.collect(aggregateWith(fakeEvent('inner.evt')) as never);
      });
    });

    expect(await countOutbox()).toBe(2);
  });

  // ── Relais ─────────────────────────────────────────────────────────────
  it('relaie le pending, isole les messages à attempts >= 10, expose les métriques', async () => {
    const pending = await seedOutbox({ attempts: 0, eventName: 'application.submitted' });
    const dead = await seedOutbox({ attempts: 10, eventName: 'application.rejected' });

    const add = jest.fn(async () => undefined);
    const backlogSet = jest.fn();
    const deadSet = jest.fn();
    const relay = new OutboxRelayJob(
      asPrismaService(db),
      { add } as unknown as Queue,
      passThroughLock,
      { outboxBacklog: { set: backlogSet }, outboxDeadLetters: { set: deadSet } } as unknown as MetricsService,
    );

    await relay.relay();

    // le message frais est publié, avec jobId déterministe = son id
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(
      'application.submitted',
      expect.objectContaining({ tenantId: TENANT }),
      expect.objectContaining({ jobId: pending.id }),
    );

    const rows = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE)`;
      return tx.outboxMessage.findMany({ where: { tenantId: TENANT } });
    });
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(byId[pending.id].processedAt).not.toBeNull(); // relayé
    expect(byId[dead.id].processedAt).toBeNull(); // isolé, jamais touché

    // métriques : plus rien en attente, 1 dead letter
    expect(backlogSet).toHaveBeenLastCalledWith(0);
    expect(deadSet).toHaveBeenLastCalledWith(1);
  });

  it('la file du relais est bien QUEUES.OUTBOX', () => {
    expect(QUEUES.OUTBOX).toBe('outbox');
  });
});

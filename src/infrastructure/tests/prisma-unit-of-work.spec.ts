import type { DomainEvent } from '@shared/kernel/domain/domain-event';
import type { PrismaService } from '../persistence/prisma/prisma.service';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import { TransactionHost } from '../persistence/prisma/transaction-host.service';
import { PrismaUnitOfWork } from '../persistence/transaction/prisma-unit-of-work';

function fakeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    tenantId: 'tenant-1',
    aggregateType: 'Application',
    aggregateId: 'app-1',
    eventName: 'application.submitted',
    eventId: 'event-1',
    occurredAt: new Date(),
    metadata: {},
    payload: () => ({ reference: 'IG-1' }),
    ...overrides,
  };
}

function fakeAggregate(events: DomainEvent[]) {
  return { pullDomainEvents: () => events };
}

describe('PrismaUnitOfWork', () => {
  it('réutilise la transaction en cours sans en ouvrir une nouvelle', async () => {
    const txHost = new TransactionHost();
    const $transaction = jest.fn();
    const uow = new PrismaUnitOfWork(
      { $transaction } as unknown as PrismaService,
      txHost,
      { tenantId: 'tenant-1' } as unknown as TenantContextService,
    );

    const currentTx = {} as never;
    await txHost.run(currentTx, async () => {
      const result = await uow.execute(async (ctx) => {
        ctx.collect(fakeAggregate([fakeEvent()]) as never);
        return 'done';
      });
      expect(result).toBe('done');
    });

    expect($transaction).not.toHaveBeenCalled();
  });

  it('ouvre une transaction, positionne le tenant et dépose les événements dans l’outbox', async () => {
    const createMany = jest.fn(async () => undefined);
    const executeRaw = jest.fn(() => Promise.resolve(undefined));
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: executeRaw, outboxMessage: { createMany } }),
    );
    const txHost = new TransactionHost();
    const uow = new PrismaUnitOfWork(
      { $transaction } as unknown as PrismaService,
      txHost,
      { tenantId: 'tenant-1' } as unknown as TenantContextService,
    );

    const result = await uow.execute(async (ctx) => {
      ctx.collect(fakeAggregate([fakeEvent()]) as never);
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(executeRaw).toHaveBeenCalledTimes(1);
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [expect.objectContaining({ eventName: 'application.submitted', tenantId: 'tenant-1' })],
      }),
    );
  });

  it('un execute() imbriqué partage le sink : ses événements finissent dans l’outbox', async () => {
    const createMany = jest.fn(async () => undefined);
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: () => Promise.resolve(undefined), outboxMessage: { createMany } }),
    );
    const uow = new PrismaUnitOfWork(
      { $transaction } as unknown as PrismaService,
      new TransactionHost(),
      { tenantId: 'tenant-1' } as unknown as TenantContextService,
    );

    await uow.execute(async (outer) => {
      outer.collect(fakeAggregate([fakeEvent({ eventName: 'outer.evt' })]) as never);
      // Imbrication : NE doit PAS rouvrir de transaction, et ses events doivent
      // remonter dans le même outbox.
      await uow.execute(async (inner) => {
        inner.collect(fakeAggregate([fakeEvent({ eventName: 'inner.evt', eventId: 'event-2' })]) as never);
      });
    });

    expect($transaction).toHaveBeenCalledTimes(1); // une seule transaction
    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: [
          expect.objectContaining({ eventName: 'outer.evt' }),
          expect.objectContaining({ eventName: 'inner.evt' }),
        ],
      }),
    );
  });

  it('n’écrit rien dans l’outbox quand aucun événement n’a été collecté', async () => {
    const createMany = jest.fn();
    const $transaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ $executeRaw: () => Promise.resolve(undefined), outboxMessage: { createMany } }),
    );
    const uow = new PrismaUnitOfWork(
      { $transaction } as unknown as PrismaService,
      new TransactionHost(),
      { tenantId: 'tenant-1' } as unknown as TenantContextService,
    );

    await uow.execute(async () => 'ok');

    expect(createMany).not.toHaveBeenCalled();
  });
});

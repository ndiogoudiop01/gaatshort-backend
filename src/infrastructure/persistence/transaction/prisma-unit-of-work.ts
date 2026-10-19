import { Injectable, Logger } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { AggregateRoot } from '@shared/kernel/domain/aggregate-root';
import type { DomainEvent } from '@shared/kernel/domain/domain-event';
import type { Identifier } from '@shared/kernel/domain/identifier';
import type { TransactionalContext, UnitOfWorkPort } from '@shared/kernel/ports/unit-of-work.port';
import { TenantContextService } from '@infra/tenancy/context/tenant-context.service';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { TransactionHost } from '@infra/persistence/prisma/transaction-host.service';

/**
 * Unit of Work + Outbox transactionnel.
 *
 * Le problème qu'il résout : « j'ai changé le statut de la candidature ET
 * envoyé l'e-mail ». Si l'e-mail part avant le commit et que le commit échoue,
 * le candidat reçoit une notification pour un état qui n'existe pas. Si on
 * commit puis qu'on publie et que le process meurt, l'événement est perdu.
 *
 * Solution : l'événement est INSÉRÉ dans `outbox_messages` dans la même
 * transaction que le changement d'état. Un relais (OutboxRelayJob) le publie
 * ensuite sur BullMQ, avec garantie « au moins une fois ». Les consommateurs
 * sont donc écrits idempotents — c'est la règle, pas une option.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWorkPort {
  private readonly logger = new Logger(PrismaUnitOfWork.name);

  /**
   * Sink d'événements de la transaction externe. Un `execute()` imbriqué le
   * réutilise au lieu d'en créer un jeté — sinon les événements collectés dans
   * l'imbrication ne seraient JAMAIS insérés dans l'outbox.
   */
  private readonly eventSink = new AsyncLocalStorage<DomainEvent[]>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly txHost: TransactionHost,
    private readonly tenantContext: TenantContextService,
  ) {}

  public async execute<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T> {
    // Transaction déjà ouverte : on réutilise (jamais de transaction imbriquée)
    // ET on partage le sink d'événements de l'`execute()` externe (fallback `[]`
    // seulement si la transaction vient d'ailleurs — cas qui n'existe pas
    // aujourd'hui, mais on ne veut pas ouvrir de transaction imbriquée).
    if (this.txHost.isInTransaction) {
      return work(this.buildContext(this.eventSink.getStore() ?? []));
    }

    const tenantId = this.tenantContext.tenantId;
    const collected: DomainEvent[] = [];

    return this.eventSink.run(collected, () =>
      this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenantId}::text, TRUE)`;

          const result = await this.txHost.run(tx, () => work(this.buildContext(collected)));

          if (collected.length > 0) {
            await tx.outboxMessage.createMany({
              data: collected.map((event) => ({
                tenantId: event.tenantId,
                aggregateType: event.aggregateType,
                aggregateId: event.aggregateId,
                eventName: event.eventName,
                payload: event.payload() as never,
                metadata: { ...event.metadata, eventId: event.eventId },
                occurredAt: event.occurredAt,
              })),
            });
            this.logger.debug(`${collected.length} événement(s) déposé(s) dans l'outbox`);
          }

          return result;
        },
        { timeout: 15_000, maxWait: 5_000, isolationLevel: 'ReadCommitted' },
      ),
    );
  }

  private buildContext(sink: DomainEvent[]): TransactionalContext {
    return {
      collect: (aggregate: AggregateRoot<Identifier<string>>) => {
        sink.push(...aggregate.pullDomainEvents());
      },
    };
  }
}

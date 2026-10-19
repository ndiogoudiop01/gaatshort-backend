import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent } from '@shared/kernel/domain/domain-event';
import type { EventBusPort } from '@shared/kernel/ports/event-bus.port';

/**
 * Bus in-process pour les réactions SYNCHRONES qui doivent rester dans la
 * transaction (invalidation de cache, projection immédiate).
 *
 * Tout ce qui est lent, faillible ou externe (e-mail, SMS, appel tiers)
 * passe par l'outbox → BullMQ. Ne jamais envoyer un e-mail depuis un
 * listener synchrone : la transaction n'est pas encore committée.
 */
@Injectable()
export class DomainEventBus implements EventBusPort {
  constructor(private readonly emitter: EventEmitter2) {}

  public async publish(event: DomainEvent): Promise<void> {
    await this.emitter.emitAsync(event.eventName, event);
  }

  public async publishAll(events: readonly DomainEvent[]): Promise<void> {
    for (const event of events) await this.publish(event);
  }
}

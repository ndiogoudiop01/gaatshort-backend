import type { DomainEvent } from '../domain/domain-event';

export const EVENT_BUS = Symbol('EVENT_BUS');

export interface EventBusPort {
  publish(event: DomainEvent): Promise<void>;
  publishAll(events: readonly DomainEvent[]): Promise<void>;
}

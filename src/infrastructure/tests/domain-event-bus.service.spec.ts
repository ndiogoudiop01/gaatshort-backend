import type { EventEmitter2 } from '@nestjs/event-emitter';
import type { DomainEvent } from '@shared/kernel/domain/domain-event';
import { DomainEventBus } from '../events/domain-event-bus.service';

function fakeEvent(eventName: string): DomainEvent {
  return { eventName } as unknown as DomainEvent;
}

describe('DomainEventBus', () => {
  it('publie un événement sur son nom via emitAsync', async () => {
    const emitAsync = jest.fn(async () => []);
    const bus = new DomainEventBus({ emitAsync } as unknown as EventEmitter2);

    await bus.publish(fakeEvent('application.submitted'));

    expect(emitAsync).toHaveBeenCalledWith('application.submitted', expect.anything());
  });

  it('publie plusieurs événements dans l’ordre', async () => {
    const order: string[] = [];
    const emitAsync = jest.fn(async (name: string) => {
      order.push(name);
      return [];
    });
    const bus = new DomainEventBus({ emitAsync } as unknown as EventEmitter2);

    await bus.publishAll([fakeEvent('a'), fakeEvent('b')]);

    expect(order).toEqual(['a', 'b']);
  });
});

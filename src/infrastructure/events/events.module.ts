import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { EVENT_BUS } from '@shared/kernel/ports/event-bus.port';
import { DomainEventBus } from './domain-event-bus.service';
import { OutboxRelayJob } from './outbox/outbox-relay.job';
import { OutboxDispatchProcessor } from './outbox/outbox-dispatch.processor';

@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: true, delimiter: '.', maxListeners: 50 })],
  providers: [
    DomainEventBus,
    { provide: EVENT_BUS, useExisting: DomainEventBus },
    OutboxRelayJob,
    // TODO(dette technique) — ce provider démarre AUSSI dans le process API.
    // `EventsModule` est `@Global` et importé par `app.module.ts` comme par
    // `worker.module.ts` : chaque pod API ouvre donc un worker BullMQ sur la
    // file `outbox` et exécute e-mails, admissions au vivier et scoring dans
    // la boucle d'événements de l'API — l'inverse de ce que promet le
    // docblock de `src/worker.module.ts` (« l'API scale sur la latence p95,
    // les workers sur la profondeur des files »). Travers pré-existant,
    // partagé par d'autres processors ; le corriger proprement demande un
    // `EventsModule.forWorker()` qui n'enregistre les processors que dans le
    // contexte worker.
    OutboxDispatchProcessor,
  ],
  exports: [EVENT_BUS, DomainEventBus],
})
export class EventsModule {}

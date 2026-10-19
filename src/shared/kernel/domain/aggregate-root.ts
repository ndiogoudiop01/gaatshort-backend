import type { DomainEvent } from './domain-event';
import { Entity } from './entity';
import type { Identifier } from './identifier';

/**
 * Racine d'agrégat : frontière de cohérence transactionnelle.
 * Les événements sont accumulés puis vidés par l'Unit of Work, qui les écrit
 * dans l'outbox DANS la même transaction que l'état. Aucun `emit()` sauvage.
 */
export abstract class AggregateRoot<TId extends Identifier<string>> extends Entity<TId> {
  private _domainEvents: DomainEvent[] = [];

  public get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  protected record(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  public pullDomainEvents(): DomainEvent[] {
    const events = this._domainEvents;
    this._domainEvents = [];
    return events;
  }
}

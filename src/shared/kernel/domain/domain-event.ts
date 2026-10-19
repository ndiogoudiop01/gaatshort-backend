import { randomUUID } from 'node:crypto';

export interface DomainEventMetadata {
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly actorId?: string;
}

/**
 * Événement de domaine : un fait métier accompli, nommé au passé.
 * Il transporte le tenantId car les consommateurs (workers) s'exécutent
 * hors du contexte HTTP et doivent restaurer l'isolation eux-mêmes.
 */
export abstract class DomainEvent {
  public readonly eventId: string = randomUUID();
  public readonly occurredAt: Date = new Date();

  protected constructor(
    public readonly tenantId: string,
    public readonly aggregateId: string,
    public readonly metadata: DomainEventMetadata = {},
  ) {}

  /** Nom stable utilisé comme clé de routage — ne jamais renommer sans migration. */
  public abstract get eventName(): string;
  public abstract get aggregateType(): string;
  public abstract payload(): Record<string, unknown>;
}

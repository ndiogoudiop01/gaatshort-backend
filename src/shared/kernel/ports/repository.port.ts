import type { AggregateRoot } from '../domain/aggregate-root';
import type { Identifier } from '../domain/identifier';

/**
 * Contrat minimal d'un dépôt côté écriture. Les lectures complexes
 * (CRM, dashboards) ne passent PAS par là : elles ont leurs propres
 * read-models optimisés — cf. docs/adr/0004-cqrs-lite.md.
 */
export interface WriteRepository<TAggregate extends AggregateRoot<TId>, TId extends Identifier<string>> {
  findById(id: TId): Promise<TAggregate | null>;
  save(aggregate: TAggregate): Promise<void>;
  exists(id: TId): Promise<boolean>;
}

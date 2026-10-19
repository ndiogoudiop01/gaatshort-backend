import type { AggregateRoot } from '../domain/aggregate-root';
import type { Identifier } from '../domain/identifier';

export const UNIT_OF_WORK = Symbol('UNIT_OF_WORK');

export interface TransactionalContext {
  /**
   * Enrôle les événements d'un agrégat : ils seront écrits dans l'outbox
   * à l'intérieur de la transaction en cours.
   */
  collect(aggregate: AggregateRoot<Identifier<string>>): void;
}

/**
 * Une transaction = une frontière de cohérence + une publication d'événements
 * atomique (outbox). Le cas d'usage ne pilote jamais Prisma directement.
 */
export interface UnitOfWorkPort {
  execute<T>(work: (ctx: TransactionalContext) => Promise<T>): Promise<T>;
}

import type { Identifier } from './identifier';

export abstract class Entity<TId extends Identifier<string>> {
  protected constructor(public readonly id: TId) {}

  public equals(other?: Entity<TId>): boolean {
    if (!other) return false;
    if (this === other) return true;
    return this.id.equals(other.id);
  }
}

import { randomUUID } from 'node:crypto';

/**
 * Identifiant typé : `ApplicationId` n'est pas assignable à `UserId`,
 * même si les deux sont des UUID. Le compilateur attrape l'inversion
 * d'arguments que les tests n'attrapent jamais.
 */
export abstract class Identifier<T extends string> {
  protected constructor(public readonly value: string) {
    if (!Identifier.isUuid(value)) {
      throw new Error(`Identifiant invalide pour ${this.constructor.name}: ${value}`);
    }
  }

  public static isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  public static generate(): string {
    return randomUUID();
  }

  public equals(other?: Identifier<T>): boolean {
    return other instanceof Identifier && other.value === this.value;
  }

  public toString(): string {
    return this.value;
  }

  public toJSON(): string {
    return this.value;
  }
}

/**
 * Value Object : immuable, sans identité, comparé par valeur.
 * Toute règle de validation d'une donnée métier vit ici, pas dans un DTO.
 */
export abstract class ValueObject<T extends Record<string, unknown>> {
  protected constructor(protected readonly props: Readonly<T>) {
    Object.freeze(this.props);
  }

  public equals(other?: ValueObject<T>): boolean {
    if (other === null || other === undefined) return false;
    if (other.constructor !== this.constructor) return false;
    return JSON.stringify(this.props) === JSON.stringify(other.props);
  }
}

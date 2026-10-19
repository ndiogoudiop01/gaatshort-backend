export const ID_GENERATOR = Symbol('ID_GENERATOR');

export interface IdGeneratorPort {
  uuid(): string;
  /** Référence métier lisible et séquentielle par tenant : IG-2026-000142 */
  reference(prefix: string, tenantId: string): Promise<string>;
}

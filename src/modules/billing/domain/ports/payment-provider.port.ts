export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutRequest {
  readonly reference: string;
  readonly amountMinor: number;
  readonly currencyCode: string;
  readonly itemName: string;
  readonly ipnUrl: string;
  readonly successUrl: string;
  readonly cancelUrl: string;
}

export interface VerifiedNotification {
  /** Signature (ou authenticité) vérifiée ; sinon rien n'est crédité. */
  readonly valid: boolean;
  readonly reference: string | null;
  readonly outcome: 'PAID' | 'CANCELLED' | 'UNKNOWN';
  readonly amountMinor: number | null;
  readonly currencyCode: string | null;
  readonly paymentMethod: string | null;
  readonly eventType: string | null;
  /** Clé de déduplication : la même notification rejouée est ignorée. */
  readonly dedupeKey: string;
  /** Charge utile à conserver, expurgée de tout secret. */
  readonly safePayload: Record<string, unknown>;
}

export interface PaymentProviderPort {
  readonly name: 'PAYTECH' | 'FAKE';
  createCheckout(req: CheckoutRequest): Promise<{ token: string; redirectUrl: string }>;
  verifyNotification(body: Record<string, unknown>): VerifiedNotification;
  /** Pilote factice uniquement : signe une notification simulée. */
  signSimulation?(reference: string, outcome: 'PAID' | 'CANCELLED', amountMinor: number): string;
  /**
   * Pilote factice uniquement : adresse de retour après la page simulée, lue dans la requête
   * de la page et VÉRIFIÉE (signée à la création) — jamais une redirection ouverte.
   */
  simulatedReturnUrl?(reference: string, outcome: 'PAID' | 'CANCELLED', query: Record<string, unknown>): string | null;
}

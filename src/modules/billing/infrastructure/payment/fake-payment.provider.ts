import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type {
  CheckoutRequest, PaymentProviderPort, VerifiedNotification,
} from '../../domain/ports/payment-provider.port';

/**
 * Fournisseur factice (développement et tests) : la page de paiement est servie
 * par l'API elle-même (`GET /billing/fake-checkout/:reference`) et sa
 * « notification » suit EXACTEMENT le même chemin qu'un IPN réel, signature
 * comprise (HMAC avec le secret JWT de l'environnement). Interdit en production.
 */
@Injectable()
export class FakePaymentProvider implements PaymentProviderPort {
  public readonly name = 'FAKE' as const;

  constructor(private readonly config: AppConfigService) {}

  public createCheckout(req: CheckoutRequest): Promise<{ token: string; redirectUrl: string }> {
    const base = `${this.config.app.publicUrl.replace(/\/$/, '')}/${this.config.app.globalPrefix}/v1`;
    return Promise.resolve({
      token: `fake-${randomUUID()}`,
      redirectUrl: `${base}/billing/fake-checkout/${encodeURIComponent(req.reference)}`,
    });
  }

  public signSimulation(reference: string, outcome: 'PAID' | 'CANCELLED', amountMinor: number): string {
    return this.sign(reference, outcome, amountMinor);
  }

  private sign(reference: string, outcome: string, amountMinor: number): string {
    return createHmac('sha256', this.config.auth.accessSecret).update(`${reference}|${outcome}|${amountMinor}`).digest('hex');
  }

  public verifyNotification(body: Record<string, unknown>): VerifiedNotification {
    const reference = typeof body.reference === 'string' ? body.reference : null;
    const outcome = body.outcome === 'PAID' || body.outcome === 'CANCELLED' ? body.outcome : 'UNKNOWN';
    const amount = typeof body.amountMinor === 'number' ? body.amountMinor : Number(body.amountMinor);
    const signature = typeof body.signature === 'string' ? body.signature : '';
    const expected = reference ? this.sign(reference, outcome, amount) : '';
    const valid =
      !!reference && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    return {
      valid,
      reference,
      outcome,
      amountMinor: Number.isFinite(amount) ? amount : null,
      currencyCode: typeof body.currencyCode === 'string' ? body.currencyCode : 'XOF',
      paymentMethod: 'FAKE',
      eventType: `fake.${outcome.toLowerCase()}`,
      dedupeKey: createHash('sha256').update(`${reference}|${outcome}`).digest('hex'),
      safePayload: { reference, outcome, amountMinor: amount },
    };
  }
}

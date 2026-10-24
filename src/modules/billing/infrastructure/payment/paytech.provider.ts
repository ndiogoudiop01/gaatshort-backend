import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type {
  CheckoutRequest, PaymentProviderPort, VerifiedNotification,
} from '../../domain/ports/payment-provider.port';

const PAYTECH_API = 'https://paytech.sn/api';

/**
 * Adaptateur PayTech (docs : https://docs.intech.sn/doc_paytech.php).
 *
 * Authenticité de l'IPN — deux méthodes documentées, on exige l'une OU l'autre :
 *  1. `hmac_compute` = HMAC-SHA256(`${montant}|${ref_command}|${api_key}`, api_secret)
 *     (recommandée ; la doc hésite entre `item_price` et `final_item_price` : on
 *     accepte les deux, le montant comparé à la commande restant `item_price`) ;
 *  2. `api_key_sha256` / `api_secret_sha256` = sha256 de nos clés.
 * Puis le montant et la devise doivent égaler ceux de la commande (contrôle fait
 * par PaymentNotificationService). À valider en staging avec un vrai paiement.
 */
@Injectable()
export class PaytechProvider implements PaymentProviderPort {
  public readonly name = 'PAYTECH' as const;
  private readonly logger = new Logger(PaytechProvider.name);

  constructor(private readonly config: AppConfigService) {}

  private get cfg() {
    return this.config.payment.paytech;
  }

  public async createCheckout(req: CheckoutRequest): Promise<{ token: string; redirectUrl: string }> {
    const res = await fetch(`${PAYTECH_API}/payment/request-payment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        API_KEY: this.cfg.apiKey,
        API_SECRET: this.cfg.apiSecret,
      },
      body: JSON.stringify({
        item_name: req.itemName,
        item_price: req.amountMinor,
        currency: req.currencyCode,
        ref_command: req.reference,
        command_name: req.itemName,
        env: this.cfg.env,
        ipn_url: req.ipnUrl,
        success_url: req.successUrl,
        cancel_url: req.cancelUrl,
        custom_field: JSON.stringify({ reference: req.reference }),
      }),
      signal: AbortSignal.timeout(15_000),
    }).catch((error: unknown) => {
      this.logger.error(`PayTech injoignable : ${String(error)}`);
      throw new ServiceUnavailableException({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paiement momentanément indisponible' });
    });
    const data = (await res.json().catch(() => ({}))) as {
      success?: number; token?: string; redirect_url?: string; redirectUrl?: string; errors?: unknown;
    };
    const redirectUrl = data.redirect_url ?? data.redirectUrl;
    if (!res.ok || data.success !== 1 || !data.token || !redirectUrl) {
      this.logger.error(`PayTech request-payment refusé (${res.status}) : ${JSON.stringify(data.errors ?? data)}`);
      throw new ServiceUnavailableException({ code: 'UPSTREAM_UNAVAILABLE', message: 'Paiement momentanément indisponible' });
    }
    return { token: data.token, redirectUrl };
  }

  public verifyNotification(body: Record<string, unknown>): VerifiedNotification {
    const str = (k: string): string | null => {
      const v = body[k];
      if (typeof v === 'string') return v;
      if (typeof v === 'number' || typeof v === 'boolean') return String(v);
      return null;
    };
    const reference = str('ref_command');
    const itemPrice = str('item_price');
    const finalPrice = str('final_item_price');
    const hmacSent = str('hmac_compute');
    let valid = false;
    if (hmacSent && reference) {
      valid = [itemPrice, finalPrice]
        .filter((p): p is string => !!p)
        .some((price) => safeEqualHex(hmacSent, hmac(`${price}|${reference}|${this.cfg.apiKey}`, this.cfg.apiSecret)));
    } else {
      valid =
        safeEqualHex(str('api_key_sha256') ?? '', sha256(this.cfg.apiKey)) &&
        safeEqualHex(str('api_secret_sha256') ?? '', sha256(this.cfg.apiSecret));
    }
    const type = str('type_event');
    const amount = itemPrice != null && /^\d+(\.0+)?$/.test(itemPrice) ? Math.round(Number(itemPrice)) : null;
    // Champs conservés : jamais les empreintes de nos clés.
    const { api_key_sha256: _k, api_secret_sha256: _s, hmac_compute: _h, ...safePayload } = body;
    return {
      valid,
      reference,
      outcome: type === 'sale_complete' ? 'PAID' : type === 'sale_canceled' ? 'CANCELLED' : 'UNKNOWN',
      amountMinor: amount,
      currencyCode: (str('currency') ?? str('devise') ?? 'XOF').toUpperCase(),
      paymentMethod: str('payment_method'),
      eventType: type,
      dedupeKey: createHash('sha256').update(`${type}|${reference}|${str('token') ?? ''}`).digest('hex'),
      safePayload,
    };
  }
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const hmac = (msg: string, key: string) => createHmac('sha256', key).update(msg).digest('hex');

function safeEqualHex(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

import { createHash, createHmac } from 'node:crypto';
import type { AppConfigService } from '@config/app-config.service';
import { PaytechProvider } from '../infrastructure/payment/paytech.provider';
import { FakePaymentProvider } from '../infrastructure/payment/fake-payment.provider';

const CONFIG = {
  app: { publicUrl: 'http://api.test/', globalPrefix: 'api' },
  auth: { accessSecret: 'x'.repeat(32) },
  payment: { paytech: { apiKey: 'pk', apiSecret: 'sk', env: 'test' } },
} as unknown as AppConfigService;

const hmac = (msg: string) => createHmac('sha256', 'sk').update(msg).digest('hex');
const sha = (v: string) => createHash('sha256').update(v).digest('hex');

describe('PaytechProvider — authenticité de l’IPN', () => {
  const p = new PaytechProvider(CONFIG);
  const base = { type_event: 'sale_complete', ref_command: 'GS-AAA', item_price: '1000', token: 'tok', payment_method: 'Wave' };

  it('accepte un hmac_compute valide et en tire montant, issue, moyen', () => {
    const n = p.verifyNotification({ ...base, hmac_compute: hmac('1000|GS-AAA|pk') });
    expect(n).toMatchObject({ valid: true, reference: 'GS-AAA', outcome: 'PAID', amountMinor: 1000, currencyCode: 'XOF', paymentMethod: 'Wave' });
    expect(n.safePayload).not.toHaveProperty('hmac_compute');
  });

  it('accepte aussi le hmac calculé sur final_item_price', () => {
    expect(p.verifyNotification({ ...base, final_item_price: '950', hmac_compute: hmac('950|GS-AAA|pk') }).valid).toBe(true);
  });

  it('refuse un hmac forgé', () => {
    expect(p.verifyNotification({ ...base, hmac_compute: hmac('1|GS-AAA|pk') }).valid).toBe(false);
    expect(p.verifyNotification({ ...base, hmac_compute: 'zz' }).valid).toBe(false);
  });

  it('à défaut de hmac, compare les empreintes sha256 des clés, puis les retire', () => {
    const n = p.verifyNotification({ ...base, api_key_sha256: sha('pk'), api_secret_sha256: sha('sk') });
    expect(n.valid).toBe(true);
    expect(n.safePayload).not.toHaveProperty('api_secret_sha256');
    expect(p.verifyNotification({ ...base, api_key_sha256: sha('pk'), api_secret_sha256: sha('autre') }).valid).toBe(false);
  });

  it('reconnaît l’annulation et un événement inconnu', () => {
    expect(p.verifyNotification({ ...base, type_event: 'sale_canceled' }).outcome).toBe('CANCELLED');
    expect(p.verifyNotification({ ...base, type_event: 'autre', item_price: 'abc' })).toMatchObject({ outcome: 'UNKNOWN', amountMinor: null });
  });

  it('même notification rejouée = même clé de déduplication', () => {
    expect(p.verifyNotification(base).dedupeKey).toBe(p.verifyNotification({ ...base }).dedupeKey);
  });
});

describe('PaytechProvider — demande de paiement', () => {
  const fetchMock = jest.fn();
  beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock; });
  const req = { reference: 'GS-B', amountMinor: 2000, currencyCode: 'XOF', itemName: '220 crédits', ipnUrl: 'i', successUrl: 's', cancelUrl: 'c' };

  it('envoie les clés en en-tête et renvoie jeton + URL', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: 1, token: 't1', redirect_url: 'https://paytech.sn/payment/checkout/t1' }) });
    await expect(new PaytechProvider(CONFIG).createCheckout(req)).resolves.toEqual({ token: 't1', redirectUrl: 'https://paytech.sn/payment/checkout/t1' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe('https://paytech.sn/api/payment/request-payment');
    expect(init.headers.API_KEY).toBe('pk');
    expect(JSON.parse(init.body as string)).toMatchObject({ item_price: 2000, ref_command: 'GS-B', env: 'test' });
  });

  it('traduit un refus ou une panne en 503 UPSTREAM_UNAVAILABLE', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: -1, errors: ['clé'] }) });
    await expect(new PaytechProvider(CONFIG).createCheckout(req)).rejects.toMatchObject({ status: 503 });
    fetchMock.mockRejectedValueOnce(new Error('ECONNRESET'));
    await expect(new PaytechProvider(CONFIG).createCheckout(req)).rejects.toMatchObject({ status: 503 });
  });
});

describe('FakePaymentProvider', () => {
  const p = new FakePaymentProvider(CONFIG);

  it('sert sa page de paiement sur l’API', async () => {
    const c = await p.createCheckout({ reference: 'GS-C', amountMinor: 500, currencyCode: 'XOF', itemName: 'x', ipnUrl: '', successUrl: '', cancelUrl: '' });
    expect(c.redirectUrl).toBe('http://api.test/api/v1/billing/fake-checkout/GS-C');
  });

  it('une notification simulée signée est valide ; altérée, elle est refusée', () => {
    const signature = p.signSimulation('GS-C', 'PAID', 500);
    expect(p.verifyNotification({ reference: 'GS-C', outcome: 'PAID', amountMinor: 500, signature })).toMatchObject({ valid: true, outcome: 'PAID', amountMinor: 500 });
    expect(p.verifyNotification({ reference: 'GS-C', outcome: 'PAID', amountMinor: 5000, signature }).valid).toBe(false);
    expect(p.verifyNotification({ outcome: 'NOPE' })).toMatchObject({ valid: false, outcome: 'UNKNOWN', reference: null });
  });
});

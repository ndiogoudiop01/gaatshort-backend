import { Prisma } from '@prisma/client';
import type { AppConfigService } from '@config/app-config.service';
import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { newOrderReference, OrdersService } from '../application/orders.service';
import { PaymentNotificationService } from '../application/payment-notification.service';
import { PacksService } from '../application/packs.service';
import type { PaymentProviderPort, VerifiedNotification } from '../domain/ports/payment-provider.port';

const CONFIG = {
  app: { publicUrl: 'http://api.test', globalPrefix: 'api', frontendUrl: 'http://web.test', corsOrigins: ['http://bo.test'] },
  tenancy: { rootDomain: 'gaatshort.com' },
  payment: { orderTtlMinutes: 30, paytech: {} },
} as unknown as AppConfigService;

const PACK = { id: 'p-1', coins: 200, bonusCoins: 20, currencyCode: 'XOF', amountMinor: 2000 };

function provider(n?: Partial<VerifiedNotification>): PaymentProviderPort {
  return {
    name: 'FAKE',
    createCheckout: jest.fn(async () => ({ token: 'tok', redirectUrl: 'http://pay/tok' })),
    verifyNotification: jest.fn(() => ({
      valid: true, reference: 'GS-X', outcome: 'PAID', amountMinor: 2000, currencyCode: 'XOF', paymentMethod: 'Wave',
      eventType: 'sale_complete', dedupeKey: 'd1', safePayload: {}, ...n,
    })),
    signSimulation: jest.fn(() => 'sig'),
  };
}

describe('Référence de commande', () => {
  it('GS- + 10 caractères sans ambiguïté (pas de 0/O, 1/I)', () => {
    const ref = newOrderReference();
    expect(ref).toMatch(/^GS-[A-HJ-NP-Z2-9]{10}$/);
    expect(newOrderReference()).not.toBe(ref);
  });
});

describe('OrdersService', () => {
  it('rejoue la commande existante pour la même clé d’idempotence', async () => {
    const { prisma, client } = prismaMock();
    client.order.findFirst.mockResolvedValueOnce({ id: 'o-1', status: 'PENDING' });
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, provider());
    await expect(s.create({ accountId: 'a', packId: 'p-1', idempotencyKey: 'k' })).resolves.toEqual({ id: 'o-1', status: 'PENDING' });
    expect(client.order.create).not.toHaveBeenCalled();
  });

  it('fige le pack dans la commande, demande le paiement et enregistre jeton + URL', async () => {
    const { prisma, client } = prismaMock();
    client.order.findFirst.mockResolvedValueOnce(null);
    client.coinPack.findFirst.mockResolvedValueOnce(PACK);
    client.order.create.mockResolvedValueOnce({ id: 'o-2' });
    client.order.findFirstOrThrow.mockResolvedValueOnce({ id: 'o-2', redirectUrl: 'http://pay/tok' });
    const createCheckout = jest.fn(async () => ({ token: 'tok', redirectUrl: 'http://pay/tok' }));
    const pay = { ...provider(), createCheckout };
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, pay);
    const order = await s.create({ accountId: 'a', packId: 'p-1', idempotencyKey: 'k', returnUrl: 'gaatshort://boutique' });
    expect(order.redirectUrl).toBe('http://pay/tok');
    const data = client.order.create.mock.calls[0][0].data;
    expect(data).toMatchObject({ coins: 200, bonusCoins: 20, amountMinor: 2000, provider: 'FAKE' });
    expect(createCheckout).toHaveBeenCalledWith(expect.objectContaining({
      amountMinor: 2000, ipnUrl: 'http://api.test/api/v1/webhooks/paytech',
      successUrl: expect.stringMatching(/^gaatshort:\/\/boutique\?reference=GS-[A-Z0-9]{10}&status=success$/),
    }));
    expect(client.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o-2' }, data: { providerToken: 'tok', redirectUrl: 'http://pay/tok' } });
  });

  it('URL de retour : seulement chez nous, sinon FRONTEND_URL ; la référence est toujours jointe', async () => {
    const { prisma, client } = prismaMock();
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, provider());
    client.tenantDomain.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'd' });
    await expect(s.allowedReturnUrl(undefined)).resolves.toBeUndefined();
    await expect(s.allowedReturnUrl('pas une url')).resolves.toBeUndefined();
    await expect(s.allowedReturnUrl('javascript:alert(1)')).resolves.toBeUndefined();
    await expect(s.allowedReturnUrl('gaatshort://boutique')).resolves.toBe('gaatshort://boutique');
    await expect(s.allowedReturnUrl('http://bo.test/x')).resolves.toBe('http://bo.test/x');
    await expect(s.allowedReturnUrl('http://kaay.gaatshort.com/r')).resolves.toBeUndefined(); // https exigé hors origines configurées
    await expect(s.allowedReturnUrl('https://kaay.gaatshort.com/r')).resolves.toBe('https://kaay.gaatshort.com/r');
    await expect(s.allowedReturnUrl('https://gaatshort.com.evil.example/r')).resolves.toBeUndefined();
    await expect(s.allowedReturnUrl('https://evil.example/r')).resolves.toBeUndefined(); // domaine inconnu
    await expect(s.allowedReturnUrl('https://kaaydrama.sn/r')).resolves.toBe('https://kaaydrama.sn/r'); // domaine vérifié de la marque
    expect(client.tenantDomain.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ domain: 'kaaydrama.sn', verifiedAt: { not: null } }),
    }));

    client.order.findFirst.mockResolvedValueOnce(null);
    client.coinPack.findFirst.mockResolvedValueOnce(PACK);
    client.order.create.mockResolvedValueOnce({ id: 'o-9' });
    client.order.findFirstOrThrow.mockResolvedValueOnce({ id: 'o-9' });
    client.tenantDomain.findFirst.mockResolvedValueOnce(null);
    const pay = provider();
    const s2 = new OrdersService(prisma, CONFIG, tenantContext() as never, pay);
    await s2.create({ accountId: 'a', packId: 'p-1', idempotencyKey: 'k', returnUrl: 'https://evil.example/r' });
    const req = (pay.createCheckout as jest.Mock).mock.calls[0][0];
    expect(req.successUrl).toMatch(/^http:\/\/web\.test\/boutique\/retour\?reference=GS-[A-Z0-9]{10}&status=success$/);
    expect(req.cancelUrl).toContain('status=cancel');
  });

  it('retour de la page simulée : délégué au pilote factice, refusé sinon', () => {
    const { prisma } = prismaMock();
    const fake = { ...provider(), simulatedReturnUrl: jest.fn(() => 'https://r') };
    expect(new OrdersService(prisma, CONFIG, tenantContext() as never, fake).simulatedReturnUrl('GS-X', 'PAID', { ok: 'a' })).toBe('https://r');
    const noReturn = provider();
    expect(new OrdersService(prisma, CONFIG, tenantContext() as never, noReturn).simulatedReturnUrl('GS-X', 'PAID', {})).toBeNull();
    const paytech = { ...provider(), name: 'PAYTECH' as const };
    expect(() => new OrdersService(prisma, CONFIG, tenantContext() as never, paytech).simulatedReturnUrl('GS-X', 'PAID', {})).toThrow();
  });

  it('pack inconnu → 404 ; paiement indisponible → commande FAILED', async () => {
    const { prisma, client } = prismaMock();
    client.order.findFirst.mockResolvedValue(null);
    client.coinPack.findFirst.mockResolvedValueOnce(null);
    const pay = provider();
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, pay);
    await expect(s.create({ accountId: 'a', packId: 'nope', idempotencyKey: 'k' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });

    client.coinPack.findFirst.mockResolvedValueOnce(PACK);
    client.order.create.mockResolvedValueOnce({ id: 'o-3' });
    (pay.createCheckout as jest.Mock).mockRejectedValueOnce(new Error('down'));
    await expect(s.create({ accountId: 'a', packId: 'p-1', idempotencyKey: 'k2' })).rejects.toThrow('down');
    expect(client.order.updateMany).toHaveBeenCalledWith({ where: { id: 'o-3' }, data: { status: 'FAILED', failureCode: 'CHECKOUT_FAILED' } });
  });

  it('constate l’expiration à la lecture', async () => {
    const { prisma, client } = prismaMock();
    client.order.findFirst.mockResolvedValueOnce({ id: 'o-4', status: 'PENDING', expiresAt: new Date(Date.now() - 1000) });
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, provider());
    await expect(s.getMine('a', 'GS-ZZZ')).resolves.toMatchObject({ status: 'EXPIRED' });
    expect(client.orderStatusHistory.create).toHaveBeenCalled();
    client.order.findFirst.mockResolvedValueOnce(null);
    await expect(s.getMine('a', '11111111-1111-1111-1111-111111111111')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('liste back-office : joint le téléphone du compte', async () => {
    const { prisma, client } = prismaMock();
    client.order.findMany.mockResolvedValueOnce([{ id: 'o', accountId: 'a' }]);
    client.order.count.mockResolvedValueOnce(1);
    client.account.findMany.mockResolvedValueOnce([{ id: 'a', phoneE164: '+221770000000' }]);
    const s = new OrdersService(prisma, CONFIG, tenantContext() as never, provider());
    const page = await s.adminList({ page: 1, perPage: 20, status: 'SUCCEEDED', q: 'gs-a' });
    expect(page.items[0].account?.phoneE164).toBe('+221770000000');
    client.order.findFirst.mockResolvedValueOnce({ id: 'o', accountId: 'a', reference: 'GS-A', history: [] });
    client.account.findUnique.mockResolvedValueOnce({ id: 'a' });
    client.paymentProviderEvent.findMany.mockResolvedValueOnce([]);
    await expect(s.adminGet('o')).resolves.toMatchObject({ reference: 'GS-A', events: [] });
  });

  it('la simulation n’existe qu’avec le pilote factice', () => {
    const { prisma } = prismaMock();
    expect(() => new OrdersService(prisma, CONFIG, tenantContext() as never, { ...provider(), name: 'PAYTECH' }).assertFakeEnabled()).toThrow();
  });
});

describe('PaymentNotificationService', () => {
  const ORDER = { id: 'o-1', reference: 'GS-X', status: 'PENDING', accountId: 'acc', coins: 200, bonusCoins: 20, amountMinor: 2000, currencyCode: 'XOF' };

  function setup(n?: Partial<VerifiedNotification>, order: Record<string, unknown> | null = ORDER) {
    const { prisma, client } = prismaMock();
    client.paymentProviderEvent.create.mockResolvedValue({ id: 'ev-1' });
    client.paymentProviderEvent.update.mockResolvedValue({});
    client.$queryRaw
      .mockResolvedValueOnce([{ t: order ? 't-1' : null }])
      .mockResolvedValueOnce(order ? [{ id: order.id }] : []);
    client.order.findUniqueOrThrow.mockResolvedValue(order);
    const wallet = { creditPurchase: jest.fn(async () => true) };
    const s = new PaymentNotificationService(prisma, provider(n), wallet as never);
    return { s, client, wallet, prisma };
  }

  it('paiement confirmé : SUCCEEDED, historique, crédit du portefeuille, dans la transaction de la marque', async () => {
    const { s, client, wallet, prisma } = setup();
    await expect(s.handle({})).resolves.toBe('PROCESSED');
    expect(client.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'SUCCEEDED' }) }));
    expect(wallet.creditPurchase).toHaveBeenCalledWith({ accountId: 'acc', orderId: 'o-1', coins: 200, bonusCoins: 20, originTenantId: 't-1' });
    expect((prisma.transaction as jest.Mock).mock.calls[0][1]).toBe('t-1');
  });

  it('notification rejouée : ignorée sans rien recréditer', async () => {
    const { s, client, wallet } = setup();
    client.paymentProviderEvent.create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(s.handle({})).resolves.toBe('DUPLICATE');
    expect(wallet.creditPurchase).not.toHaveBeenCalled();
  });

  it('signature invalide : rejetée', async () => {
    const { s, wallet } = setup({ valid: false });
    await expect(s.handle({})).resolves.toBe('REJECTED');
    expect(wallet.creditPurchase).not.toHaveBeenCalled();
  });

  it('montant différent : MISMATCH, rien n’est crédité', async () => {
    const { s, wallet } = setup({ amountMinor: 100 });
    await expect(s.handle({})).resolves.toBe('MISMATCH');
    expect(wallet.creditPurchase).not.toHaveBeenCalled();
  });

  it('commande déjà payée : sans effet ; commande annulée puis payée : MISMATCH', async () => {
    await expect(setup({}, { ...ORDER, status: 'SUCCEEDED' }).s.handle({})).resolves.toBe('ALREADY_FINAL');
    await expect(setup({}, { ...ORDER, status: 'CANCELLED' }).s.handle({})).resolves.toBe('MISMATCH');
  });

  it('annulation par le client ; référence inconnue ; sans référence', async () => {
    const cancel = setup({ outcome: 'CANCELLED' });
    await expect(cancel.s.handle({})).resolves.toBe('PROCESSED');
    expect(cancel.client.order.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }));
    await expect(setup({}, null).s.handle({})).resolves.toBe('UNKNOWN_ORDER');
    await expect(setup({ reference: null }).s.handle({})).resolves.toBe('IGNORED');
    await expect(setup({ outcome: 'UNKNOWN' }).s.handle({})).resolves.toBe('IGNORED');
  });

  it('simulation : signe puis suit le chemin réel', async () => {
    const { s, client } = setup();
    client.$queryRaw.mockReset();
    client.$queryRaw
      .mockResolvedValueOnce([{ t: 't-1' }])
      .mockResolvedValueOnce([{ t: 't-1' }])
      .mockResolvedValueOnce([{ id: 'o-1' }]);
    client.order.findFirst.mockResolvedValueOnce(ORDER);
    await expect(s.simulate('GS-X', 'PAID')).resolves.toBe('PROCESSED');
  });
});

describe('PacksService', () => {
  it('liste, crée (doublon → 409) et modifie', async () => {
    const { prisma, client } = prismaMock();
    client.coinPack.findMany.mockResolvedValue([PACK]);
    const s = new PacksService(prisma);
    await expect(s.listActive()).resolves.toEqual([PACK]);
    await expect(s.listAll()).resolves.toEqual([PACK]);
    client.coinPack.create.mockResolvedValueOnce({ id: 'p-2' });
    await expect(s.create('u', { code: 'pack-x', coins: 10, amountMinor: 100 })).resolves.toEqual({ id: 'p-2' });
    client.coinPack.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' }));
    await expect(s.create('u', { code: 'pack-x', coins: 10, amountMinor: 100 })).rejects.toMatchObject({ status: 409 });
    client.coinPack.findFirst.mockResolvedValueOnce(null);
    await expect(s.update('u', 'nope', { coins: 5 })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    client.coinPack.findFirst.mockResolvedValueOnce(PACK).mockResolvedValueOnce({ ...PACK, coins: 5 });
    await expect(s.update('u', 'p-1', { coins: 5 })).resolves.toMatchObject({ coins: 5 });
  });
});

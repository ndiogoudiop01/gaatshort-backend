import { BillingController } from '../presentation/http/billing.controller';

const VIEWER = { id: 'u', accountId: 'acc' } as never;

function setup() {
  const packs = { listActive: jest.fn(), listAll: jest.fn(), create: jest.fn(), update: jest.fn() };
  const orders = { create: jest.fn(), listMine: jest.fn(), getMine: jest.fn(), adminList: jest.fn(), adminGet: jest.fn(), assertFakeEnabled: jest.fn(), simulatedReturnUrl: jest.fn((): string | null => null) };
  const notifications = { handle: jest.fn(async () => 'PROCESSED'), simulate: jest.fn(async () => 'PROCESSED') };
  return { c: new BillingController(packs as never, orders as never, notifications as never), packs, orders, notifications };
}

describe('BillingController', () => {
  it('exige une clé d’idempotence et transmet l’URL de retour (filtrée par le service)', () => {
    const { c, orders } = setup();
    expect(() => c.createOrder({ packId: 'p' }, undefined, VIEWER)).toThrow();
    expect(() => c.createOrder({ packId: 'p' }, 'court', VIEWER)).toThrow();
    void c.createOrder({ packId: 'p', returnUrl: 'https://kaay.gaatshort.com/boutique/retour' }, 'cle-valide-123', VIEWER);
    expect(orders.create.mock.calls[0][0]).toMatchObject({ accountId: 'acc', idempotencyKey: 'cle-valide-123', returnUrl: 'https://kaay.gaatshort.com/boutique/retour' });
  });

  it('un compte back-office sans téléphone ne peut pas acheter', () => {
    const { c } = setup();
    expect(() => c.createOrder({ packId: 'p' }, 'cle-valide-1234', { id: 'staff', accountId: null } as never)).toThrow();
  });

  it('IPN : toujours 200 avec le résultat', async () => {
    const { c } = setup();
    await expect(c.paytechIpn({ ref_command: 'GS-X' })).resolves.toEqual({ received: true, result: 'PROCESSED' });
  });

  it('page de paiement simulé et décision', async () => {
    const { c, notifications, orders } = setup();
    const res = { type: jest.fn().mockReturnThis(), send: jest.fn(), redirect: jest.fn() };
    c.fakeCheckout('GS-ABC<script>', { ok: 'https://x.test/?a=1&b="2"', ko: 'k', sig: 's', autre: 'zz' }, res as never);
    const html = res.send.mock.calls[0][0] as string;
    expect(html).toContain('GS-ABCscript');
    expect(html).not.toContain('<script>');
    expect(html).toContain('action="GS-ABCscript/PAID?ok=');
    expect(html).not.toContain('autre=');
    expect(html).not.toMatch(/"2"/);
    await c.fakeCheckoutDecide('GS-ABC', 'PAID', {}, res as never);
    await c.fakeCheckoutDecide('GS-ABC', 'nimporte', {}, res as never);
    expect(notifications.simulate.mock.calls).toEqual([['GS-ABC', 'PAID'], ['GS-ABC', 'CANCELLED']]);
    expect(res.redirect).not.toHaveBeenCalled();

    orders.simulatedReturnUrl.mockReturnValueOnce('https://kaay.gaatshort.com/boutique/retour?reference=GS-ABC');
    await c.fakeCheckoutDecide('GS-ABC', 'PAID', { ok: 'x', ko: 'y', sig: 'z' }, res as never);
    expect(res.redirect).toHaveBeenCalledWith(303, 'https://kaay.gaatshort.com/boutique/retour?reference=GS-ABC');
  });

  it('routes de lecture et back-office', () => {
    const { c, packs, orders } = setup();
    void c.listPacks(); void c.myOrders(VIEWER, { limit: 5 }); void c.myOrder('GS-A', VIEWER); void c.adminPacks();
    void c.createPack({ code: 'p', coins: 1, amountMinor: 1 }, VIEWER); void c.updatePack('id', { coins: 2 }, VIEWER);
    void c.adminOrders({ page: 1, perPage: 20 } as never); void c.adminOrder('id');
    expect(packs.create).toHaveBeenCalled();
    expect(orders.adminGet).toHaveBeenCalledWith('id');
  });
});

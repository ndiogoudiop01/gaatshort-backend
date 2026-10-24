import type { AppConfigService } from '@config/app-config.service';
import { BillingController } from '../presentation/http/billing.controller';

const CFG = { app: { corsOrigins: ['http://web.test'], frontendUrl: 'http://front.test' } } as unknown as AppConfigService;
const VIEWER = { id: 'u', accountId: 'acc' } as never;

function setup() {
  const packs = { listActive: jest.fn(), listAll: jest.fn(), create: jest.fn(), update: jest.fn() };
  const orders = { create: jest.fn(), listMine: jest.fn(), getMine: jest.fn(), adminList: jest.fn(), adminGet: jest.fn(), assertFakeEnabled: jest.fn() };
  const notifications = { handle: jest.fn(async () => 'PROCESSED'), simulate: jest.fn(async () => 'PROCESSED') };
  return { c: new BillingController(packs as never, orders as never, notifications as never, CFG), packs, orders, notifications };
}

describe('BillingController', () => {
  it('exige une clé d’idempotence et filtre l’URL de retour', () => {
    const { c, orders } = setup();
    expect(() => c.createOrder({ packId: 'p' }, undefined, VIEWER)).toThrow();
    expect(() => c.createOrder({ packId: 'p' }, 'court', VIEWER)).toThrow();
    void c.createOrder({ packId: 'p', returnUrl: 'https://evil.example/x' }, 'cle-valide-123', VIEWER);
    expect(orders.create.mock.calls[0][0]).toMatchObject({ accountId: 'acc', returnUrl: undefined });
    void c.createOrder({ packId: 'p', returnUrl: 'gaatshort://boutique' }, 'cle-valide-1234', VIEWER);
    void c.createOrder({ packId: 'p', returnUrl: 'http://web.test/retour' }, 'cle-valide-1235', VIEWER);
    void c.createOrder({ packId: 'p', returnUrl: 'pas une url' }, 'cle-valide-1236', VIEWER);
    expect(orders.create.mock.calls.map((x: { returnUrl?: string }[]) => x[0].returnUrl)).toEqual([undefined, 'gaatshort://boutique', 'http://web.test/retour', undefined]);
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
    const { c, notifications } = setup();
    const res = { type: jest.fn().mockReturnThis(), send: jest.fn() };
    c.fakeCheckout('GS-ABC<script>', res as never);
    expect(res.send.mock.calls[0][0]).toContain('GS-ABCscript');
    expect(res.send.mock.calls[0][0]).not.toContain('<script>');
    await c.fakeCheckoutDecide('GS-ABC', 'PAID', res as never);
    await c.fakeCheckoutDecide('GS-ABC', 'nimporte', res as never);
    expect(notifications.simulate.mock.calls).toEqual([['GS-ABC', 'PAID'], ['GS-ABC', 'CANCELLED']]);
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

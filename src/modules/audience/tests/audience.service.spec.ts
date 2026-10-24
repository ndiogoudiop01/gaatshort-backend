import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { AudienceService } from '../application/audience.service';

function setup() {
  const { prisma, client } = prismaMock();
  const wallet = {
    balance: jest.fn(async () => ({ paidBalance: 10, bonusBalance: 5, total: 15 })),
    ledger: jest.fn(async () => ({ items: [], nextBefore: null })),
    adjust: jest.fn(async () => ({ paidBalance: 10, bonusBalance: 35, total: 45 })),
  };
  return { s: new AudienceService(prisma, tenantContext() as never, wallet as never), client, wallet };
}

describe('AudienceService', () => {
  it('liste les spectateurs avec leur solde', async () => {
    const { s, client } = setup();
    client.user.findMany.mockResolvedValueOnce([{ id: 'm', accountId: 'a', phoneE164: '+221', status: 'ACTIVE', createdAt: new Date(), lastLoginAt: null }]);
    client.user.count.mockResolvedValueOnce(1);
    client.wallet.findMany.mockResolvedValueOnce([{ accountId: 'a', paidBalance: 10, bonusBalance: 5 }]);
    client.account.findMany.mockResolvedValueOnce([{ id: 'a', countryCode: 'SN', status: 'ACTIVE' }]);
    const page = await s.listViewers({ q: '77', page: 1, perPage: 20 });
    expect(page.items[0]).toMatchObject({ accountId: 'a', balance: 15, countryCode: 'SN' });
  });

  it('fiche spectateur ; inconnu de la marque → 404 (pas d’ajustement possible)', async () => {
    const { s, client, wallet } = setup();
    client.user.findFirst.mockResolvedValue({ id: 'm' });
    client.order.findMany.mockResolvedValueOnce([]);
    client.entitlement.count.mockResolvedValueOnce(3);
    await expect(s.viewer('a')).resolves.toMatchObject({ unlockedEpisodes: 3, balance: { total: 15 } });
    await s.adjust('a', 30, 'geste commercial', 'u');
    expect(wallet.adjust).toHaveBeenCalledWith({ accountId: 'a', delta: 30, reason: 'geste commercial', actorUserId: 'u' });
    client.user.findFirst.mockResolvedValue(null);
    await expect(s.adjust('x', 30, 'geste', 'u')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('tableau de bord', async () => {
    const { s, client } = setup();
    client.user.count.mockResolvedValue(10);
    client.order.count.mockResolvedValue(4);
    client.order.groupBy.mockResolvedValue([{ currencyCode: 'XOF', _sum: { amountMinor: 8000 } }]);
    client.entitlement.count.mockResolvedValue(7);
    client.watchProgress.groupBy.mockResolvedValueOnce([{ accountId: 'a' }, { accountId: 'b' }]).mockResolvedValueOnce([{ seriesId: 's', _count: { accountId: 2 } }]);
    client.tenantSeries.count.mockResolvedValue(3);
    client.episode.count.mockResolvedValue(30);
    client.series.findMany.mockResolvedValue([{ id: 's', titleFr: 'S', posterUrl: null }]);
    client.$queryRaw.mockResolvedValue([{ day: new Date(), orders: 2n, amount: 4000n }]);
    await expect(s.dashboard()).resolves.toMatchObject({
      viewers: 10, activeViewers7d: 2, paidOrders30d: 4, revenue30d: [{ amountMinor: 8000 }], unlocks30d: 7,
      topSeries30d: [{ title: 'S', viewers: 2 }], revenueByDay30d: [{ orders: 2, amountMinor: 4000 }],
    });
  });
});

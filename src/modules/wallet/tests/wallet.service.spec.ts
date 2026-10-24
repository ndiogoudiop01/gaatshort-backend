import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { splitDebit, WalletService } from '../application/wallet.service';

const EPISODE = { episode: { id: 'e-6', number: 6, title: 'É6', durationSeconds: 100, thumbnailUrl: null, isFree: false, priceCoins: 15 } };

function setup(balance: { paid: number; bonus: number } = { paid: 10, bonus: 10 }) {
  const { prisma, client } = prismaMock();
  client.$executeRaw.mockResolvedValue(1);
  client.$queryRaw.mockResolvedValue([{ paid_balance: balance.paid, bonus_balance: balance.bonus }]);
  client.walletLedgerEntry.create.mockResolvedValue({ id: 'le-1' });
  const catalog = { getPlayableEpisode: jest.fn(async () => EPISODE) };
  const s = new WalletService(prisma, tenantContext() as never, catalog as never);
  return { s, client, catalog };
}

describe('splitDebit', () => {
  it('consomme le bonus d’abord, puis les crédits payés', () => {
    expect(splitDebit(15, 10)).toEqual({ bonusDelta: -10, paidDelta: -5 });
    expect(splitDebit(15, 40)).toEqual({ bonusDelta: -15, paidDelta: -0 });
    expect(splitDebit(15, 0)).toEqual({ bonusDelta: -0, paidDelta: -15 });
  });
});

describe('WalletService', () => {
  it('solde : zéro sans portefeuille', async () => {
    const { s, client } = setup();
    client.wallet.findUnique.mockResolvedValueOnce(null);
    await expect(s.balance('a')).resolves.toEqual({ paidBalance: 0, bonusBalance: 0, total: 0 });
  });

  it('déblocage : débit bonus puis payé, écriture du grand livre, droit, mise à jour du solde', async () => {
    const { s, client } = setup();
    client.entitlement.findUnique.mockResolvedValueOnce(null);
    const r = await s.unlock({ accountId: 'a', episodeId: 'e-6', country: 'SN', locale: 'fr' });
    expect(r).toEqual({ unlocked: true, alreadyUnlocked: false, chargedCoins: 15, balance: { paidBalance: 5, bonusBalance: 0, total: 5 } });
    expect(client.walletLedgerEntry.create.mock.calls[0][0].data).toMatchObject({
      kind: 'UNLOCK_DEBIT', paidDelta: -5, bonusDelta: -10, paidBalanceAfter: 5, bonusBalanceAfter: 0, originTenantId: 't-1',
    });
    expect(client.entitlement.create.mock.calls[0][0].data).toMatchObject({ source: 'COINS', ledgerEntryId: 'le-1' });
  });

  it('déjà débloqué : ne débite rien (double tap)', async () => {
    const { s, client } = setup();
    client.entitlement.findUnique.mockResolvedValueOnce({ id: 'en' });
    await expect(s.unlock({ accountId: 'a', episodeId: 'e-6', country: 'SN', locale: 'fr' })).resolves.toMatchObject({ alreadyUnlocked: true, chargedCoins: 0 });
    expect(client.walletLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('solde insuffisant : 409 INSUFFICIENT_BALANCE', async () => {
    const { s, client } = setup({ paid: 3, bonus: 2 });
    client.entitlement.findUnique.mockResolvedValueOnce(null);
    await expect(s.unlock({ accountId: 'a', episodeId: 'e-6', country: 'SN', locale: 'fr' })).rejects.toMatchObject({ status: 409 });
  });

  it('épisode gratuit : rien à débloquer', async () => {
    const { s, catalog, client } = setup();
    catalog.getPlayableEpisode.mockResolvedValueOnce({ episode: { ...EPISODE.episode, isFree: true, priceCoins: 0 } });
    client.wallet.findUnique.mockResolvedValueOnce({ paidBalance: 1, bonusBalance: 0 });
    await expect(s.unlock({ accountId: 'a', episodeId: 'e-1', country: 'SN', locale: 'fr' })).resolves.toMatchObject({ chargedCoins: 0 });
  });

  it('crédit d’achat : une seule fois par commande', async () => {
    const { s, client } = setup({ paid: 0, bonus: 0 });
    client.walletLedgerEntry.findFirst.mockResolvedValueOnce(null);
    await expect(s.creditPurchase({ accountId: 'a', orderId: 'o', coins: 200, bonusCoins: 20, originTenantId: 't-1' })).resolves.toBe(true);
    expect(client.wallet.update.mock.calls[0][0].data).toMatchObject({ paidBalance: 200, bonusBalance: 20 });
    client.walletLedgerEntry.findFirst.mockResolvedValueOnce({ id: 'déjà' });
    await expect(s.creditPurchase({ accountId: 'a', orderId: 'o', coins: 200, bonusCoins: 20, originTenantId: 't-1' })).resolves.toBe(false);
  });

  it('ajustement : bonus uniquement, jamais sous zéro, audité', async () => {
    const { s, client } = setup({ paid: 50, bonus: 5 });
    client.account.findUnique.mockResolvedValue({ id: 'a' });
    await expect(s.adjust({ accountId: 'a', delta: 30, reason: 'geste commercial', actorUserId: 'u' })).resolves.toEqual({ paidBalance: 50, bonusBalance: 35, total: 85 });
    expect(client.auditLog.create).toHaveBeenCalled();
    await expect(s.adjust({ accountId: 'a', delta: -10, reason: 'erreur de saisie', actorUserId: 'u' })).rejects.toMatchObject({ code: 'ADJUSTMENT_EXCEEDS_BONUS' });
    await expect(s.adjust({ accountId: 'a', delta: 0, reason: 'rien', actorUserId: 'u' })).rejects.toMatchObject({ code: 'ADJUSTMENT_ZERO' });
    client.account.findUnique.mockResolvedValueOnce(null);
    await expect(s.adjust({ accountId: 'x', delta: 1, reason: 'inconnu', actorUserId: 'u' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('historique paginé par date et épisodes débloqués', async () => {
    const { s, client } = setup();
    const at = new Date('2026-10-01');
    client.walletLedgerEntry.findMany.mockResolvedValueOnce([
      { id: '1', paidDelta: 10, bonusDelta: 0, createdAt: at },
      { id: '2', paidDelta: -5, bonusDelta: 0, createdAt: at },
    ]);
    await expect(s.ledger('a', 1)).resolves.toMatchObject({ items: [{ id: '1', delta: 10 }], nextBefore: at.toISOString() });
    await expect(s.unlockedEpisodeIds('a', [])).resolves.toEqual(new Set());
    client.entitlement.findMany.mockResolvedValueOnce([{ episodeId: 'e-6' }]);
    await expect(s.unlockedEpisodeIds('a', ['e-6', 'e-7'])).resolves.toEqual(new Set(['e-6']));
  });
});

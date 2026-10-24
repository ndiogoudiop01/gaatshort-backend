import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { CATALOG_FACADE, type CatalogFacade, type Locale } from '@modules/catalog/catalog.facade';
import type { WalletBalance, WalletFacade } from '../wallet.facade';

type Tx = Prisma.TransactionClient;

/**
 * Débit : on consomme d'abord les crédits BONUS, puis les crédits PAYÉS — un
 * remboursement ne reprend ainsi que des crédits payés non consommés.
 */
export function splitDebit(price: number, bonus: number): { bonusDelta: number; paidDelta: number } {
  const fromBonus = Math.min(bonus, price);
  return { bonusDelta: -fromBonus, paidDelta: -(price - fromBonus) };
}

@Injectable()
export class WalletService implements WalletFacade {
  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
    @Inject(CATALOG_FACADE) private readonly catalog: CatalogFacade,
  ) {}

  public async balance(accountId: string): Promise<WalletBalance> {
    const w = await this.prisma.client.wallet.findUnique({ where: { accountId } });
    const paid = w?.paidBalance ?? 0;
    const bonus = w?.bonusBalance ?? 0;
    return { paidBalance: paid, bonusBalance: bonus, total: paid + bonus };
  }

  public async ledger(accountId: string, limit: number, before?: string) {
    const rows = await this.prisma.client.walletLedgerEntry.findMany({
      where: { accountId, ...(before ? { createdAt: { lt: new Date(before) } } : {}) },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      select: {
        id: true, kind: true, paidDelta: true, bonusDelta: true, paidBalanceAfter: true, bonusBalanceAfter: true,
        orderId: true, episodeId: true, reason: true, createdAt: true,
      },
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map((r) => ({ ...r, delta: r.paidDelta + r.bonusDelta }));
    return { items, nextBefore: hasMore ? items[items.length - 1]?.createdAt.toISOString() : null };
  }

  public async unlockedEpisodeIds(accountId: string, episodeIds: readonly string[]): Promise<Set<string>> {
    if (!episodeIds.length) return new Set();
    const rows = await this.prisma.client.entitlement.findMany({
      where: { accountId, episodeId: { in: [...episodeIds] } },
      select: { episodeId: true },
    });
    return new Set(rows.map((r) => r.episodeId));
  }

  /**
   * Déblocage d'un épisode payant (FLOW-06) dans UNE transaction : verrou du
   * portefeuille → déjà débloqué ? → prix effectif → solde suffisant ? →
   * écriture UNLOCK_DEBIT → droit de visionnage. Deux taps simultanés : le
   * verrou sérialise, le second voit le droit et ne débite rien.
   */
  public async unlock(params: { accountId: string; episodeId: string; country: string; locale: Locale }) {
    const playable = await this.catalog.getPlayableEpisode(params.episodeId, params.country, params.locale);
    if (playable.episode.isFree) {
      return { unlocked: true, alreadyUnlocked: true, chargedCoins: 0, balance: await this.balance(params.accountId) };
    }
    const price = playable.episode.priceCoins;
    const tenantId = this.tenant.tenantId;

    return this.prisma.transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, params.accountId);
      const existing = await tx.entitlement.findUnique({
        where: { accountId_episodeId: { accountId: params.accountId, episodeId: params.episodeId } },
      });
      if (existing) {
        return { unlocked: true, alreadyUnlocked: true, chargedCoins: 0, balance: toBalance(wallet) };
      }
      if (wallet.paidBalance + wallet.bonusBalance < price) {
        throw new ConflictException({
          code: 'INSUFFICIENT_BALANCE',
          message: 'Solde de crédits insuffisant',
          details: { required: price, available: wallet.paidBalance + wallet.bonusBalance },
        });
      }
      const { bonusDelta, paidDelta } = splitDebit(price, wallet.bonusBalance);
      const next = { paidBalance: wallet.paidBalance + paidDelta, bonusBalance: wallet.bonusBalance + bonusDelta };
      const entry = await tx.walletLedgerEntry.create({
        data: {
          accountId: params.accountId,
          kind: 'UNLOCK_DEBIT',
          paidDelta,
          bonusDelta,
          paidBalanceAfter: next.paidBalance,
          bonusBalanceAfter: next.bonusBalance,
          episodeId: params.episodeId,
          originTenantId: tenantId,
        },
      });
      await tx.entitlement.create({
        data: { accountId: params.accountId, episodeId: params.episodeId, source: 'COINS', ledgerEntryId: entry.id, originTenantId: tenantId },
      });
      await tx.wallet.update({ where: { accountId: params.accountId }, data: { ...next, version: { increment: 1 } } });
      return { unlocked: true, alreadyUnlocked: false, chargedCoins: price, balance: toBalance(next) };
    });
  }

  public async creditPurchase(p: { accountId: string; orderId: string; coins: number; bonusCoins: number; originTenantId: string }) {
    return this.prisma.transaction(async (tx) => {
      const already = await tx.walletLedgerEntry.findFirst({ where: { orderId: p.orderId, kind: 'PURCHASE_CREDIT' } });
      if (already) return false;
      const wallet = await this.lockWallet(tx, p.accountId);
      const next = { paidBalance: wallet.paidBalance + p.coins, bonusBalance: wallet.bonusBalance + p.bonusCoins };
      await tx.walletLedgerEntry.create({
        data: {
          accountId: p.accountId,
          kind: 'PURCHASE_CREDIT',
          paidDelta: p.coins,
          bonusDelta: p.bonusCoins,
          paidBalanceAfter: next.paidBalance,
          bonusBalanceAfter: next.bonusBalance,
          orderId: p.orderId,
          originTenantId: p.originTenantId,
        },
      });
      await tx.wallet.update({ where: { accountId: p.accountId }, data: { ...next, version: { increment: 1 } } });
      return true;
    }, p.originTenantId);
  }

  /**
   * Ajustement par l'assistance (FR-ADM-006) : crédits BONUS uniquement (jamais de
   * crédits « payés » sans paiement), motif obligatoire, journal d'audit.
   */
  public async adjust(p: { accountId: string; delta: number; reason: string; actorUserId: string }) {
    if (p.delta === 0) throw new BusinessRuleViolationError('ADJUSTMENT_ZERO', 'Montant nul');
    const account = await this.prisma.client.account.findUnique({ where: { id: p.accountId } });
    if (!account) throw new ResourceNotFoundError('account', p.accountId);
    const tenantId = this.tenant.tenantId;
    return this.prisma.transaction(async (tx) => {
      const wallet = await this.lockWallet(tx, p.accountId);
      const bonusAfter = wallet.bonusBalance + p.delta;
      if (bonusAfter < 0) {
        throw new BusinessRuleViolationError('ADJUSTMENT_EXCEEDS_BONUS', 'Un retrait ne peut porter que sur les crédits bonus disponibles', {
          bonusBalance: wallet.bonusBalance,
        });
      }
      await tx.walletLedgerEntry.create({
        data: {
          accountId: p.accountId, kind: 'ADJUSTMENT', paidDelta: 0, bonusDelta: p.delta,
          paidBalanceAfter: wallet.paidBalance, bonusBalanceAfter: bonusAfter,
          reason: p.reason, actorUserId: p.actorUserId, originTenantId: tenantId,
        },
      });
      await tx.wallet.update({ where: { accountId: p.accountId }, data: { bonusBalance: bonusAfter, version: { increment: 1 } } });
      await tx.auditLog.create({
        data: {
          tenantId, actorId: p.actorUserId, action: 'wallet.adjusted', resourceType: 'account', resourceId: p.accountId,
          after: { delta: p.delta, reason: p.reason },
        },
      });
      return toBalance({ paidBalance: wallet.paidBalance, bonusBalance: bonusAfter });
    });
  }

  /** Crée le portefeuille au besoin, puis le verrouille (SELECT … FOR UPDATE). */
  private async lockWallet(tx: Tx, accountId: string): Promise<{ paidBalance: number; bonusBalance: number }> {
    await tx.$executeRaw`INSERT INTO wallets (account_id, updated_at) VALUES (${accountId}::uuid, now()) ON CONFLICT (account_id) DO NOTHING`;
    const rows = await tx.$queryRaw<{ paid_balance: number; bonus_balance: number }[]>`
      SELECT paid_balance, bonus_balance FROM wallets WHERE account_id = ${accountId}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row) throw new ResourceNotFoundError('wallet', accountId);
    return { paidBalance: Number(row.paid_balance), bonusBalance: Number(row.bonus_balance) };
  }
}

function toBalance(w: { paidBalance: number; bonusBalance: number }): WalletBalance {
  return { paidBalance: w.paidBalance, bonusBalance: w.bonusBalance, total: w.paidBalance + w.bonusBalance };
}

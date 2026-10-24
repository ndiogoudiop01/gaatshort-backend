import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { WALLET_FACADE, type WalletFacade } from '@modules/wallet/wallet.facade';

const DAY = 86_400_000;

/**
 * Back-office : spectateurs de la marque (assistance, FR-ADM-006) et tableau de
 * bord (FR-ADM-008). Un spectateur de la marque = un rattachement `users` lié à
 * un compte global.
 */
@Injectable()
export class AudienceService {
  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
    @Inject(WALLET_FACADE) private readonly wallet: WalletFacade,
  ) {}

  public async listViewers(q: { q?: string; page: number; perPage: number }) {
    const where: Prisma.UserWhereInput = {
      accountId: { not: null },
      deletedAt: null,
      ...(q.q ? { OR: [{ phoneE164: { contains: q.q.replace(/\s/g, '') } }, { firstName: { contains: q.q, mode: 'insensitive' } }] } : {}),
    };
    const [users, total] = await Promise.all([
      this.prisma.client.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        select: { id: true, accountId: true, phoneE164: true, status: true, createdAt: true, lastLoginAt: true },
      }),
      this.prisma.client.user.count({ where }),
    ]);
    const accountIds = users.map((u) => u.accountId).filter((id): id is string => !!id);
    const [wallets, accounts] = await Promise.all([
      this.prisma.client.wallet.findMany({ where: { accountId: { in: accountIds } } }),
      this.prisma.client.account.findMany({ where: { id: { in: accountIds } }, select: { id: true, countryCode: true, locale: true, status: true } }),
    ]);
    const w = new Map(wallets.map((x) => [x.accountId, x]));
    const a = new Map(accounts.map((x) => [x.id, x]));
    const items = users.map((u) => ({
      accountId: u.accountId,
      membershipId: u.id,
      phoneE164: u.phoneE164,
      status: u.status,
      accountStatus: a.get(u.accountId ?? '')?.status ?? null,
      countryCode: a.get(u.accountId ?? '')?.countryCode ?? null,
      joinedAt: u.createdAt,
      lastLoginAt: u.lastLoginAt,
      balance: (w.get(u.accountId ?? '')?.paidBalance ?? 0) + (w.get(u.accountId ?? '')?.bonusBalance ?? 0),
    }));
    return PaginatedResult.offset(items, total, q.page, q.perPage);
  }

  public async viewer(accountId: string) {
    const membership = await this.prisma.client.user.findFirst({
      where: { accountId },
      select: { id: true, status: true, createdAt: true, lastLoginAt: true, phoneE164: true },
    });
    if (!membership) throw new ResourceNotFoundError('viewer', accountId);
    const [account, balance, ledger, orders, unlocks] = await Promise.all([
      this.prisma.client.account.findUnique({ where: { id: accountId } }),
      this.wallet.balance(accountId),
      this.wallet.ledger(accountId, 50),
      this.prisma.client.order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.client.entitlement.count({ where: { accountId } }),
    ]);
    return { account, membership, balance, ledger: ledger.items, orders, unlockedEpisodes: unlocks };
  }

  public async adjust(accountId: string, delta: number, reason: string, actorUserId: string) {
    await this.viewer(accountId); // la marque ne peut ajuster que SES spectateurs
    return this.wallet.adjust({ accountId, delta, reason, actorUserId });
  }

  public async dashboard() {
    const now = Date.now();
    const d7 = new Date(now - 7 * DAY);
    const d30 = new Date(now - 30 * DAY);
    const tenantId = this.tenant.tenantId;
    const [viewers, newViewers, paidOrders, revenue, unlocks, activeRows, liveSeries, publishedEpisodes, top] = await Promise.all([
      this.prisma.client.user.count({ where: { accountId: { not: null }, deletedAt: null } }),
      this.prisma.client.user.count({ where: { accountId: { not: null }, createdAt: { gte: d7 } } }),
      this.prisma.client.order.count({ where: { status: 'SUCCEEDED', paidAt: { gte: d30 } } }),
      this.prisma.client.order.groupBy({ by: ['currencyCode'], where: { status: 'SUCCEEDED', paidAt: { gte: d30 } }, _sum: { amountMinor: true } }),
      this.prisma.client.entitlement.count({ where: { originTenantId: tenantId, grantedAt: { gte: d30 } } }),
      this.prisma.client.watchProgress.groupBy({ by: ['accountId'], where: { updatedAt: { gte: d7 } } }),
      this.prisma.client.tenantSeries.count({ where: { status: 'LIVE' } }),
      this.prisma.client.episode.count({ where: { status: 'PUBLISHED' } }),
      this.prisma.client.watchProgress.groupBy({
        by: ['seriesId'], where: { updatedAt: { gte: d30 } }, _count: { accountId: true },
        orderBy: { _count: { accountId: 'desc' } }, take: 5,
      }),
    ]);
    const series = await this.prisma.client.series.findMany({
      where: { id: { in: top.map((t) => t.seriesId) } },
      select: { id: true, titleFr: true, posterUrl: true },
    });
    const byId = new Map(series.map((s) => [s.id, s]));
    const daily = await this.prisma.runRawInTenantScope((tx) =>
      tx.$queryRaw<{ day: Date; orders: bigint; amount: bigint | null }[]>`
        SELECT date_trunc('day', paid_at) AS day, count(*) AS orders, sum(amount_minor) AS amount
        FROM orders WHERE status = 'SUCCEEDED' AND paid_at >= ${d30} AND tenant_id = ${tenantId}::uuid
        GROUP BY 1 ORDER BY 1`,
    );
    return {
      viewers,
      newViewers7d: newViewers,
      activeViewers7d: activeRows.length,
      paidOrders30d: paidOrders,
      revenue30d: revenue.map((r) => ({ currencyCode: r.currencyCode, amountMinor: r._sum.amountMinor ?? 0 })),
      unlocks30d: unlocks,
      liveSeries,
      publishedEpisodes,
      topSeries30d: top.map((t) => ({ seriesId: t.seriesId, title: byId.get(t.seriesId)?.titleFr ?? '—', posterUrl: byId.get(t.seriesId)?.posterUrl ?? null, viewers: t._count.accountId })),
      revenueByDay30d: daily.map((d) => ({ day: d.day, orders: Number(d.orders), amountMinor: Number(d.amount ?? 0) })),
    };
  }
}

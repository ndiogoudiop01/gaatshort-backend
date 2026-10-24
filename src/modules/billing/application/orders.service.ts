import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { PAYMENT_PROVIDER, type PaymentProviderPort } from '../domain/ports/payment-provider.port';

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** Référence envoyée au fournisseur : globalement unique, non devinable, lisible au téléphone. */
export function newOrderReference(): string {
  const bytes = randomBytes(10);
  return `GS-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
}

const publicOrder = {
  id: true, reference: true, status: true, coins: true, bonusCoins: true, currencyCode: true, amountMinor: true,
  provider: true, paymentMethod: true, redirectUrl: true, expiresAt: true, paidAt: true, createdAt: true,
} satisfies Prisma.OrderSelect;

/**
 * Commandes de crédits (FLOW-07). Le client ne crédite JAMAIS : la commande est
 * créée PENDING, et seule une notification fournisseur vérifiée la fait passer à
 * SUCCEEDED (PaymentNotificationService), qui crédite le portefeuille.
 */
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly config: AppConfigService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
  ) {}

  public async create(p: { accountId: string; packId: string; idempotencyKey: string; returnUrl?: string }) {
    const existing = await this.prisma.client.order.findFirst({
      where: { accountId: p.accountId, idempotencyKey: p.idempotencyKey },
      select: publicOrder,
    });
    if (existing) return existing;

    const pack = await this.prisma.client.coinPack.findFirst({ where: { id: p.packId, active: true } });
    if (!pack) throw new ResourceNotFoundError('coin_pack', p.packId);

    const reference = newOrderReference();
    const ttl = this.config.payment.orderTtlMinutes;
    const order = await this.prisma.client.order.create({
      data: {
        accountId: p.accountId,
        reference,
        coinPackId: pack.id,
        coins: pack.coins,
        bonusCoins: pack.bonusCoins,
        currencyCode: pack.currencyCode,
        amountMinor: pack.amountMinor,
        provider: this.provider.name,
        idempotencyKey: p.idempotencyKey,
        expiresAt: new Date(Date.now() + ttl * 60_000),
        history: { create: { tenantId: this.tenant.tenantId, toStatus: 'PENDING', cause: 'created' } },
      } as never,
    });

    const api = `${this.config.app.publicUrl.replace(/\/$/, '')}/${this.config.app.globalPrefix}/v1`;
    const fallbackReturn = `${this.config.app.frontendUrl.replace(/\/$/, '')}/boutique/retour?reference=${reference}`;
    const returnUrl = p.returnUrl ?? fallbackReturn;
    try {
      const checkout = await this.provider.createCheckout({
        reference,
        amountMinor: pack.amountMinor,
        currencyCode: pack.currencyCode,
        itemName: `${pack.coins + pack.bonusCoins} crédits`,
        ipnUrl: `${api}/webhooks/paytech`,
        successUrl: this.config.payment.paytech.successUrl ?? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}status=success`,
        cancelUrl: this.config.payment.paytech.cancelUrl ?? `${returnUrl}${returnUrl.includes('?') ? '&' : '?'}status=cancel`,
      });
      await this.prisma.client.order.updateMany({
        where: { id: order.id },
        data: { providerToken: checkout.token, redirectUrl: checkout.redirectUrl },
      });
    } catch (error) {
      await this.prisma.client.order.updateMany({ where: { id: order.id }, data: { status: 'FAILED', failureCode: 'CHECKOUT_FAILED' } });
      throw error;
    }
    return this.prisma.client.order.findFirstOrThrow({ where: { id: order.id }, select: publicOrder });
  }

  /** Une commande expirée se constate à la lecture : pas de tâche planifiée nécessaire. */
  public async getMine(accountId: string, idOrReference: string) {
    const isUuid = /^[0-9a-f-]{36}$/i.test(idOrReference);
    const order = await this.prisma.client.order.findFirst({
      where: { accountId, ...(isUuid ? { id: idOrReference } : { reference: idOrReference }) },
      select: publicOrder,
    });
    if (!order) throw new ResourceNotFoundError('order', idOrReference);
    if (order.status === 'PENDING' && order.expiresAt < new Date()) {
      await this.prisma.client.order.updateMany({ where: { id: order.id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
      await this.prisma.client.orderStatusHistory.create({ data: { orderId: order.id, fromStatus: 'PENDING', toStatus: 'EXPIRED', cause: 'expiry' } as never });
      return { ...order, status: 'EXPIRED' as const };
    }
    return order;
  }

  public async listMine(accountId: string, limit: number) {
    return this.prisma.client.order.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: limit, select: publicOrder });
  }

  public async adminList(q: { status?: string; q?: string; page: number; perPage: number }) {
    const where: Prisma.OrderWhereInput = {
      ...(q.status ? { status: q.status as never } : {}),
      ...(q.q ? { reference: { contains: q.q.toUpperCase() } } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.order.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.perPage, take: q.perPage }),
      this.prisma.client.order.count({ where }),
    ]);
    const accounts = await this.prisma.client.account.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.accountId))] } },
      select: { id: true, phoneE164: true, displayName: true },
    });
    const byId = new Map(accounts.map((a) => [a.id, a]));
    const items = rows.map((r) => ({ ...r, account: byId.get(r.accountId) ?? null }));
    return PaginatedResult.offset(items, total, q.page, q.perPage);
  }

  public async adminGet(id: string) {
    const order = await this.prisma.client.order.findFirst({ where: { id }, include: { history: { orderBy: { createdAt: 'asc' } } } });
    if (!order) throw new ResourceNotFoundError('order', id);
    const [account, events] = await Promise.all([
      this.prisma.client.account.findUnique({ where: { id: order.accountId }, select: { id: true, phoneE164: true, displayName: true } }),
      this.prisma.client.paymentProviderEvent.findMany({ where: { orderReference: order.reference }, orderBy: { receivedAt: 'asc' } }),
    ]);
    return { ...order, account, events };
  }

  public assertFakeEnabled() {
    if (this.provider.name !== 'FAKE') throw new BusinessRuleViolationError('FAKE_PAYMENT_DISABLED', 'Simulation de paiement désactivée');
  }
}

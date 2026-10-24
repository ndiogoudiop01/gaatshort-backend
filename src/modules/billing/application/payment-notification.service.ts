import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { WALLET_FACADE, type WalletFacade } from '@modules/wallet/wallet.facade';
import { PAYMENT_PROVIDER, type PaymentProviderPort } from '../domain/ports/payment-provider.port';

export type NotificationResult =
  | 'PROCESSED' | 'DUPLICATE' | 'REJECTED' | 'UNKNOWN_ORDER' | 'MISMATCH' | 'IGNORED' | 'ALREADY_FINAL';

/**
 * Traitement d'une notification de paiement (05-BACKEND-SCHEMA §7).
 *
 *  1. Conservation dans la boîte de réception (dédupliquée) ;
 *  2. signature invalide → REJECTED, rien n'est crédité ;
 *  3. la marque de la commande est retrouvée par sa référence (fonction SQL
 *     `order_tenant_by_reference`), puis TOUT se passe dans une transaction
 *     posée sur cette marque : verrou de la commande, contrôle montant/devise,
 *     passage à SUCCEEDED, historique, crédit du portefeuille (idempotent par
 *     commande). Deux notifications simultanées : le verrou sérialise, la
 *     seconde voit SUCCEEDED et sort.
 */
@Injectable()
export class PaymentNotificationService {
  private readonly logger = new Logger(PaymentNotificationService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
    @Inject(WALLET_FACADE) private readonly wallet: WalletFacade,
  ) {}

  public async handle(body: Record<string, unknown>, cause: 'webhook' | 'simulation' = 'webhook'): Promise<NotificationResult> {
    const n = this.provider.verifyNotification(body);
    let eventId: string;
    try {
      const event = await this.prisma.client.paymentProviderEvent.create({
        data: {
          provider: this.provider.name,
          dedupeKey: n.dedupeKey,
          eventType: n.eventType,
          signatureValid: n.valid,
          orderReference: n.reference,
          payload: n.safePayload as Prisma.InputJsonValue,
        },
      });
      eventId = event.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return 'DUPLICATE';
      throw error;
    }

    const finish = (status: string, result: NotificationResult, err?: string) =>
      this.prisma.client.paymentProviderEvent
        .update({ where: { id: eventId }, data: { processingStatus: status, processingError: err, processedAt: new Date() } })
        .then(() => result);

    if (!n.valid) {
      this.logger.warn(`Notification ${this.provider.name} à signature invalide (référence ${n.reference ?? '?'})`);
      return finish('REJECTED', 'REJECTED', 'signature invalide');
    }
    if (!n.reference) return finish('IGNORED', 'IGNORED', 'sans référence');

    const rows = await this.prisma.client.$queryRaw<{ t: string | null }[]>`SELECT order_tenant_by_reference(${n.reference}) AS t`;
    const tenantId = rows[0]?.t ?? null;
    if (!tenantId) return finish('ERROR', 'UNKNOWN_ORDER', 'commande inconnue');

    const outcome = await this.prisma.transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM orders WHERE reference = ${n.reference} FOR UPDATE`;
      const orderId = locked[0]?.id;
      if (!orderId) return 'UNKNOWN_ORDER' as const;
      const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });

      if (order.status === 'SUCCEEDED') return 'ALREADY_FINAL' as const;

      if (n.outcome === 'CANCELLED') {
        if (order.status !== 'PENDING') return 'ALREADY_FINAL' as const;
        await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', failureCode: 'CANCELLED_BY_USER' } });
        await tx.orderStatusHistory.create({ data: { tenantId, orderId: order.id, fromStatus: order.status, toStatus: 'CANCELLED', cause } });
        return 'PROCESSED' as const;
      }
      if (n.outcome !== 'PAID') return 'IGNORED' as const;

      if (n.amountMinor !== order.amountMinor || (n.currencyCode ?? order.currencyCode) !== order.currencyCode) {
        this.logger.error(`MONTANT INCOHÉRENT ${order.reference} : reçu ${n.amountMinor} ${n.currencyCode}, attendu ${order.amountMinor} ${order.currencyCode}`);
        return 'MISMATCH' as const;
      }
      // Paiement confirmé sur une commande close (annulée/échouée) : jamais d'écrasement silencieux.
      if (order.status === 'CANCELLED' || order.status === 'FAILED') return 'MISMATCH' as const;

      await tx.order.update({
        where: { id: order.id },
        data: { status: 'SUCCEEDED', paidAt: new Date(), paymentMethod: n.paymentMethod },
      });
      await tx.orderStatusHistory.create({ data: { tenantId, orderId: order.id, fromStatus: order.status, toStatus: 'SUCCEEDED', cause } });
      await this.wallet.creditPurchase({
        accountId: order.accountId,
        orderId: order.id,
        coins: order.coins,
        bonusCoins: order.bonusCoins,
        originTenantId: tenantId,
      });
      return 'PROCESSED' as const;
    }, tenantId);

    if (outcome === 'PROCESSED') return finish('PROCESSED', 'PROCESSED');
    if (outcome === 'MISMATCH') return finish('MISMATCH', 'MISMATCH', 'montant, devise ou statut incohérent');
    if (outcome === 'UNKNOWN_ORDER') return finish('ERROR', 'UNKNOWN_ORDER', 'commande inconnue');
    if (outcome === 'ALREADY_FINAL') return finish('IGNORED', 'ALREADY_FINAL');
    return finish('IGNORED', 'IGNORED');
  }

  /** Paiement simulé : fabrique une notification signée et la fait suivre le chemin réel. */
  public async simulate(reference: string, outcome: 'PAID' | 'CANCELLED'): Promise<NotificationResult> {
    const sign = this.provider.signSimulation?.bind(this.provider);
    if (this.provider.name !== 'FAKE' || !sign) return 'REJECTED';
    const rows = await this.prisma.client.$queryRaw<{ t: string | null }[]>`SELECT order_tenant_by_reference(${reference}) AS t`;
    const tenantId = rows[0]?.t;
    if (!tenantId) return 'UNKNOWN_ORDER';
    const order = await this.prisma.transaction((tx) => tx.order.findFirst({ where: { reference } }), tenantId);
    if (!order) return 'UNKNOWN_ORDER';
    const amountMinor = order.amountMinor;
    return this.handle(
      { reference, outcome, amountMinor, currencyCode: order.currencyCode, signature: sign(reference, outcome, amountMinor) },
      'simulation',
    );
  }
}

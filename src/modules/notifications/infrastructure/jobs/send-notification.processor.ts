import { Processor } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import type { Job } from 'bullmq';
import { MAILER, type MailerPort } from '@shared/kernel/ports/mailer.port';
import { SMS_SENDER, type SmsPort } from '@shared/kernel/ports/sms.port';
import { QUEUE_CONCURRENCY, QUEUES } from '@infra/queue/queue.constants';
import { BaseTenantProcessor } from '@infra/queue/processors/base.processor';
import { TenantAwareJobService, type TenantJobPayload } from '@infra/queue/tenant-aware-job.service';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

interface SendNotificationData {
  readonly userId?: string;
  readonly recipient?: string;
  readonly channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  readonly templateKey: string;
  readonly locale?: string;
  readonly variables: Record<string, unknown>;
  /**
   * Fenêtre anti-doublon en ms (défaut 24 h). `0` = jamais dédupliqué :
   * un export à la demande produit un lien DIFFÉRENT à chaque exécution,
   * donc le deuxième e-mail n'est pas un doublon.
   */
  readonly dedupeWindowMs?: number;
}

/**
 * Envoi des notifications transactionnelles.
 *
 * IDEMPOTENCE : la table `notifications` sert de journal ET de garde-fou.
 * Avant d'envoyer, on vérifie qu'un envoi identique n'est pas déjà parti.
 * Sans cette vérification, un rejeu de job envoie un second « vous êtes
 * présélectionné » au candidat — au mieux embarrassant, au pire alarmant.
 *
 * Mais (destinataire, gabarit, 24 h) ne distingue pas un rejeu d'une
 * SECONDE DEMANDE légitime. Deux garde-fous se complètent :
 *
 *  1. la comparaison porte AUSSI sur la charge utile. Un rejeu de job porte
 *     la même — il reste dédupliqué ; deux messages réellement différents
 *     (deux changements de statut, deux relances à des dates distinctes)
 *     ne se ressemblent plus et partent tous les deux. C'est le comportement
 *     correct par défaut, sans que l'émetteur ait à y penser ;
 *  2. `dedupeWindowMs` laisse malgré tout l'émetteur régler la fenêtre, et
 *     `0` la désactive tout à fait — cf. l'export du vivier, dont chaque
 *     exécution produit un lien différent et pour lequel la protection
 *     contre le rejeu vient du `jobId` déterministe côté BullMQ. À `0`, on
 *     économise aussi la requête.
 *
 * Concurrence (QUEUE_CONCURRENCY) plafonnée : les fournisseurs d'e-mail
 * limitent le débit, dépasser leur seuil dégrade la réputation du domaine.
 */
@Processor(QUEUES.NOTIFICATIONS, { concurrency: QUEUE_CONCURRENCY[QUEUES.NOTIFICATIONS] })
export class SendNotificationProcessor extends BaseTenantProcessor<SendNotificationData> {
  constructor(
    tenantJobs: TenantAwareJobService,
    private readonly prisma: TenantPrismaService,
    @Inject(MAILER) private readonly mailer: MailerPort,
    @Inject(SMS_SENDER) private readonly sms: SmsPort,
  ) {
    super(tenantJobs);
  }

  protected async handle(
    data: SendNotificationData,
    job: Job<TenantJobPayload<SendNotificationData>>,
  ): Promise<unknown> {
    const recipient = await this.resolveRecipient(data);
    if (!recipient) {
      this.logger.warn(`Destinataire introuvable pour ${data.templateKey}`);
      return { skipped: 'NO_RECIPIENT' };
    }

    // `0` = pas de déduplication du tout : on économise aussi la requête.
    const dedupeWindowMs = data.dedupeWindowMs ?? 24 * 3_600_000;
    const alreadySent =
      dedupeWindowMs > 0
        ? await this.prisma.client.notification.findFirst({
            where: {
              recipient,
              templateKey: data.templateKey,
              // Égalité jsonb : l'ordre des clés n'intervient pas. Le prédicat
              // s'applique après le filtre (destinataire, gabarit), déjà
              // sélectif — il ne déclenche pas de parcours de table.
              payload: { equals: (data.variables ?? {}) as never },
              status: { in: ['SENT', 'DELIVERED'] },
              createdAt: { gte: new Date(Date.now() - dedupeWindowMs) },
            },
            select: { id: true },
          })
        : null;
    if (alreadySent) return { skipped: 'ALREADY_SENT', notificationId: alreadySent.id };

    // `tenantId` est injecté par l'extension Prisma tenant-scopée.
    const notification = await this.prisma.client.notification.create({
      data: {
        userId: data.userId,
        recipient,
        channel: data.channel,
        templateKey: data.templateKey,
        locale: data.locale ?? 'fr',
        payload: data.variables,
        attempts: job.attemptsMade + 1,
      } as never,
    });

    try {
      const result =
        data.channel === 'SMS'
          ? await this.sms.send({ to: recipient, body: this.stringify(data.variables.body) })
          : await this.mailer.send({
              to: recipient,
              subject: '',
              template: data.templateKey,
              locale: data.locale,
              variables: data.variables,
            });

      await this.prisma.client.notification.update({
        where: { id: notification.id },
        data: { status: 'SENT', sentAt: new Date(), providerId: result.providerId },
      });
      return { notificationId: notification.id, providerId: result.providerId };
    } catch (error) {
      await this.prisma.client.notification.update({
        where: { id: notification.id },
        data: { status: 'FAILED', error: (error as Error).message },
      });
      throw error; // laisse BullMQ appliquer le backoff exponentiel
    }
  }

  private async resolveRecipient(data: SendNotificationData): Promise<string | null> {
    if (data.recipient) return data.recipient;
    if (!data.userId) return null;
    const user = await this.prisma.client.user.findUnique({
      where: { id: data.userId },
      select: { email: true, phoneE164: true },
    });
    return data.channel === 'SMS' ? (user?.phoneE164 ?? null) : (user?.email ?? null);
  }

  private stringify(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) ?? '';
  }
}

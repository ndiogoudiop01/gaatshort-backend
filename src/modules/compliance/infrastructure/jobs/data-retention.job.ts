import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '@infra/persistence/prisma/prisma.service';

/**
 * US-IG-028 — purge automatique au terme de la durée de conservation.
 *
 * Le RGPD impose une durée LIMITÉE. Sans automatisation, personne ne
 * supprime jamais rien et la base devient un passif juridique croissant.
 *
 * Anonymisation plutôt que suppression pure : les statistiques de cohorte
 * (US-IG-022) doivent survivre à la disparition des données personnelles.
 */
@Injectable()
export class DataRetentionJob {
  private readonly logger = new Logger(DataRetentionJob.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'gdpr-retention' })
  public async purge(): Promise<void> {
    const now = Date.now();
    const rejectedCutoff = new Date(now - this.config.gdpr.rejectedRetentionDays * 86_400_000);
    const generalCutoff = new Date(now - this.config.gdpr.applicationRetentionDays * 86_400_000);

    // Job plateforme : il traverse tous les tenants, d'où le mode privilégié.
    const result = await this.prisma.$privileged(async (tx) => {
      const anonymized = await tx.$executeRaw`
        UPDATE applications
        SET identity = '{}'::jsonb,
            background = '{}'::jsonb,
            motivation = NULL,
            deleted_at = NOW()
        WHERE deleted_at IS NULL
          AND (
            (status IN ('REJECTED','WITHDRAWN') AND decided_at < ${rejectedCutoff})
            OR (created_at < ${generalCutoff})
          )
      `;
      const expiredKeys = await tx.idempotencyKey.deleteMany({ where: { expiresAt: { lt: new Date() } } });
      const expiredChallenges = await tx.authChallenge.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });
      return { anonymized, expiredKeys: expiredKeys.count, expiredChallenges: expiredChallenges.count };
    });

    this.logger.log({ msg: 'Purge RGPD exécutée', ...result });
  }
}

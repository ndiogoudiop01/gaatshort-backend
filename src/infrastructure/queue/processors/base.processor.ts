import { WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { TenantJobPayload } from '../tenant-aware-job.service';
import type { TenantAwareJobService } from '../tenant-aware-job.service';

/**
 * Socle de tous les processors : restaure le contexte tenant, mesure,
 * journalise, et laisse BullMQ gérer le retry exponentiel.
 *
 * RÈGLE : `handle()` doit être idempotent. La livraison est « au moins une
 * fois » (outbox + retry), donc un job PEUT être rejoué. Vérifiez toujours
 * l'état avant d'agir plutôt que d'appliquer un delta aveugle.
 */
export abstract class BaseTenantProcessor<T> extends WorkerHost {
  protected readonly logger = new Logger(this.constructor.name);

  protected constructor(protected readonly tenantJobs: TenantAwareJobService) {
    super();
  }

  public async process(job: Job<TenantJobPayload<T>>): Promise<unknown> {
    const { tenantId, correlationId, data } = job.data;
    const startedAt = Date.now();
    const base = { job: job.name, jobId: job.id, tenantId, correlationId };

    return this.tenantJobs.runInTenant(tenantId, async () => {
      try {
        const result = await this.handle(data, job);
        this.logger.log({ ...base, msg: 'Job traité', durationMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        this.logger.error({
          ...base,
          msg: 'Job en échec',
          durationMs: Date.now() - startedAt,
          attempt: job.attemptsMade + 1,
          maxAttempts: job.opts.attempts,
          err: error,
        });
        throw error;
      }
    });
  }

  protected abstract handle(data: T, job: Job<TenantJobPayload<T>>): Promise<unknown>;
}

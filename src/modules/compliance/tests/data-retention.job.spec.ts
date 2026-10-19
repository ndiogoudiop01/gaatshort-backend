import type { AppConfigService } from '@config/app-config.service';
import type { PrismaService } from '@infra/persistence/prisma/prisma.service';
import { DataRetentionJob } from '../infrastructure/jobs/data-retention.job';

describe('DataRetentionJob', () => {
  it('anonymise les candidatures échues et purge les jetons expirés', async () => {
    const executeRaw = jest.fn(async () => 3);
    const prisma = {
      $privileged: async (fn: (tx: unknown) => unknown) =>
        fn({
          $executeRaw: executeRaw,
          idempotencyKey: { deleteMany: async () => ({ count: 2 }) },
          authChallenge: { deleteMany: async () => ({ count: 1 }) },
        }),
    } as unknown as PrismaService;

    const config = {
      gdpr: { rejectedRetentionDays: 90, applicationRetentionDays: 1095 },
    } as unknown as AppConfigService;

    const job = new DataRetentionJob(prisma, config);
    await expect(job.purge()).resolves.toBeUndefined();
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});

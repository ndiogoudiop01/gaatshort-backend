import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { TenantAwareJobService, TenantJobPayload } from '../queue/tenant-aware-job.service';
import { BaseTenantProcessor } from '../queue/processors/base.processor';

interface TestJobData {
  readonly value: string;
}

class TestProcessor extends BaseTenantProcessor<TestJobData> {
  constructor(
    tenantJobs: TenantAwareJobService,
    private readonly behavior: (data: TestJobData) => Promise<unknown>,
  ) {
    super(tenantJobs);
  }
  protected handle(data: TestJobData): Promise<unknown> {
    return this.behavior(data);
  }
}

function fakeJob(overrides: Partial<Job<TenantJobPayload<TestJobData>>> = {}): Job<TenantJobPayload<TestJobData>> {
  return {
    id: 'job-1',
    name: 'test-job',
    data: { tenantId: 'tenant-1', data: { value: 'x' } },
    attemptsMade: 0,
    opts: { attempts: 3 },
    ...overrides,
  } as Job<TenantJobPayload<TestJobData>>;
}

describe('BaseTenantProcessor', () => {
  it('restaure le contexte du tenant avant de traiter le job', async () => {
    const runInTenant = jest.fn((_tenantId: string, fn: () => Promise<unknown>) => fn());
    const tenantJobs = { runInTenant } as unknown as TenantAwareJobService;
    const processor = new TestProcessor(tenantJobs, async (data) => `handled:${data.value}`);

    const result = await processor.process(fakeJob());

    expect(runInTenant).toHaveBeenCalledWith('tenant-1', expect.any(Function));
    expect(result).toBe('handled:x');
  });

  it('journalise puis relance l’erreur pour laisser BullMQ gérer le retry', async () => {
    const tenantJobs = {
      runInTenant: (_tenantId: string, fn: () => Promise<unknown>) => fn(),
    } as unknown as TenantAwareJobService;
    const processor = new TestProcessor(tenantJobs, async () => {
      throw new Error('échec traitement');
    });
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      processor.process(fakeJob({ data: { tenantId: 'tenant-1', correlationId: 'corr-42', data: { value: 'x' } } })),
    ).rejects.toThrow('échec traitement');

    // Le log d'échec porte la tentative et le correlationId, pour corréler
    // les traces d'un job rejoué.
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'Job en échec', correlationId: 'corr-42', attempt: 1 }),
    );
    errorSpy.mockRestore();
  });

  it('propage le correlationId du payload dans le log de succès', async () => {
    const tenantJobs = {
      runInTenant: (_t: string, fn: () => Promise<unknown>) => fn(),
    } as unknown as TenantAwareJobService;
    const logSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const processor = new TestProcessor(tenantJobs, async () => 'ok');

    await processor.process(
      fakeJob({ data: { tenantId: 'tenant-1', correlationId: 'corr-7', data: { value: 'x' } } }),
    );

    expect(logSpy).toHaveBeenCalledWith(
      expect.objectContaining({ msg: 'Job traité', correlationId: 'corr-7', tenantId: 'tenant-1' }),
    );
    logSpy.mockRestore();
  });
});

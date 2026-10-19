import type { AppConfigService } from '@config/app-config.service';
import { PrismaService } from '../persistence/prisma/prisma.service';

describe('PrismaService', () => {
  it('$privileged active le contournement RLS puis exécute la fonction dans la transaction', async () => {
    const config = { database: { slowQueryMs: 500, logQueries: false } } as unknown as AppConfigService;
    const service = new PrismaService(config);

    const executeRaw = jest.fn(() => Promise.resolve(undefined));
    const tx = { $executeRaw: executeRaw };
    jest
      .spyOn(service, '$transaction')
      .mockImplementation(async (fn: unknown) => (fn as (tx: unknown) => Promise<unknown>)(tx));

    const result = await service.$privileged(async (t) => {
      expect(t).toBe(tx);
      return 'done';
    });

    expect(result).toBe('done');
    expect(executeRaw).toHaveBeenCalledTimes(1);
  });
});

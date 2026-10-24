import { AudienceController } from '../presentation/http/audience.controller';

const anyFn = () => new Proxy({}, { get: (t: Record<string, jest.Mock>, k: string) => (t[k] ??= jest.fn(async () => k)) });
const USER = { id: 'u', accountId: 'acc' } as never;
const ID = '11111111-1111-1111-1111-111111111111';

describe('AudienceController', () => {
  it('spectateurs et tableau de bord', async () => {
    const audience = anyFn();
    const c = new AudienceController(audience as never);
    await c.dashboard(); await c.list({ page: 1, perPage: 20 } as never); await c.detail(ID);
    await c.adjust(ID, { delta: 10, reason: 'geste commercial' }, USER);
    expect(audience.adjust).toHaveBeenCalledWith(ID, 10, 'geste commercial', 'u');
  });
});

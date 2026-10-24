import { WalletController } from '../presentation/http/wallet.controller';

const viewerCtx = { resolve: jest.fn(async () => ({ accountId: 'acc', country: 'SN', locale: 'fr' })) };
const anyFn = () => new Proxy({}, { get: (t: Record<string, jest.Mock>, k: string) => (t[k] ??= jest.fn(async () => k)) });
const USER = { id: 'u', accountId: 'acc' } as never;
const REQ = {} as never;
const ID = '11111111-1111-1111-1111-111111111111';

describe('WalletController', () => {
  it('portefeuille', async () => {
    const wallet = anyFn();
    const c = new WalletController(wallet as never, viewerCtx as never);
    await c.balance(USER); await c.ledger(USER, { limit: 10 }); await c.unlock(ID, USER, REQ);
    expect(wallet.unlock).toHaveBeenCalledWith({ accountId: 'acc', episodeId: ID, country: 'SN', locale: 'fr' });
  });

});

import { StorefrontController } from '../presentation/http/storefront.controller';

const viewerCtx = { resolve: jest.fn(async () => ({ accountId: 'acc', country: 'SN', locale: 'fr' })) };
const anyFn = () => new Proxy({}, { get: (t: Record<string, jest.Mock>, k: string) => (t[k] ??= jest.fn(async () => k)) });
const USER = { id: 'u', accountId: 'acc' } as never;
const REQ = {} as never;
const ID = '11111111-1111-1111-1111-111111111111';

describe('Contrôleurs spectateur et back-office', () => {
  it('vitrine et lecture', async () => {
    const lib = anyFn();
    const c = new StorefrontController(lib as never, viewerCtx as never);
    await c.config(); await c.home(REQ, undefined, {}); await c.genres(REQ, {});
    await c.series(REQ, USER, { page: 1, perPage: 24 }); await c.seriesDetail('slug', REQ, USER, {});
    await c.playback(ID, REQ, undefined, {}); await c.progress(ID, { positionSeconds: 3 }, REQ, USER);
    await c.continueWatching(REQ, USER, {}); await c.favorites(REQ, USER, {});
    await c.addFavorite('slug', REQ, USER); await c.removeFavorite(ID, USER);
    expect(lib.saveProgress).toHaveBeenCalledWith('acc', expect.anything(), ID, 3, false);
    expect(() => c.removeFavorite(ID, { id: 'staff', accountId: null } as never)).toThrow();
  });

});

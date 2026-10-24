import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { LibraryService } from '../application/library.service';

const CARD = { id: 's-1', slug: 'serie', title: 'Série', synopsis: '', posterUrl: null, bannerUrl: null, maturityRating: '13+', releaseYear: null, tags: [], genres: [], episodeCount: 2, freeEpisodes: 1, featured: true, publishedAt: null };
const E1 = { id: 'e-1', number: 1, title: 'É1', durationSeconds: 90, thumbnailUrl: null, isFree: true, priceCoins: 0 };
const E2 = { id: 'e-2', number: 2, title: 'É2', durationSeconds: 90, thumbnailUrl: null, isFree: false, priceCoins: 15 };
const VIEWER = { accountId: 'acc', country: 'SN', locale: 'fr' as const };

function setup() {
  const { prisma, client } = prismaMock();
  const catalog = {
    listGenres: jest.fn(async () => [{ id: 'g', slug: 'drame', name: 'Drame' }]),
    listLiveSeries: jest.fn(async () => ({ items: [CARD], total: 1 })),
    getLiveSeries: jest.fn(async () => ({ ...CARD, episodes: [E1, E2] })),
    getPlayableEpisode: jest.fn(async (id: string) => ({ episode: id === 'e-1' ? E1 : E2, seriesId: 's-1', seriesSlug: 'serie', videoReady: true, subtitles: [], nextEpisodeId: null })),
    signedPlaybackUrl: jest.fn(async () => ({ url: 'https://cdn/x.m3u8', expiresAt: new Date() })),
  };
  const wallet = { unlockedEpisodeIds: jest.fn(async () => new Set<string>()) };
  const s = new LibraryService(prisma, tenantContext({ isFirstParty: false }) as never, catalog, wallet as never);
  return { s, client, catalog, wallet };
}

describe('LibraryService — lecture', () => {
  it('épisode gratuit : URL signée sans connexion', async () => {
    const { s } = setup();
    await expect(s.playback({ ...VIEWER, accountId: null }, 'e-1')).resolves.toMatchObject({ hlsUrl: 'https://cdn/x.m3u8', resumeAtSeconds: 0 });
  });

  it('épisode payant sans droit : 403 EPISODE_LOCKED avec le prix, URL jamais remise', async () => {
    const { s, catalog } = setup();
    await expect(s.playback({ ...VIEWER, accountId: null }, 'e-2')).rejects.toMatchObject({ code: 'EPISODE_LOCKED', details: expect.objectContaining({ priceCoins: 15, loginRequired: true }) });
    await expect(s.playback(VIEWER, 'e-2')).rejects.toMatchObject({ details: expect.objectContaining({ loginRequired: false }) });
    expect(catalog.signedPlaybackUrl).not.toHaveBeenCalled();
  });

  it('épisode payant débloqué : URL + reprise', async () => {
    const { s, wallet, client } = setup();
    wallet.unlockedEpisodeIds.mockResolvedValueOnce(new Set(['e-2']));
    client.watchProgress.findFirst.mockResolvedValueOnce({ positionSeconds: 42, completed: false });
    await expect(s.playback(VIEWER, 'e-2')).resolves.toMatchObject({ resumeAtSeconds: 42 });
  });

  it('vidéo pas prête : 404', async () => {
    const { s, catalog } = setup();
    catalog.getPlayableEpisode.mockResolvedValueOnce({ episode: E1, seriesId: 's-1', seriesSlug: 'serie', videoReady: false, subtitles: [], nextEpisodeId: null });
    await expect(s.playback(VIEWER, 'e-1')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

describe('LibraryService — vitrine et bibliothèque', () => {
  it('fiche série : état de chaque épisode, favori et reprise pour un compte', async () => {
    const { s, client, wallet } = setup();
    wallet.unlockedEpisodeIds.mockResolvedValueOnce(new Set(['e-2']));
    client.favorite.findFirst.mockResolvedValueOnce({ seriesId: 's-1' });
    client.watchProgress.findMany.mockResolvedValueOnce([{ episodeId: 'e-2', positionSeconds: 30, completed: false }]);
    const d = await s.seriesDetail(VIEWER, 'serie');
    expect(d.isFavorite).toBe(true);
    expect(d.resume).toEqual({ episodeId: 'e-2', positionSeconds: 30, completed: false });
    expect(d.episodes.map((e) => e.unlocked)).toEqual([true, true]);
    const anon = await s.seriesDetail({ ...VIEWER, accountId: null }, 'serie');
    expect(anon.episodes.map((e) => e.unlocked)).toEqual([true, false]);
  });

  it('accueil : mises en avant, rangées non vides, genres', async () => {
    const { s, client } = setup();
    client.watchProgress.groupBy.mockResolvedValueOnce([{ seriesId: 's-1' }]);
    const h = await s.home(VIEWER);
    expect(h.featured).toEqual([CARD]);
    expect(h.rows.map((r) => r.key)).toEqual(['new', 'popular', 'genre:drame']);
  });

  it('configuration : mention du compte unique sur une marque tierce (Q-08)', async () => {
    const { s, client } = setup();
    client.tenant.findUnique.mockResolvedValueOnce({ name: 'Kaay Drama', isFirstParty: false, branding: {} });
    await expect(s.config()).resolves.toMatchObject({ name: 'Kaay Drama', accountNotice: 'Connexion avec votre compte Gaatshort' });
  });

  it('progression, reprendre, favoris', async () => {
    const { s, client } = setup();
    await expect(s.saveProgress('acc', VIEWER, 'e-1', 40, false)).resolves.toEqual({ saved: true });
    expect(client.watchProgress.upsert.mock.calls[0][0].where).toEqual({ tenantId_accountId_episodeId: { tenantId: 't-1', accountId: 'acc', episodeId: 'e-1' } });
    client.watchProgress.findMany.mockResolvedValueOnce([
      { seriesId: 's-1', episodeId: 'e-2', positionSeconds: 10, completed: false, updatedAt: new Date() },
      { seriesId: 's-1', episodeId: 'e-1', positionSeconds: 90, completed: true, updatedAt: new Date() },
    ]);
    await expect(s.continueWatching('acc', VIEWER)).resolves.toMatchObject([{ episodeId: 'e-2', positionSeconds: 10 }]);
    client.watchProgress.findMany.mockResolvedValueOnce([]);
    await expect(s.continueWatching('acc', VIEWER)).resolves.toEqual([]);
    client.favorite.findMany.mockResolvedValueOnce([{ seriesId: 's-1' }]);
    await expect(s.favorites('acc', VIEWER)).resolves.toEqual([CARD]);
    client.favorite.findMany.mockResolvedValueOnce([]);
    await expect(s.favorites('acc', VIEWER)).resolves.toEqual([]);
    await expect(s.addFavorite('acc', VIEWER, 'serie')).resolves.toEqual({ isFavorite: true });
    await expect(s.removeFavorite('acc', 's-1')).resolves.toEqual({ isFavorite: false });
    await expect(s.listGenres(VIEWER)).resolves.toHaveLength(1);
    await expect(s.listSeries(VIEWER, { page: 1, perPage: 24 })).resolves.toMatchObject({ meta: { total: 1, hasMore: false } });
  });
});

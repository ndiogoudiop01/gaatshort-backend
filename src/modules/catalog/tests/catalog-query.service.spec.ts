import type { AppConfigService } from '@config/app-config.service';
import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { CatalogQueryService } from '../application/catalog-query.service';

const NOW = Date.now();
const LIC = (territories: string[], sub = false) => ({ license: { startsAt: new Date(NOW - 1e9), endsAt: new Date(NOW + 1e9), territories, sublicensingAllowed: sub } });
const row = (id: string, over: Record<string, unknown> = {}) => ({
  id, slug: id, status: 'PUBLISHED', deletedAt: null, titleFr: `Titre ${id}`, titleEn: `Title ${id}`, synopsisFr: 'fr', synopsisEn: null,
  posterUrl: null, bannerUrl: null, maturityRating: '13+', releaseYear: 2026, tags: [], freeEpisodes: 5, episodePriceCoins: 15,
  publishedAt: new Date(NOW - Number(id.slice(-1)) * 1000), genres: [{ genre: { id: 'g', slug: 'drame', nameFr: 'Drame', nameEn: 'Drama' } }],
  licenses: [LIC(['SN'])], _count: { episodes: 2 }, ...over,
});

function setup(firstParty = true) {
  const { prisma, client } = prismaMock();
  client.tenantSeries.findMany.mockResolvedValue([
    { seriesId: 's1', featured: true, position: 2, freeEpisodesOverride: null, episodePriceCoinsOverride: null },
    { seriesId: 's2', featured: false, position: 1, freeEpisodesOverride: 1, episodePriceCoinsOverride: 20 },
  ]);
  const video = { signedPlaybackUrl: jest.fn(() => ({ url: 'u', expiresAt: new Date() })) };
  const cfg = { video: { playbackTtlSeconds: 60 } } as unknown as AppConfigService;
  return { s: new CatalogQueryService(prisma, cfg, tenantContext({ isFirstParty: firstParty }) as never, video as never), client, video };
}

describe('CatalogQueryService', () => {
  it('ne liste que les séries diffusées par la marque et licenciées dans le pays', async () => {
    const { s, client } = setup();
    client.series.findMany.mockResolvedValueOnce([row('s1'), row('s2', { licenses: [LIC(['GM'])] })]);
    const { items, total } = await s.listLiveSeries({ country: 'SN', locale: 'en' });
    expect(total).toBe(1);
    expect(items[0]).toMatchObject({ id: 's1', title: 'Title s1', synopsis: 'fr', featured: true, genres: [{ name: 'Drama' }] });
  });

  it('marque tierce : exige le droit de sous-licence ; tri par nouveauté et par position', async () => {
    const third = setup(false);
    third.client.series.findMany.mockResolvedValueOnce([row('s1'), row('s2', { licenses: [LIC(['SN'], true)] })]);
    await expect(third.s.listLiveSeries({ country: 'SN', locale: 'fr' })).resolves.toMatchObject({ total: 1, items: [{ id: 's2' }] });

    const { s, client } = setup();
    client.series.findMany.mockResolvedValue([row('s1'), row('s2')]);
    expect((await s.listLiveSeries({ country: 'SN', locale: 'fr', sort: 'new' })).items.map((i) => i.id)).toEqual(['s1', 's2']);
    expect((await s.listLiveSeries({ country: 'SN', locale: 'fr' })).items.map((i) => i.id)).toEqual(['s2', 's1']);
    expect((await s.listLiveSeries({ country: 'SN', locale: 'fr', ids: ['s1', 's2'] })).items.map((i) => i.id)).toEqual(['s1', 's2']);
    await expect(s.listLiveSeries({ country: 'SN', locale: 'fr', ids: ['zz'] })).resolves.toEqual({ items: [], total: 0 });
    expect((await s.listLiveSeries({ country: 'SN', locale: 'fr', featuredOnly: true, q: 'x', genreSlug: 'drame' })).total).toBe(2);
  });

  it('fiche : épisodes avec gratuité et prix effectifs (surcharges de la marque)', async () => {
    const { s, client } = setup();
    client.series.findFirst.mockResolvedValueOnce({
      ...row('s2'),
      episodes: [
        { id: 'e1', number: 1, titleFr: null, titleEn: null, durationSeconds: 90, thumbnailUrl: null, priceCoinsOverride: null },
        { id: 'e2', number: 2, titleFr: 'Deux', titleEn: null, durationSeconds: 90, thumbnailUrl: null, priceCoinsOverride: 30 },
      ],
    });
    const d = await s.getLiveSeries('s2', 'SN', 'en');
    expect(d.freeEpisodes).toBe(1);
    expect(d.episodes).toMatchObject([{ title: 'Episode 1', isFree: true }, { title: 'Deux', isFree: false, priceCoins: 20 }]);
    client.series.findFirst.mockResolvedValueOnce(null);
    await expect(s.getLiveSeries('nope', 'SN', 'fr')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('épisode jouable : 404 si non diffusé ; épisode suivant ; URL signée seulement si prête', async () => {
    const { s, client, video } = setup();
    const ep = { id: 'e1', seriesId: 's1', number: 1, titleFr: 'Un', titleEn: null, durationSeconds: 90, thumbnailUrl: null, priceCoinsOverride: null, video: { status: 'READY' }, subtitles: [{ locale: 'fr', url: 'v' }], series: row('s1') };
    client.episode.findFirst.mockResolvedValueOnce(ep).mockResolvedValueOnce({ id: 'e2' });
    await expect(s.getPlayableEpisode('e1', 'SN', 'fr')).resolves.toMatchObject({ videoReady: true, nextEpisodeId: 'e2', subtitles: [{ locale: 'fr' }] });
    client.episode.findFirst.mockResolvedValueOnce({ ...ep, seriesId: 'other' });
    await expect(s.getPlayableEpisode('e1', 'SN', 'fr')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    client.episode.findFirst.mockResolvedValueOnce(null);
    await expect(s.getPlayableEpisode('e1', 'SN', 'fr')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    client.episode.findUnique.mockResolvedValueOnce({ video: { status: 'READY', providerRef: 'ref' } });
    await s.signedPlaybackUrl('e1');
    expect(video.signedPlaybackUrl).toHaveBeenCalledWith('ref', 60);
    client.episode.findUnique.mockResolvedValueOnce({ video: { status: 'PROCESSING' } });
    await expect(s.signedPlaybackUrl('e1')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('genres traduits', async () => {
    const { s, client } = setup();
    client.genre.findMany.mockResolvedValueOnce([{ id: 'g', slug: 'drame', nameFr: 'Drame', nameEn: 'Drama' }]);
    await expect(s.listGenres('en')).resolves.toEqual([{ id: 'g', slug: 'drame', name: 'Drama' }]);
  });
});

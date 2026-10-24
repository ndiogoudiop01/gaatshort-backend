import { Prisma } from '@prisma/client';
import { prismaMock, tenantContext } from '@shared/tests/test-utils/prisma-mock';
import { CatalogAdminService } from '../application/catalog-admin.service';
import { MediaService } from '../application/media.service';

const ACTOR = { userId: 'u-1' };
const NOW = new Date();
const LICENSE = { startsAt: new Date(NOW.getTime() - 86_400_000), endsAt: new Date(NOW.getTime() + 86_400_000), territories: ['SN'], sublicensingAllowed: false };
const dup = () => new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '6' });

function seriesRow(over: Record<string, unknown> = {}) {
  return { id: 's-1', slug: 'serie', status: 'DRAFT', publishedAt: null, genres: [], licenses: [{ license: LICENSE }], episodes: [], ...over };
}

function setup(firstParty = true) {
  const { prisma, client } = prismaMock();
  client.series.findFirst.mockResolvedValue(seriesRow());
  client.tenantSeries.findFirst.mockResolvedValue(null);
  const s = new CatalogAdminService(prisma, tenantContext({ isFirstParty: firstParty }) as never);
  return { s, client };
}

describe('CatalogAdminService — séries', () => {
  it('crée une série avec un slug déduit du titre et ses genres', async () => {
    const { s, client } = setup();
    client.series.create.mockResolvedValueOnce({ id: 's-1' });
    await s.createSeries(ACTOR, { titleFr: 'Le Pacte de Ngor', genreIds: ['g-1'] });
    expect(client.series.create.mock.calls[0][0].data).toMatchObject({ slug: 'le-pacte-de-ngor', genres: { create: [{ genreId: 'g-1' }] } });
    expect(client.auditLog.create).toHaveBeenCalled();
  });

  it('slug déjà pris → 409 DUPLICATE_RESOURCE ; titre sans lettres → 422', async () => {
    const { s, client } = setup();
    client.series.create.mockRejectedValueOnce(dup());
    await expect(s.createSeries(ACTOR, { titleFr: 'Doublon' })).rejects.toMatchObject({ status: 409 });
    await expect(s.createSeries(ACTOR, { titleFr: '!!!' })).rejects.toMatchObject({ code: 'SERIES_SLUG_INVALID' });
  });

  it('publication : exige un épisode publié et une licence en cours', async () => {
    const { s, client } = setup();
    await expect(s.publishSeries(ACTOR, 's-1')).rejects.toMatchObject({ code: 'SERIES_HAS_NO_EPISODE' });
    client.series.findFirst.mockResolvedValue(seriesRow({ episodes: [{ status: 'PUBLISHED', _count: { entitlements: 0 } }], licenses: [] }));
    await expect(s.publishSeries(ACTOR, 's-1')).rejects.toMatchObject({ code: 'SERIES_NOT_LICENSED' });
    client.series.findFirst.mockResolvedValue(seriesRow({ episodes: [{ status: 'PUBLISHED', _count: { entitlements: 0 } }] }));
    await s.publishSeries(ACTOR, 's-1');
    expect(client.series.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED' }) }));
  });

  it('dépublier, archiver, modifier, série inconnue → 404', async () => {
    const { s, client } = setup();
    await s.unpublishSeries(ACTOR, 's-1');
    await s.archiveSeries(ACTOR, 's-1');
    await s.updateSeries(ACTOR, 's-1', { titleEn: 'The Pact', genreIds: [] });
    expect(client.series.update).toHaveBeenCalledTimes(3);
    client.series.findFirst.mockResolvedValueOnce(null);
    await expect(s.getSeries('x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('liste : nombre d’épisodes publiés, licence, diffusion par la marque', async () => {
    const { s, client } = setup();
    client.series.findMany.mockResolvedValueOnce([{ ...seriesRow(), titleFr: 'S', genres: [], _count: { episodes: 3 }, updatedAt: NOW }]);
    client.series.count.mockResolvedValueOnce(1);
    client.episode.groupBy.mockResolvedValueOnce([{ seriesId: 's-1', _count: { _all: 2 } }]);
    client.tenantSeries.findMany.mockResolvedValueOnce([{ seriesId: 's-1', status: 'LIVE' }]);
    const page = await s.listSeries({ page: 1, perPage: 20, q: 'pacte', status: 'DRAFT' });
    expect(page.items[0]).toMatchObject({ episodeCount: 3, publishedEpisodeCount: 2, licensed: true, tenantStatus: 'LIVE' });
  });
});

describe('CatalogAdminService — épisodes', () => {
  it('numérote à la suite et crée en lot', async () => {
    const { s, client } = setup();
    client.episode.findFirst.mockResolvedValue({ number: 4 });
    client.episode.create.mockResolvedValueOnce({ id: 'e-5' });
    await s.createEpisode(ACTOR, 's-1', { titleFr: 'Cinq' });
    expect(client.episode.create.mock.calls[0][0].data).toMatchObject({ number: 5, seriesId: 's-1' });
    await expect(s.createEpisodesBulk(ACTOR, 's-1', 3)).resolves.toEqual({ created: 3, fromNumber: 5, toNumber: 7 });
    client.episode.create.mockRejectedValueOnce(dup());
    await expect(s.createEpisode(ACTOR, 's-1', { number: 1 })).rejects.toMatchObject({ status: 409 });
  });

  it('publication d’un épisode : vidéo prête obligatoire', async () => {
    const { s, client } = setup();
    client.episode.findUnique.mockResolvedValue({ id: 'e', video: { status: 'PROCESSING' }, publishedAt: null });
    await expect(s.publishEpisode(ACTOR, 'e')).rejects.toMatchObject({ code: 'EPISODE_VIDEO_NOT_READY' });
    client.episode.findUnique.mockResolvedValue({ id: 'e', video: { status: 'READY', durationSeconds: 99 }, publishedAt: null, durationSeconds: null });
    await s.publishEpisode(ACTOR, 'e');
    expect(client.episode.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'PUBLISHED', durationSeconds: 99 }) }));
    client.episode.findMany.mockResolvedValueOnce([{ id: 'a', video: { durationSeconds: 1 } }, { id: 'b', video: null }]);
    await expect(s.publishReadyEpisodes(ACTOR, 's-1')).resolves.toEqual({ published: 2 });
    await s.withdrawEpisode(ACTOR, 'e');
    await s.updateEpisode(ACTOR, 'e', { titleFr: 'x' });
  });

  it('suppression : seulement un brouillon jamais acheté', async () => {
    const { s, client } = setup();
    client.episode.findUnique.mockResolvedValue({ id: 'e', status: 'DRAFT' });
    client.entitlement.count.mockResolvedValueOnce(2);
    await expect(s.deleteEpisode(ACTOR, 'e')).rejects.toMatchObject({ code: 'EPISODE_IN_USE' });
    client.entitlement.count.mockResolvedValueOnce(0);
    await s.deleteEpisode(ACTOR, 'e');
    expect(client.episode.delete).toHaveBeenCalled();
    client.episode.findUnique.mockResolvedValueOnce(null);
    await expect(s.getEpisode('x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('sous-titres', async () => {
    const { s, client } = setup();
    client.episode.findUnique.mockResolvedValue({ id: 'e' });
    await s.setSubtitle(ACTOR, 'e', 'en', 'https://x/en.vtt');
    expect(client.subtitleTrack.upsert).toHaveBeenCalled();
    await s.removeSubtitle(ACTOR, 'e', 'en');
    expect(client.subtitleTrack.deleteMany).toHaveBeenCalledWith({ where: { episodeId: 'e', locale: 'en' } });
  });
});

describe('CatalogAdminService — genres, licences, vitrine', () => {
  it('genres', async () => {
    const { s, client } = setup();
    client.genre.findMany.mockResolvedValueOnce([]);
    await s.listGenres();
    client.genre.create.mockResolvedValueOnce({ id: 'g' });
    await s.createGenre(ACTOR, { slug: 'drame', nameFr: 'Drame', nameEn: 'Drama' });
    client.genre.findUnique.mockResolvedValue({ id: 'g' });
    await s.updateGenre(ACTOR, 'g', { position: 2 });
    await s.deleteGenre(ACTOR, 'g');
    client.genre.findUnique.mockResolvedValueOnce(null);
    await expect(s.deleteGenre(ACTOR, 'x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('licences : période valide, séries liées', async () => {
    const { s, client } = setup();
    await expect(s.createLicense(ACTOR, { licensorName: 'A', contractRef: 'C', startsAt: '2027-01-01', endsAt: '2026-01-01', territories: ['SN'] }))
      .rejects.toMatchObject({ code: 'LICENSE_PERIOD_INVALID' });
    client.license.create.mockResolvedValueOnce({ id: 'l' });
    await s.createLicense(ACTOR, { licensorName: 'A', contractRef: 'C', startsAt: '2026-01-01', endsAt: '2028-01-01', territories: ['SN'], seriesIds: ['s-1'] });
    expect(client.license.create.mock.calls[0][0].data.series).toEqual({ create: [{ seriesId: 's-1' }] });
    client.license.findUnique.mockResolvedValue({ id: 'l', startsAt: new Date('2026-01-01'), endsAt: new Date('2028-01-01') });
    await s.updateLicense(ACTOR, 'l', { seriesIds: [], endsAt: '2029-01-01' });
    await s.deleteLicense(ACTOR, 'l');
    client.license.findMany.mockResolvedValueOnce([{ id: 'l', series: [{ series: { id: 's-1' } }] }]);
    await expect(s.listLicenses()).resolves.toEqual([{ id: 'l', series: [{ id: 's-1' }] }]);
    client.license.findUnique.mockResolvedValue(null);
    await expect(s.updateLicense(ACTOR, 'x', {})).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    await expect(s.deleteLicense(ACTOR, 'x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('diffusion par une marque : série publiée et licence adaptée exigées', async () => {
    const { s, client } = setup(false);
    await expect(s.setTenantSeries(ACTOR, 's-1', { status: 'LIVE' })).rejects.toMatchObject({ code: 'SERIES_NOT_PUBLISHED' });
    client.series.findFirst.mockResolvedValue(seriesRow({ status: 'PUBLISHED' }));
    // Marque tierce + licence sans sous-licence → refus (R-02).
    await expect(s.setTenantSeries(ACTOR, 's-1', { status: 'LIVE' })).rejects.toMatchObject({ code: 'SERIES_NOT_LICENSED_FOR_TENANT' });
    await s.setTenantSeries(ACTOR, 's-1', { status: 'HIDDEN' });
    expect(client.tenantSeries.upsert.mock.calls[0][0].where).toEqual({ tenantId_seriesId: { tenantId: 't-1', seriesId: 's-1' } });
    client.series.findFirst.mockResolvedValueOnce(null);
    await expect(s.setTenantSeries(ACTOR, 'x', { status: 'LIVE' })).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });

  it('liste de la vitrine : état de diffusion par série', async () => {
    const { s, client } = setup();
    client.series.findMany.mockResolvedValueOnce([{ id: 's-1', slug: 'x', titleFr: 'X', posterUrl: null, freeEpisodes: 5, episodePriceCoins: 15, licenses: [{ license: LICENSE }], _count: { episodes: 2 } }]);
    client.tenantSeries.findMany.mockResolvedValueOnce([{ seriesId: 's-1', status: 'LIVE', featured: true, position: 1 }]);
    await expect(s.listTenantSeries({ status: 'LIVE' })).resolves.toMatchObject([{ status: 'LIVE', featured: true, licensedForTenant: true }]);
  });
});

describe('MediaService', () => {
  function media(name: 'FAKE' | 'BUNNY_STREAM') {
    const { prisma, client } = prismaMock();
    const video = {
      name,
      createDirectUpload: jest.fn(async () => ({ providerRef: 'ref', endpoint: name === 'FAKE' ? null : 'https://tus', headers: { a: 'b' } })),
      ingestFromUrl: jest.fn(async () => ({ providerRef: 'ref' })),
      getState: jest.fn(async () => ({ status: 'READY', durationSeconds: 120, width: 1080, height: 1920, thumbnailUrl: 'https://t.jpg', failureReason: null })),
      deleteVideo: jest.fn(async () => undefined),
      signedPlaybackUrl: jest.fn(),
    };
    client.episode.findUnique.mockResolvedValue({ id: 'e', number: 3, videoAssetId: 'old', series: { slug: 'serie' } });
    client.mediaAsset.create.mockResolvedValue({ id: 'm-1', providerRef: 'ref' });
    client.mediaAsset.findUnique.mockResolvedValue({ id: 'm-1', providerRef: 'ref' });
    client.mediaAsset.update.mockResolvedValue({ id: 'm-1', status: 'READY' });
    return { m: new MediaService(prisma, video as never), client, video };
  }

  it('pilote factice : vidéo prête tout de suite, l’ancienne est supprimée chez le fournisseur', async () => {
    const { m, client, video } = media('FAKE');
    await expect(m.createEpisodeUpload(ACTOR, 'e')).resolves.toMatchObject({ upload: null, asset: { status: 'READY' } });
    expect(video.deleteVideo).toHaveBeenCalledWith('ref');
    expect(client.episode.updateMany).toHaveBeenCalledWith({ where: { videoAssetId: 'm-1', durationSeconds: null }, data: { durationSeconds: 120 } });
  });

  it('remplacer la vidéo retire la miniature de l’ancienne, garde une miniature posée à la main', async () => {
    const { m, client } = media('BUNNY_STREAM');
    client.mediaAsset.findUnique.mockResolvedValueOnce({ id: 'old', providerRef: 'old-ref', thumbnailUrl: 'https://cdn/old.jpg' });
    client.episode.findUnique
      .mockResolvedValueOnce({ id: 'e', number: 3, videoAssetId: 'old', series: { slug: 'serie' } })
      .mockResolvedValueOnce({ thumbnailUrl: 'https://cdn/old.jpg' });
    await m.ingestEpisodeFromUrl(ACTOR, 'e', 'https://src');
    expect(client.episode.update).toHaveBeenLastCalledWith({ where: { id: 'e' }, data: { videoAssetId: 'm-1', durationSeconds: null, thumbnailUrl: null } });

    client.mediaAsset.findUnique.mockResolvedValueOnce({ id: 'old', providerRef: 'old-ref', thumbnailUrl: 'https://cdn/old.jpg' });
    client.episode.findUnique
      .mockResolvedValueOnce({ id: 'e', number: 3, videoAssetId: 'old', series: { slug: 'serie' } })
      .mockResolvedValueOnce({ thumbnailUrl: 'https://cdn/affiche-maison.jpg' });
    await m.ingestEpisodeFromUrl(ACTOR, 'e', 'https://src');
    expect(client.episode.update).toHaveBeenLastCalledWith({ where: { id: 'e' }, data: { videoAssetId: 'm-1', durationSeconds: null } });
  });

  it('Bunny : renvoie le ticket TUS ; import par URL', async () => {
    const { m } = media('BUNNY_STREAM');
    await expect(m.createEpisodeUpload(ACTOR, 'e')).resolves.toMatchObject({ upload: { endpoint: 'https://tus', headers: { a: 'b' } } });
    await expect(m.ingestEpisodeFromUrl(ACTOR, 'e', 'https://src')).resolves.toMatchObject({ id: 'm-1' });
  });

  it('webhook : référence inconnue ignorée, connue relue chez le fournisseur', async () => {
    const { m, client, video } = media('BUNNY_STREAM');
    client.mediaAsset.findFirst.mockResolvedValueOnce(null);
    await expect(m.onProviderWebhook('x')).resolves.toEqual({ handled: false });
    client.mediaAsset.findFirst.mockResolvedValueOnce({ id: 'm-1' });
    await expect(m.onProviderWebhook('ref')).resolves.toEqual({ handled: true });
    expect(video.getState).toHaveBeenCalledWith('ref');
    client.episode.findUnique.mockResolvedValueOnce(null);
    await expect(m.createEpisodeUpload(ACTOR, 'x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
    client.mediaAsset.findUnique.mockResolvedValueOnce(null);
    await expect(m.refresh('x')).rejects.toMatchObject({ code: 'RESOURCE_NOT_FOUND' });
  });
});

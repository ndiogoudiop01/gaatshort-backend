import { ConflictException } from '@nestjs/common';
import { prismaMock } from '@shared/tests/test-utils/prisma-mock';
import { CatalogImportService } from '../application/catalog-import.service';

const ACTOR = { userId: 'u-1' };
const CSV = [
  'series_title,genres,free_episodes,episode_number,episode_title,video_url',
  'Le Pacte de Ngor,drame|inconnu,3,1,Le retour,https://src.test/1.mp4',
  'Le Pacte de Ngor,,,2,,https://src.test/2.mp4',
  'Le Pacte de Ngor,,,3,,',
].join('\n');

function setup() {
  const { prisma, client } = prismaMock();
  client.genre.findMany.mockResolvedValue([{ id: 'g-drame', slug: 'drame' }]);
  const catalog = {
    createSeries: jest.fn(async () => ({ id: 's-new' })),
    updateSeries: jest.fn(async () => ({})),
    createEpisode: jest.fn(async (_a: unknown, _s: string, i: { number: number }) => ({ id: `e-${i.number}` })),
    updateEpisode: jest.fn(async () => ({})),
  };
  const media = { ingestEpisodeFromUrl: jest.fn(async (_a: unknown, _id: string, _url: string) => ({})) };
  const s = new CatalogImportService(prisma, catalog as never, media as never);
  return { s, client, catalog, media };
}

const EXISTING = {
  id: 's-1', titleFr: 'Le Pacte de Ngor', synopsisFr: '', maturityRating: '13+', releaseYear: null, freeEpisodes: 3,
  episodePriceCoins: 15, posterUrl: null, bannerUrl: null, deletedAt: null, genres: [{ genreId: 'g-drame' }],
};

describe('CatalogImportService', () => {
  it('essai à blanc : annonce les créations sans rien écrire', async () => {
    const { s, client, catalog, media } = setup();
    client.series.findUnique.mockResolvedValueOnce(null);
    const r = await s.import(ACTOR, CSV, true);
    expect(r.totals).toMatchObject({ rows: 3, seriesCreated: 1, episodesCreated: 3, videosQueued: 2, errors: 0 });
    expect(r.warnings[0].message).toContain('inconnu');
    expect(catalog.createSeries).not.toHaveBeenCalled();
    expect(catalog.createEpisode).not.toHaveBeenCalled();
    expect(media.ingestEpisodeFromUrl).not.toHaveBeenCalled();
    expect(client.auditLog.create).not.toHaveBeenCalled();
  });

  it('import réel : crée la série (genres connus), les épisodes et lance les vidéos', async () => {
    const { s, client, catalog, media } = setup();
    client.series.findUnique.mockResolvedValueOnce(null);
    client.episode.findMany.mockResolvedValueOnce([]);
    const r = await s.import(ACTOR, CSV, false);
    expect(catalog.createSeries).toHaveBeenCalledWith(ACTOR, expect.objectContaining({ slug: 'le-pacte-de-ngor', freeEpisodes: 3, genreIds: ['g-drame'] }));
    expect(catalog.createEpisode.mock.calls.map((c) => c[2])).toEqual([
      { number: 1, titleFr: 'Le retour', priceCoinsOverride: undefined },
      { number: 2, titleFr: undefined, priceCoinsOverride: undefined },
      { number: 3, titleFr: undefined, priceCoinsOverride: undefined },
    ]);
    expect(media.ingestEpisodeFromUrl.mock.calls.map((c) => [c[1], c[2]])).toEqual([['e-1', 'https://src.test/1.mp4'], ['e-2', 'https://src.test/2.mp4']]);
    expect(r.series[0]).toMatchObject({ action: 'CREATED', id: 's-new' });
    expect(client.auditLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'catalog.import.completed' }) });
  });

  it('rejouer le même fichier ne change rien et ne relance aucun encodage', async () => {
    const { s, client, catalog, media } = setup();
    client.series.findUnique.mockResolvedValueOnce(EXISTING);
    client.episode.findMany.mockResolvedValueOnce([
      { id: 'e-1', number: 1, titleFr: 'Le retour', priceCoinsOverride: null, video: { status: 'READY' } },
      { id: 'e-2', number: 2, titleFr: null, priceCoinsOverride: null, video: { status: 'PROCESSING' } },
      { id: 'e-3', number: 3, titleFr: null, priceCoinsOverride: null, video: null },
    ]);
    const r = await s.import(ACTOR, CSV, false);
    expect(r.series[0].action).toBe('UNCHANGED');
    expect(r.rows.map((x) => [x.episode, x.video])).toEqual([['UNCHANGED', 'ALREADY_PRESENT'], ['UNCHANGED', 'ALREADY_PRESENT'], ['UNCHANGED', 'NONE']]);
    expect(catalog.updateSeries).not.toHaveBeenCalled();
    expect(catalog.updateEpisode).not.toHaveBeenCalled();
    expect(media.ingestEpisodeFromUrl).not.toHaveBeenCalled();
  });

  it('met à jour seulement ce qui change ; une vidéo en échec est réimportée', async () => {
    const { s, client, catalog, media } = setup();
    client.series.findUnique.mockResolvedValueOnce({ ...EXISTING, freeEpisodes: 5, genres: [] });
    client.episode.findMany.mockResolvedValueOnce([
      { id: 'e-1', number: 1, titleFr: 'Ancien titre', priceCoinsOverride: null, video: { status: 'FAILED' } },
    ]);
    const r = await s.import(ACTOR, CSV, false);
    expect(catalog.updateSeries).toHaveBeenCalledWith(ACTOR, 's-1', { freeEpisodes: 3, genreIds: ['g-drame'] });
    expect(catalog.updateEpisode).toHaveBeenCalledWith(ACTOR, 'e-1', { titleFr: 'Le retour' });
    expect(media.ingestEpisodeFromUrl).toHaveBeenCalledWith(ACTOR, 'e-1', 'https://src.test/1.mp4');
    expect(r.totals).toMatchObject({ seriesUpdated: 1, episodesUpdated: 1, episodesCreated: 2, videosQueued: 2 });
  });

  it('erreurs : série archivée, échec d’une vidéo, erreur Nest lisible', async () => {
    const { s, client, catalog, media } = setup();
    client.series.findUnique.mockResolvedValueOnce({ ...EXISTING, deletedAt: new Date() });
    let r = await s.import(ACTOR, CSV, false);
    expect(r.series[0]).toMatchObject({ action: 'ERROR', message: expect.stringContaining('archivée') });
    expect(r.rows.every((x) => x.episode === 'ERROR')).toBe(true);
    expect(r.totals.errors).toBe(3);

    client.series.findUnique.mockResolvedValueOnce(null);
    catalog.createSeries.mockRejectedValueOnce(new ConflictException({ code: 'DUPLICATE_RESOURCE', message: 'Une série porte déjà ce slug' }));
    r = await s.import(ACTOR, CSV, false);
    expect(r.series[0].message).toBe('Une série porte déjà ce slug');

    client.series.findUnique.mockResolvedValueOnce(null);
    client.episode.findMany.mockResolvedValueOnce([]);
    media.ingestEpisodeFromUrl.mockRejectedValueOnce(new Error('Bunny indisponible'));
    r = await s.import(ACTOR, CSV, false);
    expect(r.rows[0]).toMatchObject({ episode: 'CREATED', video: 'ERROR', message: 'Bunny indisponible' });
    expect(r.rows[1]).toMatchObject({ video: 'QUEUED' });
  });

  it('fichier invalide : rapport d’erreurs, aucune lecture en base', async () => {
    const { s, client } = setup();
    const r = await s.import(ACTOR, 'titre\nA', true);
    expect(r.errors[0].message).toContain('obligatoires');
    expect(r.totals.errors).toBe(1);
    expect(client.series.findUnique).not.toHaveBeenCalled();
  });
});

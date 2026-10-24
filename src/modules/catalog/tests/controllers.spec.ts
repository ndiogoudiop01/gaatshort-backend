import type { AppConfigService } from '@config/app-config.service';
import { AdminCatalogController } from '../presentation/http/admin-catalog.controller';
import { MediaWebhookController } from '../presentation/http/media-webhook.controller';

const anyFn = () => new Proxy({}, { get: (t: Record<string, jest.Mock>, k: string) => (t[k] ??= jest.fn(async () => ({ ok: k }))) });
const USER = { id: 'u-1' } as never;
const ID = '11111111-1111-1111-1111-111111111111';

describe('AdminCatalogController', () => {
  it('relaie chaque route au service, champ par champ, avec l’acteur', async () => {
    const catalog = anyFn();
    const media = anyFn();
    const c = new AdminCatalogController(catalog as never, media as never);
    await c.listGenres();
    await c.createGenre({ slug: 'a', nameFr: 'A', nameEn: 'A' }, USER);
    await c.updateGenre(ID, { position: 1 }, USER);
    await c.deleteGenre(ID, USER);
    await c.listSeries({ page: 1, perPage: 20, status: 'DRAFT', q: 'x' } as never);
    await c.createSeries({ titleFr: 'T', extra: 'ignoré' } as never, USER);
    expect(catalog.createSeries.mock.calls[0][1]).not.toHaveProperty('extra');
    await c.getSeries(ID);
    await c.updateSeries(ID, { titleEn: 'T' }, USER);
    await c.publishSeries(ID, USER);
    await c.unpublishSeries(ID, USER);
    await c.archiveSeries(ID, USER);
    await c.createEpisode(ID, { number: 2 }, USER);
    await c.bulkEpisodes(ID, { count: 3 }, USER);
    await c.publishReady(ID, USER);
    await c.getEpisode(ID);
    await c.updateEpisode(ID, { titleFr: 'x' }, USER);
    await c.publishEpisode(ID, USER);
    await c.withdrawEpisode(ID, USER);
    await c.deleteEpisode(ID, USER);
    await c.createUpload(ID, USER);
    await c.ingest(ID, { sourceUrl: 'https://x' }, USER);
    await c.refresh(ID);
    await c.setSubtitle(ID, 'en', { url: 'https://x.vtt' }, USER);
    await c.removeSubtitle(ID, 'fr', USER);
    await c.listLicenses();
    await c.createLicense({ licensorName: 'L', contractRef: 'C', startsAt: '2026-01-01', endsAt: '2027-01-01', territories: ['SN'] }, USER);
    await c.updateLicense(ID, { notes: 'n' }, USER);
    await c.deleteLicense(ID, USER);
    await c.tenantSeries({ q: 'x' });
    await c.setTenantSeries(ID, { status: 'LIVE', featured: true }, USER);
    expect(catalog.setSubtitle).toHaveBeenCalledWith({ userId: 'u-1' }, ID, 'en', 'https://x.vtt');
    expect(catalog.setTenantSeries.mock.calls[0][2]).toMatchObject({ status: 'LIVE', featured: true });
    expect(media.createEpisodeUpload).toHaveBeenCalledWith({ userId: 'u-1' }, ID);
  });
});

describe('MediaWebhookController', () => {
  const cfg = { video: { bunny: { webhookSecret: 'secret-1', libraryId: '42' } } } as unknown as AppConfigService;

  it('refuse un segment secret erroné (404), ignore une autre bibliothèque, traite sinon', async () => {
    const media = { onProviderWebhook: jest.fn(async () => ({ handled: true })) };
    const c = new MediaWebhookController(media as never, cfg);
    await expect(c.receive('mauvais!', {})).rejects.toMatchObject({ status: 404 });
    await expect(c.receive('secret-1', { VideoLibraryId: 7, VideoGuid: 'g' })).resolves.toEqual({ handled: false });
    await expect(c.receive('secret-1', { VideoLibraryId: 42, VideoGuid: 'g', Status: 3 })).resolves.toEqual({ handled: true });
    expect(media.onProviderWebhook).toHaveBeenCalledWith('g');
  });
});

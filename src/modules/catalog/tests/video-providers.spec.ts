import { createHash, createHmac } from 'node:crypto';
import type { AppConfigService } from '@config/app-config.service';
import { BunnyVideoProvider } from '../infrastructure/video/bunny-video.provider';
import { FakeVideoProvider } from '../infrastructure/video/fake-video.provider';
import { signBunnyDirectoryUrl } from '../infrastructure/video/bunny-sign';

const CONFIG = {
  video: {
    fakeHlsUrl: 'https://test-streams.example/x.m3u8',
    bunny: { libraryId: '123', apiKey: 'api-key', cdnHost: 'vz-1.b-cdn.net', tokenKey: 'token-key', webhookSecret: 's' },
  },
} as unknown as AppConfigService;

describe('Signature Bunny (HS256, mode répertoire)', () => {
  it('reproduit l’algorithme officiel : HMAC(clé, chemin + expiration + token_path=…)', () => {
    const url = signBunnyDirectoryUrl({ host: 'vz-1.b-cdn.net', securityKey: 'k', directory: '/abc/', file: 'playlist.m3u8', expires: 1_900_000_000 });
    const h = createHmac('sha256', 'k');
    h.update('/abc/');
    h.update('1900000000');
    h.update('token_path=/abc/');
    const token = 'HS256-' + h.digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(url).toBe(`https://vz-1.b-cdn.net/bcdn_token=${token}&token_path=%2Fabc%2F&expires=1900000000/abc/playlist.m3u8`);
  });
});

describe('BunnyVideoProvider', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  const ok = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });

  it('prépare un téléversement TUS signé sha256(library + clé + expiration + guid)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ guid: 'g-1' }));
    const ticket = await new BunnyVideoProvider(CONFIG).createDirectUpload('serie — épisode 1');
    const expire = ticket.headers.AuthorizationExpire;
    expect(ticket.providerRef).toBe('g-1');
    expect(ticket.endpoint).toBe('https://video.bunnycdn.com/tusupload');
    expect(ticket.headers.AuthorizationSignature).toBe(createHash('sha256').update(`123api-key${expire}g-1`).digest('hex'));
    expect(fetchMock.mock.calls[0][0]).toBe('https://video.bunnycdn.com/library/123/videos');
  });

  it('importe par URL puis lit l’état (4 = prête, 5 = échec)', async () => {
    fetchMock.mockResolvedValueOnce(ok({ guid: 'g-2' })).mockResolvedValueOnce(ok({}));
    const p = new BunnyVideoProvider(CONFIG);
    await expect(p.ingestFromUrl('t', 'https://src/x.mp4')).resolves.toEqual({ providerRef: 'g-2' });
    fetchMock.mockResolvedValueOnce(ok({ guid: 'g-2', status: 4, length: 95.4, width: 1080, height: 1920, thumbnailFileName: 'thumb.jpg' }));
    await expect(p.getState('g-2')).resolves.toMatchObject({ status: 'READY', durationSeconds: 95, thumbnailUrl: 'https://vz-1.b-cdn.net/g-2/thumb.jpg' });
    fetchMock.mockResolvedValueOnce(ok({ guid: 'g-2', status: 5, length: 0, width: 0, height: 0 }));
    await expect(p.getState('g-2')).resolves.toMatchObject({ status: 'FAILED', durationSeconds: null });
    fetchMock.mockResolvedValueOnce(ok({ guid: 'g-2', status: 2, length: 0, width: 0, height: 0 }));
    await expect(p.getState('g-2')).resolves.toMatchObject({ status: 'PROCESSING' });
  });

  it('remonte une erreur si Bunny refuse', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => '' });
    await expect(new BunnyVideoProvider(CONFIG).deleteVideo('g')).rejects.toThrow('401');
  });

  it('signe une URL de lecture qui expire', () => {
    const { url, expiresAt } = new BunnyVideoProvider(CONFIG).signedPlaybackUrl('g-3', 60);
    expect(url).toMatch(/^https:\/\/vz-1\.b-cdn\.net\/bcdn_token=HS256-[\w-]+&token_path=%2Fg-3%2F&expires=\d+\/g-3\/playlist\.m3u8$/);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('FakeVideoProvider', () => {
  it('n’a rien à téléverser, la vidéo est prête et lit le flux de démonstration', async () => {
    const p = new FakeVideoProvider(CONFIG);
    const ticket = await p.createDirectUpload('t');
    expect(ticket.endpoint).toBeNull();
    expect((await p.ingestFromUrl('t', 'u')).providerRef).toMatch(/^fake-/);
    expect((await p.getState('x')).status).toBe('READY');
    expect(p.signedPlaybackUrl('x', 10).url).toBe('https://test-streams.example/x.m3u8');
    await expect(p.deleteVideo('x')).resolves.toBeUndefined();
  });
});

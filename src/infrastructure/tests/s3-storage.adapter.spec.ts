import type { AppConfigService } from '@config/app-config.service';

const sendMock = jest.fn();
const createPresignedPostMock = jest.fn(async (..._args: unknown[]) => ({
  url: 'https://s3.example/upload',
  fields: { key: 'x', 'Content-Type': 'application/pdf' },
}));
const getSignedUrlMock = jest.fn(async (..._args: unknown[]) => 'https://s3.example/download');

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
  DeleteObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  GetObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  HeadObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  PutObjectCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));
jest.mock('@aws-sdk/s3-presigned-post', () => ({ createPresignedPost: createPresignedPostMock }));
jest.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: getSignedUrlMock }));

import { S3StorageAdapter } from '../storage/adapters/s3-storage.adapter';

const KEY = 'tenants/t1/applications/app-1/uuid.pdf';

function buildAdapter(over: Partial<Record<string, unknown>> = {}): S3StorageAdapter {
  const config = {
    storage: {
      region: 'eu-west-1',
      endpoint: undefined,
      forcePathStyle: false,
      accessKey: 'key',
      secretKey: 'secret',
      bucket: 'gaatshort',
      presignTtlSeconds: 3600,
      downloadTtlSeconds: 900,
      ...over,
    },
  } as unknown as AppConfigService;
  return new S3StorageAdapter(config);
}

describe('S3StorageAdapter', () => {
  beforeEach(() => {
    sendMock.mockReset();
    createPresignedPostMock.mockClear();
    getSignedUrlMock.mockClear();
  });

  describe('createPresignedUpload', () => {
    it('délivre une URL POST signée', async () => {
      const result = await buildAdapter().createPresignedUpload({
        storageKey: KEY,
        mimeType: 'application/pdf',
        maxSizeBytes: 1_000_000,
      });
      expect(result.url).toBe('https://s3.example/upload');
      expect(result.storageKey).toBe(KEY);
      expect(result.expiresAt).toBeInstanceOf(Date);
    });

    it('contraint taille ET type via des Conditions S3 (pas seulement l’API)', async () => {
      await buildAdapter().createPresignedUpload({
        storageKey: KEY,
        mimeType: 'application/pdf',
        maxSizeBytes: 5_242_880,
      });
      const arg = createPresignedPostMock.mock.calls[0][1] as {
        Key: string;
        Conditions: unknown[];
        Fields: Record<string, string>;
      };
      expect(arg.Key).toBe(KEY);
      expect(arg.Conditions).toEqual(
        expect.arrayContaining([
          ['content-length-range', 1, 5_242_880],
          ['eq', '$Content-Type', 'application/pdf'],
        ]),
      );
      expect(arg.Fields['Content-Type']).toBe('application/pdf');
    });

    it('refuse une clé hors périmètre tenant', async () => {
      await expect(
        buildAdapter().createPresignedUpload({
          storageKey: 'etc/passwd',
          mimeType: 'application/pdf',
          maxSizeBytes: 1,
        }),
      ).rejects.toThrow(/périmètre tenant/);
      expect(createPresignedPostMock).not.toHaveBeenCalled();
    });
  });

  describe('createPresignedDownload', () => {
    it('signe une URL GET de 15 min (TTL download dédié, pas le TTL upload)', async () => {
      await buildAdapter().createPresignedDownload(KEY);
      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    });

    it('plafonne le TTL : un appelant qui demande plus n’obtient pas plus', async () => {
      await buildAdapter().createPresignedDownload(KEY, 86_400);
      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 900 });
    });

    it('respecte un TTL plus court demandé explicitement', async () => {
      await buildAdapter().createPresignedDownload(KEY, 60);
      expect(getSignedUrlMock.mock.calls[0][2]).toEqual({ expiresIn: 60 });
    });

    it('refuse une clé hors périmètre tenant', async () => {
      await expect(buildAdapter().createPresignedDownload('public/file.pdf')).rejects.toThrow(
        /périmètre tenant/,
      );
    });
  });

  describe('delete / head / exists', () => {
    it('supprime un objet (clé scopée) et refuse une clé non scopée', async () => {
      sendMock.mockResolvedValue(undefined);
      const adapter = buildAdapter();
      await adapter.delete(KEY);
      expect(sendMock).toHaveBeenCalledTimes(1);
      await expect(adapter.delete('root.key')).rejects.toThrow(/périmètre tenant/);
    });

    it('renvoie les métadonnées d’un objet existant', async () => {
      sendMock.mockResolvedValue({ ContentLength: 1234, ContentType: 'application/pdf' });
      expect(await buildAdapter().headObject(KEY)).toEqual({
        sizeBytes: 1234,
        mimeType: 'application/pdf',
      });
    });

    it('renvoie null pour un objet introuvable plutôt que de lever', async () => {
      sendMock.mockRejectedValue(new Error('NotFound'));
      expect(await buildAdapter().headObject(KEY)).toBeNull();
    });

    it('exists() reflète la présence de l’objet', async () => {
      sendMock.mockResolvedValueOnce({ ContentLength: 1, ContentType: 'application/pdf' });
      sendMock.mockRejectedValueOnce(new Error('NotFound'));
      const adapter = buildAdapter();
      expect(await adapter.exists(KEY)).toBe(true);
      expect(await adapter.exists(KEY)).toBe(false);
    });
  });

  it('getObject() lit le contenu binaire d’un objet — réservé au worker d’analyse antivirus (US-IG-009)', async () => {
    const bytes = new TextEncoder().encode('contenu du fichier');
    sendMock.mockResolvedValue({ Body: { transformToByteArray: async () => bytes } });
    const adapter = buildAdapter();

    const content = await adapter.getObject('tenants/t1/x.pdf');

    expect(content).toBeInstanceOf(Buffer);
    expect(content.toString()).toBe('contenu du fichier');
  });

  it('putObject() écrit un objet généré côté serveur — réservé au worker d’export (US-IG-012)', async () => {
    sendMock.mockResolvedValue(undefined);
    const adapter = buildAdapter();

    await adapter.putObject({
      storageKey: 'tenants/t1/exports/pool/x.csv',
      body: Buffer.from('reference,score\nIG-1,80', 'utf-8'),
      mimeType: 'text/csv',
    });

    expect(sendMock).toHaveBeenCalledTimes(1);
    const [command] = sendMock.mock.calls[0] as [{ input: Record<string, unknown> }];
    expect(command.input).toMatchObject({
      Bucket: 'gaatshort',
      Key: 'tenants/t1/exports/pool/x.csv',
      ContentType: 'text/csv',
    });
  });
});

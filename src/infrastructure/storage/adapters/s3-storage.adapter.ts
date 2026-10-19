import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type { PresignedUpload, StoragePort } from '@shared/kernel/ports/storage.port';

/**
 * Adaptateur S3 (AWS, Scaleway, MinIO — même API).
 *
 * DÉCISION D'ARCHITECTURE : les fichiers ne transitent JAMAIS par l'API.
 * Le client obtient une URL POST signée, téléverse en direct vers S3, puis
 * confirme à l'API. Conséquences :
 *   • aucune consommation mémoire côté Node sur un PDF de 15 Mo ;
 *   • pas de timeout sur connexion mobile lente ;
 *   • l'API reste dimensionnée pour du JSON, pas pour du binaire.
 * C'est ce qui rend US-IG-009 tenable à l'échelle d'une cohorte entière.
 */
@Injectable()
export class S3StorageAdapter implements StoragePort {
  private readonly client: S3Client;

  constructor(private readonly config: AppConfigService) {
    const s3 = this.config.storage;
    this.client = new S3Client({
      region: s3.region,
      endpoint: s3.endpoint,
      forcePathStyle: s3.forcePathStyle,
      credentials: { accessKeyId: s3.accessKey, secretAccessKey: s3.secretKey },
    });
  }

  /**
   * Toute clé S3 vit sous `tenants/{tenantId}/…` (StorageKeyFactory). L'adaptateur
   * refuse de signer/supprimer une clé hors de cet espace : une clé fabriquée
   * ailleurs (ou héritée d'un autre tenant) ne doit jamais donner d'URL.
   */
  private assertScopedKey(storageKey: string): void {
    if (!/^tenants\/[^/]+\/.+/.test(storageKey)) {
      throw new Error(`Clé de stockage hors périmètre tenant : ${storageKey}`);
    }
  }

  public async createPresignedUpload(params: {
    storageKey: string;
    mimeType: string;
    maxSizeBytes: number;
  }): Promise<PresignedUpload> {
    this.assertScopedKey(params.storageKey);
    const ttl = this.config.storage.presignTtlSeconds;
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.config.storage.bucket,
      Key: params.storageKey,
      Expires: ttl,
      // La taille et le type sont contraints par S3 lui-même : un client
      // malveillant ne peut pas déposer un fichier de 2 Go ou un exécutable.
      Conditions: [
        ['content-length-range', 1, params.maxSizeBytes],
        ['eq', '$Content-Type', params.mimeType],
      ],
      Fields: { 'Content-Type': params.mimeType },
    });

    return {
      url,
      fields,
      storageKey: params.storageKey,
      expiresAt: new Date(Date.now() + ttl * 1000),
    };
  }

  public async createPresignedDownload(storageKey: string, ttlSeconds?: number): Promise<string> {
    this.assertScopedKey(storageKey);
    // TTL de consultation dédié, et PLAFONNÉ : même si un appelant demande plus,
    // un lien de téléchargement n'excède jamais `downloadTtlSeconds` (15 min).
    const max = this.config.storage.downloadTtlSeconds;
    const expiresIn = Math.min(ttlSeconds ?? max, max);
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.config.storage.bucket, Key: storageKey }),
      { expiresIn },
    );
  }

  public async delete(storageKey: string): Promise<void> {
    this.assertScopedKey(storageKey);
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.storage.bucket, Key: storageKey }),
    );
  }

  public async exists(storageKey: string): Promise<boolean> {
    return (await this.headObject(storageKey)) !== null;
  }

  public async headObject(storageKey: string) {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.config.storage.bucket, Key: storageKey }),
      );
      return { sizeBytes: res.ContentLength ?? 0, mimeType: res.ContentType ?? 'application/octet-stream' };
    } catch {
      return null;
    }
  }

  public async getObject(storageKey: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.config.storage.bucket, Key: storageKey }),
    );
    const bytes = await res.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  public async putObject(params: { storageKey: string; body: Buffer; mimeType: string }): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.storage.bucket,
        Key: params.storageKey,
        Body: params.body,
        ContentType: params.mimeType,
      }),
    );
  }
}

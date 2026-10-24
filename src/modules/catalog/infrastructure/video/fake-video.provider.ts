import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type {
  DirectUploadTicket,
  ProviderVideoState,
  VideoProviderPort,
} from '../../domain/ports/video-provider.port';

/**
 * Pilote vidéo factice (développement et tests) : aucun appel externe, la vidéo
 * est « prête » immédiatement et la lecture renvoie un flux HLS de démonstration.
 * Interdit en production (env.schema.ts).
 */
@Injectable()
export class FakeVideoProvider implements VideoProviderPort {
  public readonly name = 'FAKE' as const;

  constructor(private readonly config: AppConfigService) {}

  public createDirectUpload(_title: string): Promise<DirectUploadTicket> {
    return Promise.resolve({ providerRef: `fake-${randomUUID()}`, endpoint: null, headers: {} });
  }

  public ingestFromUrl(_title: string, _sourceUrl: string): Promise<{ providerRef: string }> {
    return Promise.resolve({ providerRef: `fake-${randomUUID()}` });
  }

  public getState(_providerRef: string): Promise<ProviderVideoState> {
    return Promise.resolve({
      status: 'READY',
      durationSeconds: 120,
      width: 1080,
      height: 1920,
      thumbnailUrl: null,
      failureReason: null,
    });
  }

  public signedPlaybackUrl(_providerRef: string, ttlSeconds: number): { url: string; expiresAt: Date } {
    return { url: this.config.video.fakeHlsUrl, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  public deleteVideo(_providerRef: string): Promise<void> {
    return Promise.resolve();
  }
}

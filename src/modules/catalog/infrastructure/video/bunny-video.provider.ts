import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type {
  DirectUploadTicket,
  ProviderVideoState,
  VideoProviderPort,
} from '../../domain/ports/video-provider.port';
import { signBunnyDirectoryUrl } from './bunny-sign';

const STREAM_API = 'https://video.bunnycdn.com';
const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload';

interface BunnyVideo {
  guid: string;
  status: number; // 0 créé, 1 téléversé, 2 traitement, 3 transcodage, 4 terminé, 5 erreur, 6 échec du téléversement
  length: number;
  width: number;
  height: number;
  thumbnailFileName?: string;
}

/** Adaptateur Bunny Stream (API « Stream », bibliothèque vidéo + zone CDN signée). */
@Injectable()
export class BunnyVideoProvider implements VideoProviderPort {
  public readonly name = 'BUNNY_STREAM' as const;
  private readonly logger = new Logger(BunnyVideoProvider.name);

  constructor(private readonly config: AppConfigService) {}

  private get cfg() {
    return this.config.video.bunny;
  }

  public async createDirectUpload(title: string): Promise<DirectUploadTicket> {
    const { guid } = await this.createVideo(title);
    const expire = Math.floor(Date.now() / 1000) + 6 * 3600;
    // Signature TUS documentée par Bunny : sha256(library_id + api_key + expiration + video_id).
    const signature = createHash('sha256')
      .update(`${this.cfg.libraryId}${this.cfg.apiKey}${expire}${guid}`)
      .digest('hex');
    return {
      providerRef: guid,
      endpoint: TUS_ENDPOINT,
      headers: {
        AuthorizationSignature: signature,
        AuthorizationExpire: String(expire),
        VideoId: guid,
        LibraryId: this.cfg.libraryId,
      },
    };
  }

  public async ingestFromUrl(title: string, sourceUrl: string): Promise<{ providerRef: string }> {
    const { guid } = await this.createVideo(title);
    await this.call(`/library/${this.cfg.libraryId}/videos/${guid}/fetch`, {
      method: 'POST',
      body: JSON.stringify({ url: sourceUrl }),
    });
    return { providerRef: guid };
  }

  public async getState(providerRef: string): Promise<ProviderVideoState> {
    const v = (await this.call(`/library/${this.cfg.libraryId}/videos/${providerRef}`)) as BunnyVideo;
    const status = v.status === 4 ? 'READY' : v.status >= 5 ? 'FAILED' : 'PROCESSING';
    return {
      status,
      durationSeconds: v.length > 0 ? Math.round(v.length) : null,
      width: v.width || null,
      height: v.height || null,
      thumbnailUrl: v.thumbnailFileName ? `https://${this.cfg.cdnHost}/${providerRef}/${v.thumbnailFileName}` : null,
      failureReason: status === 'FAILED' ? `Bunny status ${v.status}` : null,
    };
  }

  public signedPlaybackUrl(providerRef: string, ttlSeconds: number): { url: string; expiresAt: Date } {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const url = signBunnyDirectoryUrl({
      host: this.cfg.cdnHost,
      securityKey: this.cfg.tokenKey,
      directory: `/${providerRef}/`,
      file: 'playlist.m3u8',
      expires,
    });
    return { url, expiresAt: new Date(expires * 1000) };
  }

  public async deleteVideo(providerRef: string): Promise<void> {
    await this.call(`/library/${this.cfg.libraryId}/videos/${providerRef}`, { method: 'DELETE' });
  }

  private async createVideo(title: string): Promise<{ guid: string }> {
    const v = (await this.call(`/library/${this.cfg.libraryId}/videos`, {
      method: 'POST',
      body: JSON.stringify({ title }),
    })) as BunnyVideo;
    return { guid: v.guid };
  }

  private async call(path: string, init: RequestInit = {}): Promise<unknown> {
    const res = await fetch(`${STREAM_API}${path}`, {
      ...init,
      headers: { AccessKey: this.cfg.apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      this.logger.warn(`Bunny ${init.method ?? 'GET'} ${path} → ${res.status}`);
      throw new Error(`Bunny Stream a répondu ${res.status}`);
    }
    const text = await res.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}

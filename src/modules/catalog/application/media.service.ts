import { Inject, Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { VIDEO_PROVIDER, type VideoProviderPort } from '../domain/ports/video-provider.port';
import type { Actor } from './catalog-admin.service';

/**
 * Vidéos des épisodes (FR-ADM-002) : téléversement direct vers le fournisseur
 * (le fichier ne transite jamais par l'API), import par URL, suivi de l'encodage.
 */
@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProviderPort,
  ) {}

  public async createEpisodeUpload(actor: Actor, episodeId: string) {
    const episode = await this.episodeOrThrow(episodeId);
    const ticket = await this.video.createDirectUpload(this.titleOf(episode));
    const asset = await this.attachNewAsset(actor, episode.id, episode.videoAssetId, ticket.providerRef);
    // Pilote factice : rien à téléverser, l'état « prêt » est immédiat.
    const refreshed = ticket.endpoint ? asset : await this.refresh(asset.id);
    return { asset: refreshed, upload: ticket.endpoint ? { endpoint: ticket.endpoint, headers: ticket.headers } : null };
  }

  public async ingestEpisodeFromUrl(actor: Actor, episodeId: string, sourceUrl: string) {
    const episode = await this.episodeOrThrow(episodeId);
    const { providerRef } = await this.video.ingestFromUrl(this.titleOf(episode), sourceUrl);
    const asset = await this.attachNewAsset(actor, episode.id, episode.videoAssetId, providerRef);
    return this.video.name === 'FAKE' ? this.refresh(asset.id) : asset;
  }

  /** Interroge le fournisseur et recopie l'état (appelé par le webhook ou à la demande). */
  public async refresh(assetId: string) {
    const asset = await this.prisma.client.mediaAsset.findUnique({ where: { id: assetId } });
    if (!asset) throw new ResourceNotFoundError('media', assetId);
    const state = await this.video.getState(asset.providerRef);
    const updated = await this.prisma.client.mediaAsset.update({
      where: { id: assetId },
      data: {
        status: state.status,
        durationSeconds: state.durationSeconds,
        width: state.width,
        height: state.height,
        thumbnailUrl: state.thumbnailUrl,
        failureReason: state.failureReason,
      },
    });
    if (state.status === 'READY' && state.durationSeconds) {
      await this.prisma.client.episode.updateMany({
        where: { videoAssetId: assetId, durationSeconds: null },
        data: { durationSeconds: state.durationSeconds },
      });
      if (state.thumbnailUrl) {
        await this.prisma.client.episode.updateMany({
          where: { videoAssetId: assetId, thumbnailUrl: null },
          data: { thumbnailUrl: state.thumbnailUrl },
        });
      }
    }
    return updated;
  }

  /** Webhook Bunny : on ne croit pas le statut reçu, on relit l'état chez le fournisseur. */
  public async onProviderWebhook(providerRef: string): Promise<{ handled: boolean }> {
    const asset = await this.prisma.client.mediaAsset.findFirst({ where: { providerRef } });
    if (!asset) {
      this.logger.warn(`Webhook vidéo pour une référence inconnue : ${providerRef}`);
      return { handled: false };
    }
    await this.refresh(asset.id);
    return { handled: true };
  }

  private async attachNewAsset(actor: Actor, episodeId: string, previousAssetId: string | null, providerRef: string) {
    const asset = await this.prisma.client.mediaAsset.create({
      data: { kind: 'VIDEO', provider: this.video.name, providerRef, status: 'PROCESSING', createdBy: actor.userId },
    });
    await this.prisma.client.episode.update({ where: { id: episodeId }, data: { videoAssetId: asset.id, durationSeconds: null } });
    if (previousAssetId) {
      // L'ancienne vidéo est détachée ; on la supprime chez le fournisseur sans bloquer.
      const previous = await this.prisma.client.mediaAsset.findUnique({ where: { id: previousAssetId } });
      if (previous) {
        this.video.deleteVideo(previous.providerRef).catch((e: unknown) =>
          this.logger.warn(`Suppression de l'ancienne vidéo ${previous.providerRef} impossible : ${String(e)}`),
        );
      }
    }
    await this.prisma.client.auditLog.create({
      data: { actorId: actor.userId, action: 'media.video.attached', resourceType: 'episode', resourceId: episodeId, after: { assetId: asset.id } } as never,
    });
    return asset;
  }

  private async episodeOrThrow(id: string) {
    const e = await this.prisma.client.episode.findUnique({ where: { id }, include: { series: { select: { slug: true } } } });
    if (!e) throw new ResourceNotFoundError('episode', id);
    return e;
  }

  private titleOf(e: { number: number; series: { slug: string } }) {
    return `${e.series.slug} — épisode ${e.number}`;
  }
}

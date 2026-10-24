import { Body, Controller, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { AppConfigService } from '@config/app-config.service';
import { Public } from '@shared/decorators/public.decorator';
import { MediaService } from '../../application/media.service';

/**
 * Webhook d'encodage Bunny Stream. Bunny ne signe pas ses webhooks : l'URL porte
 * un segment secret (BUNNY_WEBHOOK_SECRET), et le statut reçu n'est jamais cru —
 * on relit l'état de la vidéo chez Bunny (MediaService.onProviderWebhook).
 */
@ApiExcludeController()
@Controller({ path: 'webhooks/bunny', version: '1' })
export class MediaWebhookController {
  constructor(
    private readonly media: MediaService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post(':secret')
  @HttpCode(200)
  public async receive(@Param('secret') secret: string, @Body() body: Record<string, unknown>) {
    // Corps non typé à dessein : Bunny peut ajouter des champs, la liste blanche du
    // ValidationPipe refuserait alors le webhook.
    const expected = this.config.video.bunny.webhookSecret;
    const a = Buffer.from(secret);
    const b = Buffer.from(expected);
    if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) throw new NotFoundException();
    const guid = typeof body.VideoGuid === 'string' ? body.VideoGuid : '';
    if (!guid || String(body.VideoLibraryId) !== this.config.video.bunny.libraryId) return { handled: false };
    return this.media.onProviderWebhook(guid);
  }
}

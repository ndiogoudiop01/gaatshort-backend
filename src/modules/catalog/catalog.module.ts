import { Module } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { CATALOG_FACADE } from './catalog.facade';
import { CatalogAdminService } from './application/catalog-admin.service';
import { CatalogImportService } from './application/catalog-import.service';
import { CatalogQueryService } from './application/catalog-query.service';
import { MediaService } from './application/media.service';
import { VIDEO_PROVIDER } from './domain/ports/video-provider.port';
import { BunnyVideoProvider } from './infrastructure/video/bunny-video.provider';
import { FakeVideoProvider } from './infrastructure/video/fake-video.provider';
import { AdminCatalogController } from './presentation/http/admin-catalog.controller';
import { MediaWebhookController } from './presentation/http/media-webhook.controller';

/** Catalogue global : séries, épisodes, genres, médias, licences, vitrine par marque. */
@Module({
  controllers: [AdminCatalogController, MediaWebhookController],
  providers: [
    CatalogAdminService,
    CatalogImportService,
    CatalogQueryService,
    MediaService,
    {
      provide: VIDEO_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.video.driver === 'bunny' ? new BunnyVideoProvider(config) : new FakeVideoProvider(config),
    },
    { provide: CATALOG_FACADE, useExisting: CatalogQueryService },
  ],
  exports: [CATALOG_FACADE],
})
export class CatalogModule {}

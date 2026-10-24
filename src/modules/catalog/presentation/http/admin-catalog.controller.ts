import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { CatalogAdminService } from '../../application/catalog-admin.service';
import { MediaService } from '../../application/media.service';
import {
  BulkEpisodesDto, CreateEpisodeDto, CreateSeriesDto, GenreDto, IngestVideoDto, LicenseDto, ListSeriesQueryDto,
  SeriesBodyDto, StorefrontSeriesQueryDto, SubtitleDto, TenantSeriesDto, UpdateEpisodeDto, UpdateGenreDto, UpdateLicenseDto,
} from './dto/catalog-admin.dto';

const actor = (u: AuthenticatedUser) => ({ userId: u.id });

@ApiTags('Back-office — Catalogue')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin', version: '1' })
export class AdminCatalogController {
  constructor(
    private readonly catalog: CatalogAdminService,
    private readonly media: MediaService,
  ) {}

  // ── Genres ──
  @Get('genres') @RequirePermissions('catalog:read') @ApiOperation({ summary: 'Genres (avec nombre de séries)' })
  public listGenres() { return this.catalog.listGenres(); }

  @Post('genres') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Créer un genre' })
  public createGenre(@Body() dto: GenreDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.createGenre(actor(u), { slug: dto.slug, nameFr: dto.nameFr, nameEn: dto.nameEn, position: dto.position });
  }

  @Patch('genres/:id') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Modifier un genre' })
  public updateGenre(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateGenreDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.updateGenre(actor(u), id, { nameFr: dto.nameFr, nameEn: dto.nameEn, position: dto.position });
  }

  @Delete('genres/:id') @HttpCode(204) @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Supprimer un genre' })
  public deleteGenre(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.deleteGenre(actor(u), id);
  }

  // ── Séries ──
  @Get('series') @RequirePermissions('catalog:read') @ApiOperation({ summary: 'Séries du catalogue (filtres statut et recherche)' })
  public listSeries(@Query() q: ListSeriesQueryDto) {
    return this.catalog.listSeries({ status: q.status, q: q.q, page: q.page, perPage: q.perPage });
  }

  @Post('series') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Créer une série (brouillon)' })
  public createSeries(@Body() dto: CreateSeriesDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.createSeries(actor(u), seriesInput(dto) as ReturnType<typeof seriesInput> & { titleFr: string });
  }

  @Get('series/:id') @RequirePermissions('catalog:read') @ApiOperation({ summary: 'Série : épisodes, vidéos, sous-titres, licences' })
  public getSeries(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.getSeries(id); }

  @Patch('series/:id') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Modifier une série' })
  public updateSeries(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SeriesBodyDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.updateSeries(actor(u), id, seriesInput(dto));
  }

  @Post('series/:id/publish') @HttpCode(200) @RequirePermissions('catalog:publish')
  @ApiOperation({ summary: 'Publier au catalogue', description: '422 SERIES_HAS_NO_EPISODE, 422 SERIES_NOT_LICENSED' })
  public publishSeries(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.publishSeries(actor(u), id);
  }

  @Post('series/:id/unpublish') @HttpCode(200) @RequirePermissions('catalog:publish') @ApiOperation({ summary: 'Repasser la série en brouillon' })
  public unpublishSeries(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.unpublishSeries(actor(u), id);
  }

  @Delete('series/:id') @HttpCode(204) @RequirePermissions('catalog:publish') @ApiOperation({ summary: 'Archiver une série' })
  public archiveSeries(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.archiveSeries(actor(u), id);
  }

  // ── Épisodes ──
  @Post('series/:id/episodes') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Ajouter un épisode' })
  public createEpisode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CreateEpisodeDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.createEpisode(actor(u), id, { number: dto.number, titleFr: dto.titleFr, titleEn: dto.titleEn, priceCoinsOverride: dto.priceCoinsOverride });
  }

  @Post('series/:id/episodes/bulk') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Créer N épisodes brouillons à la suite' })
  public bulkEpisodes(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BulkEpisodesDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.createEpisodesBulk(actor(u), id, dto.count);
  }

  @Post('series/:id/episodes/publish-ready') @HttpCode(200) @RequirePermissions('catalog:publish')
  @ApiOperation({ summary: 'Publier tous les épisodes dont la vidéo est prête' })
  public publishReady(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.publishReadyEpisodes(actor(u), id);
  }

  @Get('episodes/:id') @RequirePermissions('catalog:read') @ApiOperation({ summary: 'Épisode' })
  public getEpisode(@Param('id', ParseUUIDPipe) id: string) { return this.catalog.getEpisode(id); }

  @Patch('episodes/:id') @RequirePermissions('catalog:write') @ApiOperation({ summary: 'Modifier un épisode' })
  public updateEpisode(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEpisodeDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.updateEpisode(actor(u), id, { titleFr: dto.titleFr, titleEn: dto.titleEn, priceCoinsOverride: dto.priceCoinsOverride, thumbnailUrl: dto.thumbnailUrl });
  }

  @Post('episodes/:id/publish') @HttpCode(200) @RequirePermissions('catalog:publish')
  @ApiOperation({ summary: 'Publier un épisode', description: '422 EPISODE_VIDEO_NOT_READY' })
  public publishEpisode(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.publishEpisode(actor(u), id);
  }

  @Post('episodes/:id/withdraw') @HttpCode(200) @RequirePermissions('catalog:publish') @ApiOperation({ summary: 'Retirer un épisode' })
  public withdrawEpisode(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.withdrawEpisode(actor(u), id);
  }

  @Delete('episodes/:id') @HttpCode(204) @RequirePermissions('catalog:write')
  @ApiOperation({ summary: 'Supprimer un brouillon jamais acheté', description: '422 EPISODE_IN_USE' })
  public deleteEpisode(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.deleteEpisode(actor(u), id);
  }

  @Post('episodes/:id/video/upload') @RequirePermissions('media:upload')
  @ApiOperation({ summary: 'Préparer le téléversement direct (TUS) de la vidéo', description: '`upload` est nul avec le pilote factice : la vidéo est prête aussitôt.' })
  public createUpload(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.media.createEpisodeUpload(actor(u), id);
  }

  @Post('episodes/:id/video/ingest') @RequirePermissions('media:upload') @ApiOperation({ summary: 'Importer la vidéo depuis une URL' })
  public ingest(@Param('id', ParseUUIDPipe) id: string, @Body() dto: IngestVideoDto, @CurrentUser() u: AuthenticatedUser) {
    return this.media.ingestEpisodeFromUrl(actor(u), id, dto.sourceUrl);
  }

  @Post('media/:id/refresh') @HttpCode(200) @RequirePermissions('media:upload') @ApiOperation({ summary: "Relire l'état d'encodage chez le fournisseur" })
  public refresh(@Param('id', ParseUUIDPipe) id: string) { return this.media.refresh(id); }

  @Put('episodes/:id/subtitles/:locale') @RequirePermissions('media:upload') @ApiOperation({ summary: 'Définir les sous-titres WebVTT (fr | en)' })
  public setSubtitle(@Param('id', ParseUUIDPipe) id: string, @Param('locale') locale: string, @Body() dto: SubtitleDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.setSubtitle(actor(u), id, locale === 'en' ? 'en' : 'fr', dto.url);
  }

  @Delete('episodes/:id/subtitles/:locale') @RequirePermissions('media:upload') @ApiOperation({ summary: 'Retirer des sous-titres' })
  public removeSubtitle(@Param('id', ParseUUIDPipe) id: string, @Param('locale') locale: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.removeSubtitle(actor(u), id, locale === 'en' ? 'en' : 'fr');
  }

  // ── Licences ──
  @Get('licenses') @RequirePermissions('license:read') @ApiOperation({ summary: 'Licences de diffusion' })
  public listLicenses() { return this.catalog.listLicenses(); }

  @Post('licenses') @RequirePermissions('license:write') @ApiOperation({ summary: 'Enregistrer une licence' })
  public createLicense(@Body() dto: LicenseDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.createLicense(actor(u), licenseInput(dto) as Required<Pick<LicenseDto, 'licensorName' | 'contractRef' | 'startsAt' | 'endsAt' | 'territories'>>);
  }

  @Patch('licenses/:id') @RequirePermissions('license:write') @ApiOperation({ summary: 'Modifier une licence' })
  public updateLicense(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLicenseDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.updateLicense(actor(u), id, licenseInput(dto));
  }

  @Delete('licenses/:id') @HttpCode(204) @RequirePermissions('license:write') @ApiOperation({ summary: 'Supprimer une licence' })
  public deleteLicense(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.deleteLicense(actor(u), id);
  }

  // ── Vitrine de la marque courante ──
  @Get('storefront/series') @RequirePermissions('catalog:read') @ApiOperation({ summary: 'Séries publiées et leur diffusion par la marque courante' })
  public tenantSeries(@Query() q: StorefrontSeriesQueryDto) { return this.catalog.listTenantSeries({ q: q.q, status: q.status }); }

  @Put('storefront/series/:seriesId') @RequirePermissions('storefront:write')
  @ApiOperation({ summary: 'Diffuser / masquer une série, mise en avant, prix', description: '422 SERIES_NOT_PUBLISHED, 422 SERIES_NOT_LICENSED_FOR_TENANT' })
  public setTenantSeries(@Param('seriesId', ParseUUIDPipe) seriesId: string, @Body() dto: TenantSeriesDto, @CurrentUser() u: AuthenticatedUser) {
    return this.catalog.setTenantSeries(actor(u), seriesId, {
      status: dto.status, featured: dto.featured, position: dto.position,
      freeEpisodesOverride: dto.freeEpisodesOverride, episodePriceCoinsOverride: dto.episodePriceCoinsOverride,
    });
  }
}

/** Traduction CHAMP PAR CHAMP : jamais de spread du corps. */
function seriesInput(dto: SeriesBodyDto) {
  return {
    slug: dto.slug, titleFr: dto.titleFr, titleEn: dto.titleEn, synopsisFr: dto.synopsisFr, synopsisEn: dto.synopsisEn,
    originalLocale: dto.originalLocale, posterUrl: dto.posterUrl, bannerUrl: dto.bannerUrl, maturityRating: dto.maturityRating,
    releaseYear: dto.releaseYear, tags: dto.tags, freeEpisodes: dto.freeEpisodes, episodePriceCoins: dto.episodePriceCoins,
    genreIds: dto.genreIds,
  };
}

function licenseInput(dto: UpdateLicenseDto) {
  return {
    licensorName: dto.licensorName, contractRef: dto.contractRef, documentUrl: dto.documentUrl, startsAt: dto.startsAt,
    endsAt: dto.endsAt, territories: dto.territories, sublicensingAllowed: dto.sublicensingAllowed, notes: dto.notes,
    seriesIds: dto.seriesIds,
  };
}

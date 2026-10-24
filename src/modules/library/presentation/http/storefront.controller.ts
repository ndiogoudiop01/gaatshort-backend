import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { OptionalAuth, Public } from '@shared/decorators/public.decorator';
import { requireAccountId } from '@shared/kernel/access/viewer';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { ViewerContextService } from '@infra/viewer/viewer-context.service';
import { LibraryService } from '../../application/library.service';
import { LocaleQueryDto, ProgressDto, SeriesListQueryDto } from './dto/library.dto';

@ApiTags('App — Vitrine et lecture')
@Controller({ version: '1' })
export class StorefrontController {
  constructor(
    private readonly library: LibraryService,
    private readonly viewer: ViewerContextService,
  ) {}

  @Public() @Get('storefront/config')
  @ApiOperation({ summary: 'Marque courante : nom, branding, langue, devise' })
  public config() { return this.library.config(); }

  @OptionalAuth() @Get('storefront/home')
  @ApiOperation({ summary: 'Accueil : mises en avant, nouveautés, populaires, rangées par genre' })
  public async home(@Req() req: Request, @CurrentUser() user: AuthenticatedUser | undefined, @Query() _q: LocaleQueryDto) {
    return this.library.home(await this.viewer.resolve(req, user));
  }

  @Public() @Get('storefront/genres')
  @ApiOperation({ summary: 'Genres' })
  public async genres(@Req() req: Request, @Query() _q: LocaleQueryDto) {
    return this.library.listGenres(await this.viewer.resolve(req, null));
  }

  @OptionalAuth() @Get('storefront/series')
  @ApiOperation({ summary: 'Séries diffusées (filtre genre, recherche, pagination)' })
  public async series(@Req() req: Request, @CurrentUser() user: AuthenticatedUser | undefined, @Query() q: SeriesListQueryDto) {
    return this.library.listSeries(await this.viewer.resolve(req, user), { genre: q.genre, q: q.q, page: q.page, perPage: q.perPage });
  }

  @OptionalAuth() @Get('storefront/series/:slug')
  @ApiOperation({ summary: 'Fiche série : épisodes, gratuité, prix, épisodes débloqués, reprise' })
  public async seriesDetail(@Param('slug') slug: string, @Req() req: Request, @CurrentUser() user: AuthenticatedUser | undefined, @Query() _q: LocaleQueryDto) {
    return this.library.seriesDetail(await this.viewer.resolve(req, user), slug);
  }

  @OptionalAuth() @Get('episodes/:id/playback')
  @ApiOperation({
    summary: 'URL de lecture HLS signée (courte durée)',
    description: 'Épisode gratuit : sans connexion. Épisode payant : droit de visionnage requis, sinon 403 EPISODE_LOCKED (details.priceCoins, details.loginRequired).',
  })
  public async playback(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request, @CurrentUser() user: AuthenticatedUser | undefined, @Query() _q: LocaleQueryDto) {
    return this.library.playback(await this.viewer.resolve(req, user), id);
  }

  @ApiBearerAuth('access-token') @Put('episodes/:id/progress') @HttpCode(200)
  @ApiOperation({ summary: 'Enregistrer la position de lecture' })
  public async progress(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ProgressDto, @Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    const accountId = requireAccountId(user);
    return this.library.saveProgress(accountId, await this.viewer.resolve(req, user), id, dto.positionSeconds, dto.completed ?? false);
  }

  @ApiBearerAuth('access-token') @Get('me/continue-watching')
  @ApiOperation({ summary: 'Reprendre la lecture' })
  public async continueWatching(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Query() _q: LocaleQueryDto) {
    return this.library.continueWatching(requireAccountId(user), await this.viewer.resolve(req, user));
  }

  @ApiBearerAuth('access-token') @Get('me/favorites')
  @ApiOperation({ summary: 'Ma liste' })
  public async favorites(@Req() req: Request, @CurrentUser() user: AuthenticatedUser, @Query() _q: LocaleQueryDto) {
    return this.library.favorites(requireAccountId(user), await this.viewer.resolve(req, user));
  }

  @ApiBearerAuth('access-token') @Post('me/favorites/:seriesId') @HttpCode(200)
  @ApiOperation({ summary: 'Ajouter à ma liste (id ou slug)' })
  public async addFavorite(@Param('seriesId') seriesId: string, @Req() req: Request, @CurrentUser() user: AuthenticatedUser) {
    return this.library.addFavorite(requireAccountId(user), await this.viewer.resolve(req, user), seriesId);
  }

  @ApiBearerAuth('access-token') @Delete('me/favorites/:seriesId')
  @ApiOperation({ summary: 'Retirer de ma liste' })
  public removeFavorite(@Param('seriesId', ParseUUIDPipe) seriesId: string, @CurrentUser() user: AuthenticatedUser) {
    return this.library.removeFavorite(requireAccountId(user), seriesId);
  }
}

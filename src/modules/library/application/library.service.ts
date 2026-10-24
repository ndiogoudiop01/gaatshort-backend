import { Inject, Injectable } from '@nestjs/common';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ForbiddenActionError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { CATALOG_FACADE, type CatalogFacade, type Locale, type SeriesCard } from '@modules/catalog/catalog.facade';
import { WALLET_FACADE, type WalletFacade } from '@modules/wallet/wallet.facade';

export interface Viewer {
  readonly accountId: string | null;
  readonly country: string;
  readonly locale: Locale;
}

/**
 * Expérience spectateur de la marque courante : vitrine, fiche série avec l'état
 * de chaque épisode, lecture (contrôle des droits AVANT l'URL signée), reprise,
 * favoris. Progression et favoris appartiennent à la marque (RLS) ; les droits
 * de visionnage sont communs (Q-02).
 */
@Injectable()
export class LibraryService {
  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
    @Inject(CATALOG_FACADE) private readonly catalog: CatalogFacade,
    @Inject(WALLET_FACADE) private readonly wallet: WalletFacade,
  ) {}

  public async config() {
    const t = this.tenant.get();
    const row = await this.prisma.client.tenant.findUnique({
      where: { id: t.tenantId },
      select: { name: true, slug: true, branding: true, defaultLocale: true, defaultCountry: true, defaultCurrency: true, isFirstParty: true },
    });
    return {
      name: row?.name ?? t.slug,
      slug: t.slug,
      branding: row?.branding ?? {},
      defaultLocale: t.defaultLocale,
      defaultCountry: t.defaultCountry,
      currency: t.defaultCurrency,
      // Q-08 : mention discrète du compte unique sur les marques tierces.
      accountNotice: row?.isFirstParty ? null : 'Connexion avec votre compte Gaatshort',
      locales: ['fr', 'en'],
    };
  }

  public async home(v: Viewer) {
    const [featured, latest, genres, popularIds] = await Promise.all([
      this.catalog.listLiveSeries({ country: v.country, locale: v.locale, featuredOnly: true, limit: 10 }),
      this.catalog.listLiveSeries({ country: v.country, locale: v.locale, sort: 'new', limit: 20 }),
      this.catalog.listGenres(v.locale),
      this.popularSeriesIds(20),
    ]);
    const popular = popularIds.length
      ? (await this.catalog.listLiveSeries({ country: v.country, locale: v.locale, ids: popularIds, limit: 20 })).items
      : [];
    const byGenre = await Promise.all(
      genres.slice(0, 6).map(async (g) => ({
        key: `genre:${g.slug}`,
        title: g.name,
        items: (await this.catalog.listLiveSeries({ country: v.country, locale: v.locale, genreSlug: g.slug, limit: 20 })).items,
      })),
    );
    const en = v.locale === 'en';
    const rows = [
      { key: 'new', title: en ? 'New releases' : 'Nouveautés', items: latest.items },
      { key: 'popular', title: en ? 'Trending' : 'Populaires', items: popular },
      ...byGenre,
    ].filter((r) => r.items.length > 0);
    return {
      featured: featured.items.length ? featured.items : latest.items.slice(0, 5),
      rows,
      genres,
      freeEpisodesNotice: en ? 'The first episodes of every series are free' : 'Les premiers épisodes de chaque série sont gratuits',
    };
  }

  public listSeries(v: Viewer, q: { genre?: string; q?: string; page: number; perPage: number }) {
    return this.catalog
      .listLiveSeries({ country: v.country, locale: v.locale, genreSlug: q.genre, q: q.q, sort: 'position', limit: q.perPage, offset: (q.page - 1) * q.perPage })
      .then(({ items, total }) => ({ items, meta: { total, page: q.page, perPage: q.perPage, totalPages: Math.ceil(total / q.perPage), hasMore: q.page * q.perPage < total } }));
  }

  public listGenres(v: Viewer) {
    return this.catalog.listGenres(v.locale);
  }

  public async seriesDetail(v: Viewer, slug: string) {
    const series = await this.catalog.getLiveSeries(slug, v.country, v.locale);
    if (!v.accountId) {
      return { ...series, isFavorite: false, resume: null, episodes: series.episodes.map((e) => ({ ...e, unlocked: e.isFree })) };
    }
    const accountId = v.accountId;
    const [unlocked, favorite, progress] = await Promise.all([
      this.wallet.unlockedEpisodeIds(accountId, series.episodes.filter((e) => !e.isFree).map((e) => e.id)),
      this.prisma.client.favorite.findFirst({ where: { accountId, seriesId: series.id } }),
      this.prisma.client.watchProgress.findMany({ where: { accountId, seriesId: series.id }, orderBy: { updatedAt: 'desc' } }),
    ]);
    const progressById = new Map(progress.map((p) => [p.episodeId, p]));
    const last = progress[0];
    return {
      ...series,
      isFavorite: !!favorite,
      resume: last ? { episodeId: last.episodeId, positionSeconds: last.positionSeconds, completed: last.completed } : null,
      episodes: series.episodes.map((e) => ({
        ...e,
        unlocked: e.isFree || unlocked.has(e.id),
        progressSeconds: progressById.get(e.id)?.positionSeconds ?? 0,
        completed: progressById.get(e.id)?.completed ?? false,
      })),
    };
  }

  /**
   * Lecture (FR-VIDEO-001) : l'URL HLS signée n'est remise qu'après contrôle
   * serveur — épisode gratuit, ou droit de visionnage du compte.
   * 403 EPISODE_LOCKED (avec le prix) sinon ; l'application propose le déblocage.
   */
  public async playback(v: Viewer, episodeId: string) {
    const p = await this.catalog.getPlayableEpisode(episodeId, v.country, v.locale);
    if (!p.videoReady) throw new ResourceNotFoundError('video', episodeId);
    if (!p.episode.isFree) {
      const unlocked = v.accountId ? await this.wallet.unlockedEpisodeIds(v.accountId, [episodeId]) : new Set<string>();
      if (!unlocked.has(episodeId)) {
        throw new EpisodeLockedError(episodeId, p.episode.priceCoins, !v.accountId);
      }
    }
    const { url, expiresAt } = await this.catalog.signedPlaybackUrl(episodeId);
    const progress = v.accountId
      ? await this.prisma.client.watchProgress.findFirst({ where: { accountId: v.accountId, episodeId } })
      : null;
    return {
      episode: p.episode,
      seriesId: p.seriesId,
      seriesSlug: p.seriesSlug,
      hlsUrl: url,
      expiresAt,
      subtitles: p.subtitles,
      nextEpisodeId: p.nextEpisodeId,
      resumeAtSeconds: progress && !progress.completed ? progress.positionSeconds : 0,
    };
  }

  public async saveProgress(accountId: string, v: Viewer, episodeId: string, positionSeconds: number, completed: boolean) {
    const p = await this.catalog.getPlayableEpisode(episodeId, v.country, v.locale);
    const tenantId = this.tenant.tenantId;
    await this.prisma.client.watchProgress.upsert({
      where: { tenantId_accountId_episodeId: { tenantId, accountId, episodeId } },
      create: { accountId, episodeId, seriesId: p.seriesId, positionSeconds, completed } as never,
      update: { positionSeconds, completed },
    });
    return { saved: true };
  }

  /** « Reprendre » : dernier épisode touché de chaque série, du plus récent au plus ancien. */
  public async continueWatching(accountId: string, v: Viewer) {
    const rows = await this.prisma.client.watchProgress.findMany({
      where: { accountId },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    const latestBySeries = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!latestBySeries.has(r.seriesId)) latestBySeries.set(r.seriesId, r);
    const ids = [...latestBySeries.keys()].slice(0, 20);
    if (!ids.length) return [];
    const { items } = await this.catalog.listLiveSeries({ country: v.country, locale: v.locale, ids, limit: 20 });
    return items.map((s: SeriesCard) => {
      const r = latestBySeries.get(s.id);
      return { series: s, episodeId: r?.episodeId, positionSeconds: r?.positionSeconds ?? 0, completed: r?.completed ?? false, updatedAt: r?.updatedAt };
    });
  }

  public async favorites(accountId: string, v: Viewer) {
    const rows = await this.prisma.client.favorite.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 200 });
    if (!rows.length) return [];
    const { items } = await this.catalog.listLiveSeries({ country: v.country, locale: v.locale, ids: rows.map((r) => r.seriesId), limit: 200 });
    return items;
  }

  public async addFavorite(accountId: string, v: Viewer, seriesIdOrSlug: string) {
    const s = await this.catalog.getLiveSeries(seriesIdOrSlug, v.country, v.locale);
    const tenantId = this.tenant.tenantId;
    await this.prisma.client.favorite.upsert({
      where: { tenantId_accountId_seriesId: { tenantId, accountId, seriesId: s.id } },
      create: { accountId, seriesId: s.id } as never,
      update: {},
    });
    return { isFavorite: true };
  }

  public async removeFavorite(accountId: string, seriesId: string) {
    await this.prisma.client.favorite.deleteMany({ where: { accountId, seriesId } });
    return { isFavorite: false };
  }

  /** Séries les plus regardées sur 30 jours (progressions distinctes par compte). */
  private async popularSeriesIds(limit: number): Promise<string[]> {
    const since = new Date(Date.now() - 30 * 86_400_000);
    const rows = await this.prisma.client.watchProgress.groupBy({
      by: ['seriesId'],
      where: { updatedAt: { gte: since } },
      _count: { accountId: true },
      orderBy: { _count: { accountId: 'desc' } },
      take: limit,
    });
    return rows.map((r) => r.seriesId);
  }
}

export class EpisodeLockedError extends ForbiddenActionError {
  public override readonly code = 'EPISODE_LOCKED' as never;
  constructor(episodeId: string, priceCoins: number, loginRequired: boolean) {
    super('watch', 'episode', loginRequired ? 'connexion requise' : 'épisode à débloquer');
    Object.assign(this.details, { episodeId, priceCoins, loginRequired });
  }
}

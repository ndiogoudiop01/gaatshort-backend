import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '@config/app-config.service';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import type {
  CatalogFacade, EpisodeView, GenreView, Locale, PlayableEpisode, SeriesCard, SeriesDetail,
} from '../catalog.facade';
import { effectiveAccess, effectiveFreeEpisodes, isLicensed } from '../domain/services/episode-access';
import { VIDEO_PROVIDER, type VideoProviderPort } from '../domain/ports/video-provider.port';

const seriesInclude = {
  genres: { include: { genre: true } },
  licenses: { include: { license: true } },
  _count: { select: { episodes: { where: { status: 'PUBLISHED' as const } } } },
} satisfies Prisma.SeriesInclude;

type SeriesRow = Prisma.SeriesGetPayload<{ include: typeof seriesInclude }>;
type TenantSeriesRow = { seriesId: string; featured: boolean; position: number; freeEpisodesOverride: number | null; episodePriceCoinsOverride: number | null };

@Injectable()
export class CatalogQueryService implements CatalogFacade {
  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly config: AppConfigService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
    @Inject(VIDEO_PROVIDER) private readonly video: VideoProviderPort,
  ) {}

  public async listGenres(locale: Locale): Promise<GenreView[]> {
    const genres = await this.prisma.client.genre.findMany({ orderBy: [{ position: 'asc' }, { nameFr: 'asc' }] });
    return genres.map((g) => ({ id: g.id, slug: g.slug, name: locale === 'en' ? g.nameEn : g.nameFr }));
  }

  public async listLiveSeries(p: Parameters<CatalogFacade['listLiveSeries']>[0]) {
    const live = await this.liveTenantSeries();
    let ids = [...live.keys()];
    if (p.ids) ids = ids.filter((id) => p.ids?.includes(id));
    if (p.featuredOnly) ids = ids.filter((id) => live.get(id)?.featured);
    if (!ids.length) return { items: [], total: 0 };

    const rows = await this.prisma.client.series.findMany({
      where: {
        id: { in: ids },
        status: 'PUBLISHED',
        deletedAt: null,
        ...(p.genreSlug ? { genres: { some: { genre: { slug: p.genreSlug } } } } : {}),
        ...(p.q
          ? {
              OR: [
                { titleFr: { contains: p.q, mode: 'insensitive' } },
                { titleEn: { contains: p.q, mode: 'insensitive' } },
                { tags: { has: p.q.toLowerCase() } },
              ],
            }
          : {}),
      },
      include: seriesInclude,
    });
    const now = new Date();
    const visible = rows.filter((s) => this.available(s, p.country, now));
    const sorted =
      p.ids && !p.sort
        ? visible.sort((a, b) => (p.ids?.indexOf(a.id) ?? 0) - (p.ids?.indexOf(b.id) ?? 0))
        : p.sort === 'new'
          ? visible.sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
          : visible.sort((a, b) => (live.get(a.id)?.position ?? 0) - (live.get(b.id)?.position ?? 0) || a.titleFr.localeCompare(b.titleFr));
    const offset = p.offset ?? 0;
    const page = sorted.slice(offset, offset + (p.limit ?? 50));
    return { items: page.map((s) => this.toCard(s, live.get(s.id), p.locale)), total: sorted.length };
  }

  public async getLiveSeries(slugOrId: string, country: string, locale: Locale): Promise<SeriesDetail> {
    const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
    const s = await this.prisma.client.series.findFirst({
      where: { ...(isUuid ? { id: slugOrId } : { slug: slugOrId }), status: 'PUBLISHED', deletedAt: null },
      include: { ...seriesInclude, episodes: { where: { status: 'PUBLISHED' }, orderBy: { number: 'asc' } } },
    });
    const ts = s ? (await this.liveTenantSeries()).get(s.id) : undefined;
    if (!s || !ts || !this.available(s, country, new Date())) throw new ResourceNotFoundError('series', slugOrId);
    return {
      ...this.toCard(s, ts, locale),
      episodes: s.episodes.map((e) => this.toEpisode(e, s, ts, locale)),
    };
  }

  public async getPlayableEpisode(episodeId: string, country: string, locale: Locale): Promise<PlayableEpisode> {
    const e = await this.prisma.client.episode.findFirst({
      where: { id: episodeId, status: 'PUBLISHED' },
      include: { video: true, subtitles: true, series: { include: seriesInclude } },
    });
    if (!e || e.series.status !== 'PUBLISHED' || e.series.deletedAt) throw new ResourceNotFoundError('episode', episodeId);
    const ts = (await this.liveTenantSeries()).get(e.seriesId);
    if (!ts || !this.available(e.series, country, new Date())) throw new ResourceNotFoundError('episode', episodeId);
    const next = await this.prisma.client.episode.findFirst({
      where: { seriesId: e.seriesId, status: 'PUBLISHED', number: { gt: e.number } },
      orderBy: { number: 'asc' },
      select: { id: true },
    });
    return {
      episode: this.toEpisode(e, e.series, ts, locale),
      seriesId: e.seriesId,
      seriesSlug: e.series.slug,
      videoReady: e.video?.status === 'READY',
      subtitles: e.subtitles.map((t) => ({ locale: t.locale, url: t.url })),
      nextEpisodeId: next?.id ?? null,
    };
  }

  public async signedPlaybackUrl(episodeId: string) {
    const e = await this.prisma.client.episode.findUnique({ where: { id: episodeId }, include: { video: true } });
    if (!e?.video || e.video.status !== 'READY') throw new ResourceNotFoundError('video', episodeId);
    return this.video.signedPlaybackUrl(e.video.providerRef, this.config.video.playbackTtlSeconds);
  }

  // ── interne ───────────────────────────────────────────────────────────────

  private async liveTenantSeries(): Promise<Map<string, TenantSeriesRow>> {
    const rows = await this.prisma.client.tenantSeries.findMany({ where: { status: 'LIVE' } });
    return new Map(rows.map((r) => [r.seriesId, r]));
  }

  private available(s: SeriesRow, country: string, at: Date): boolean {
    return isLicensed(s.licenses.map((l) => l.license), country, at, this.tenant.get().isFirstParty ?? false);
  }

  private toCard(s: SeriesRow, ts: TenantSeriesRow | undefined, locale: Locale): SeriesCard {
    const en = locale === 'en';
    return {
      id: s.id,
      slug: s.slug,
      title: (en && s.titleEn) || s.titleFr,
      synopsis: (en && s.synopsisEn) || s.synopsisFr,
      posterUrl: s.posterUrl,
      bannerUrl: s.bannerUrl,
      maturityRating: s.maturityRating,
      releaseYear: s.releaseYear,
      tags: s.tags,
      genres: s.genres.map((g) => ({ id: g.genre.id, slug: g.genre.slug, name: en ? g.genre.nameEn : g.genre.nameFr })),
      episodeCount: s._count.episodes,
      freeEpisodes: effectiveFreeEpisodes(s, ts),
      featured: ts?.featured ?? false,
      publishedAt: s.publishedAt,
    };
  }

  private toEpisode(
    e: { id: string; number: number; titleFr: string | null; titleEn: string | null; durationSeconds: number | null; thumbnailUrl: string | null; priceCoinsOverride: number | null },
    s: { freeEpisodes: number; episodePriceCoins: number },
    ts: TenantSeriesRow | undefined,
    locale: Locale,
  ): EpisodeView {
    const access = effectiveAccess(s, e, ts);
    const fallback = locale === 'en' ? `Episode ${e.number}` : `Épisode ${e.number}`;
    return {
      id: e.id,
      number: e.number,
      title: (locale === 'en' ? e.titleEn : e.titleFr) ?? e.titleFr ?? fallback,
      durationSeconds: e.durationSeconds,
      thumbnailUrl: e.thumbnailUrl,
      isFree: access.isFree,
      priceCoins: access.priceCoins,
    };
  }
}

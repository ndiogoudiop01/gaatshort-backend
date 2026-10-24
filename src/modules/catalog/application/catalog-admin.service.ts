import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { BusinessRuleViolationError, ResourceNotFoundError } from '@shared/kernel/errors/domain.error';
import { PaginatedResult } from '@shared/kernel/application/pagination';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import { isLicensed, slugify } from '../domain/services/episode-access';

export interface Actor {
  readonly userId: string;
}

type SeriesInput = {
  slug?: string;
  titleFr?: string;
  titleEn?: string;
  synopsisFr?: string;
  synopsisEn?: string;
  originalLocale?: 'fr' | 'en';
  posterUrl?: string;
  bannerUrl?: string;
  maturityRating?: string;
  releaseYear?: number;
  tags?: string[];
  freeEpisodes?: number;
  episodePriceCoins?: number;
  genreIds?: string[];
};

type LicenseInput = {
  licensorName?: string;
  contractRef?: string;
  documentUrl?: string;
  startsAt?: string;
  endsAt?: string;
  territories?: string[];
  sublicensingAllowed?: boolean;
  notes?: string;
  seriesIds?: string[];
};

/**
 * Catalogue GLOBAL (séries, épisodes, genres, licences) — partagé par toutes les
 * marques (D-03). Écriture réservée aux rôles plateforme ; chaque action est auditée.
 */
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
  ) {}

  // ── Genres ────────────────────────────────────────────────────────────────

  public listGenres() {
    return this.prisma.client.genre.findMany({
      orderBy: [{ position: 'asc' }, { nameFr: 'asc' }],
      include: { _count: { select: { series: true } } },
    });
  }

  public async createGenre(actor: Actor, input: { slug: string; nameFr: string; nameEn: string; position?: number }) {
    const genre = await this.unique(() => this.prisma.client.genre.create({ data: input }), 'Ce genre existe déjà');
    await this.audit(actor, 'catalog.genre.created', 'genre', genre.id, input);
    return genre;
  }

  public async updateGenre(actor: Actor, id: string, input: { nameFr?: string; nameEn?: string; position?: number }) {
    await this.mustExist('genre', id, () => this.prisma.client.genre.findUnique({ where: { id } }));
    const genre = await this.prisma.client.genre.update({ where: { id }, data: input });
    await this.audit(actor, 'catalog.genre.updated', 'genre', id, input);
    return genre;
  }

  public async deleteGenre(actor: Actor, id: string) {
    await this.mustExist('genre', id, () => this.prisma.client.genre.findUnique({ where: { id } }));
    await this.prisma.client.genre.delete({ where: { id } });
    await this.audit(actor, 'catalog.genre.deleted', 'genre', id, {});
  }

  // ── Séries ────────────────────────────────────────────────────────────────

  public async listSeries(q: { status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; q?: string; page: number; perPage: number }) {
    const where: Prisma.SeriesWhereInput = {
      deletedAt: null,
      ...(q.status ? { status: q.status } : {}),
      ...(q.q
        ? {
            OR: [
              { titleFr: { contains: q.q, mode: 'insensitive' } },
              { titleEn: { contains: q.q, mode: 'insensitive' } },
              { slug: { contains: q.q.toLowerCase() } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.client.series.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: (q.page - 1) * q.perPage,
        take: q.perPage,
        include: {
          genres: { include: { genre: true } },
          licenses: { include: { license: true } },
          _count: { select: { episodes: true } },
        },
      }),
      this.prisma.client.series.count({ where }),
    ]);
    const publishedCounts = await this.publishedEpisodeCounts(rows.map((r) => r.id));
    const live = await this.tenantStatuses(rows.map((r) => r.id));
    const now = new Date();
    const items = rows.map((s) => ({
      id: s.id,
      slug: s.slug,
      status: s.status,
      titleFr: s.titleFr,
      titleEn: s.titleEn,
      posterUrl: s.posterUrl,
      genres: s.genres.map((g) => ({ id: g.genre.id, slug: g.genre.slug, nameFr: g.genre.nameFr })),
      episodeCount: s._count.episodes,
      publishedEpisodeCount: publishedCounts.get(s.id) ?? 0,
      licensed: isLicensed(s.licenses.map((l) => l.license), this.tenant.get().defaultCountry, now, true),
      tenantStatus: live.get(s.id) ?? 'HIDDEN',
      updatedAt: s.updatedAt,
    }));
    return PaginatedResult.offset(items, total, q.page, q.perPage);
  }

  public async getSeries(id: string) {
    const s = await this.prisma.client.series.findFirst({
      where: { id, deletedAt: null },
      include: {
        genres: { include: { genre: true } },
        licenses: { include: { license: true } },
        episodes: {
          orderBy: { number: 'asc' },
          include: { video: true, subtitles: true, _count: { select: { entitlements: true } } },
        },
      },
    });
    if (!s) throw new ResourceNotFoundError('series', id);
    const tenantSeries = await this.prisma.client.tenantSeries.findFirst({ where: { seriesId: id } });
    return {
      ...s,
      genres: s.genres.map((g) => g.genre),
      licenses: s.licenses.map((l) => l.license),
      episodes: s.episodes.map(({ _count, ...e }) => ({ ...e, unlockCount: _count.entitlements })),
      tenantSeries,
    };
  }

  public async createSeries(actor: Actor, input: SeriesInput & { titleFr: string }) {
    const slug = input.slug ?? slugify(input.titleFr);
    if (!slug) throw new BusinessRuleViolationError('SERIES_SLUG_INVALID', 'Impossible de déduire un slug du titre');
    const { genreIds, ...data } = input;
    const series = await this.unique(
      () =>
        this.prisma.client.series.create({
          data: {
            ...data,
            slug,
            titleFr: input.titleFr,
            ...(genreIds?.length ? { genres: { create: genreIds.map((genreId) => ({ genreId })) } } : {}),
          },
        }),
      'Une série porte déjà ce slug',
    );
    await this.audit(actor, 'catalog.series.created', 'series', series.id, { slug, titleFr: input.titleFr });
    return this.getSeries(series.id);
  }

  public async updateSeries(actor: Actor, id: string, input: SeriesInput) {
    await this.getSeries(id);
    const { genreIds, ...data } = input;
    await this.unique(
      () =>
        this.prisma.client.series.update({
          where: { id },
          data: {
            ...data,
            ...(genreIds
              ? { genres: { deleteMany: {}, create: genreIds.map((genreId) => ({ genreId })) } }
              : {}),
          },
        }),
      'Une série porte déjà ce slug',
    );
    await this.audit(actor, 'catalog.series.updated', 'series', id, input);
    return this.getSeries(id);
  }

  /**
   * Publication dans le CATALOGUE (FR-ADM-004) : au moins un épisode publié et une
   * licence en cours. La diffusion par une marque se décide ensuite (vitrine).
   */
  public async publishSeries(actor: Actor, id: string) {
    const s = await this.getSeries(id);
    if (!s.episodes.some((e) => e.status === 'PUBLISHED')) {
      throw new BusinessRuleViolationError('SERIES_HAS_NO_EPISODE', 'Publiez au moins un épisode avant la série');
    }
    const now = new Date();
    if (!s.licenses.some((l) => now >= l.startsAt && now < l.endsAt)) {
      throw new BusinessRuleViolationError('SERIES_NOT_LICENSED', 'Aucune licence en cours pour cette série');
    }
    await this.prisma.client.series.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: s.publishedAt ?? now },
    });
    await this.audit(actor, 'catalog.series.published', 'series', id, {});
    return this.getSeries(id);
  }

  public async unpublishSeries(actor: Actor, id: string) {
    await this.getSeries(id);
    await this.prisma.client.series.update({ where: { id }, data: { status: 'DRAFT' } });
    await this.audit(actor, 'catalog.series.unpublished', 'series', id, {});
    return this.getSeries(id);
  }

  public async archiveSeries(actor: Actor, id: string) {
    await this.getSeries(id);
    await this.prisma.client.series.update({ where: { id }, data: { status: 'ARCHIVED', deletedAt: new Date() } });
    await this.audit(actor, 'catalog.series.archived', 'series', id, {});
  }

  // ── Épisodes ──────────────────────────────────────────────────────────────

  public async createEpisode(
    actor: Actor,
    seriesId: string,
    input: { number?: number; titleFr?: string; titleEn?: string; priceCoinsOverride?: number },
  ) {
    await this.getSeries(seriesId);
    const number = input.number ?? (await this.nextEpisodeNumber(seriesId));
    const episode = await this.unique(
      () => this.prisma.client.episode.create({ data: { ...input, seriesId, number } }),
      `L'épisode ${number} existe déjà`,
    );
    await this.audit(actor, 'catalog.episode.created', 'episode', episode.id, { seriesId, number });
    return episode;
  }

  public async createEpisodesBulk(actor: Actor, seriesId: string, count: number) {
    await this.getSeries(seriesId);
    const first = await this.nextEpisodeNumber(seriesId);
    await this.prisma.client.episode.createMany({
      data: Array.from({ length: count }, (_, i) => ({ seriesId, number: first + i })),
      skipDuplicates: true,
    });
    await this.audit(actor, 'catalog.episode.bulk_created', 'series', seriesId, { from: first, count });
    return { created: count, fromNumber: first, toNumber: first + count - 1 };
  }

  public async getEpisode(id: string) {
    const e = await this.prisma.client.episode.findUnique({
      where: { id },
      include: { video: true, subtitles: true, series: { select: { id: true, slug: true, titleFr: true } } },
    });
    if (!e) throw new ResourceNotFoundError('episode', id);
    return e;
  }

  public async updateEpisode(
    actor: Actor,
    id: string,
    input: { titleFr?: string | null; titleEn?: string | null; priceCoinsOverride?: number | null; thumbnailUrl?: string },
  ) {
    await this.getEpisode(id);
    await this.prisma.client.episode.update({ where: { id }, data: input });
    await this.audit(actor, 'catalog.episode.updated', 'episode', id, input);
    return this.getEpisode(id);
  }

  public async publishEpisode(actor: Actor, id: string) {
    const e = await this.getEpisode(id);
    if (!e.video || e.video.status !== 'READY') {
      throw new BusinessRuleViolationError('EPISODE_VIDEO_NOT_READY', "La vidéo de l'épisode n'est pas prête");
    }
    await this.prisma.client.episode.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: e.publishedAt ?? new Date(), durationSeconds: e.durationSeconds ?? e.video.durationSeconds },
    });
    await this.audit(actor, 'catalog.episode.published', 'episode', id, {});
    return this.getEpisode(id);
  }

  /** Tous les épisodes dont la vidéo est prête, en une fois (import en lot). */
  public async publishReadyEpisodes(actor: Actor, seriesId: string) {
    await this.getSeries(seriesId);
    const ready = await this.prisma.client.episode.findMany({
      where: { seriesId, status: 'DRAFT', video: { status: 'READY' } },
      include: { video: true },
    });
    for (const e of ready) {
      await this.prisma.client.episode.update({
        where: { id: e.id },
        data: { status: 'PUBLISHED', publishedAt: new Date(), durationSeconds: e.durationSeconds ?? e.video?.durationSeconds },
      });
    }
    await this.audit(actor, 'catalog.episode.bulk_published', 'series', seriesId, { count: ready.length });
    return { published: ready.length };
  }

  public async withdrawEpisode(actor: Actor, id: string) {
    await this.getEpisode(id);
    await this.prisma.client.episode.update({ where: { id }, data: { status: 'WITHDRAWN' } });
    await this.audit(actor, 'catalog.episode.withdrawn', 'episode', id, {});
    return this.getEpisode(id);
  }

  /** Suppression d'un brouillon jamais acheté ; sinon, retirer l'épisode. */
  public async deleteEpisode(actor: Actor, id: string) {
    const e = await this.getEpisode(id);
    const unlocks = await this.prisma.client.entitlement.count({ where: { episodeId: id } });
    if (e.status === 'PUBLISHED' || unlocks > 0) {
      throw new BusinessRuleViolationError('EPISODE_IN_USE', 'Épisode publié ou déjà acheté : retirez-le plutôt');
    }
    await this.prisma.client.episode.delete({ where: { id } });
    await this.audit(actor, 'catalog.episode.deleted', 'episode', id, {});
  }

  public async setSubtitle(actor: Actor, episodeId: string, locale: 'fr' | 'en', url: string) {
    await this.getEpisode(episodeId);
    await this.prisma.client.subtitleTrack.upsert({
      where: { episodeId_locale: { episodeId, locale } },
      create: { episodeId, locale, url },
      update: { url },
    });
    await this.audit(actor, 'catalog.subtitle.set', 'episode', episodeId, { locale });
    return this.getEpisode(episodeId);
  }

  public async removeSubtitle(actor: Actor, episodeId: string, locale: 'fr' | 'en') {
    await this.prisma.client.subtitleTrack.deleteMany({ where: { episodeId, locale } });
    await this.audit(actor, 'catalog.subtitle.removed', 'episode', episodeId, { locale });
    return this.getEpisode(episodeId);
  }

  // ── Licences ──────────────────────────────────────────────────────────────

  public listLicenses() {
    return this.prisma.client.license
      .findMany({ orderBy: { endsAt: 'asc' }, include: { series: { include: { series: { select: { id: true, slug: true, titleFr: true } } } } } })
      .then((rows) => rows.map((l) => ({ ...l, series: l.series.map((s) => s.series) })));
  }

  public async createLicense(actor: Actor, input: LicenseInput & { licensorName: string; contractRef: string; startsAt: string; endsAt: string; territories: string[] }) {
    this.assertPeriod(input.startsAt, input.endsAt);
    const { seriesIds, ...data } = input;
    const license = await this.prisma.client.license.create({
      data: {
        ...data,
        startsAt: new Date(input.startsAt),
        endsAt: new Date(input.endsAt),
        ...(seriesIds?.length ? { series: { create: seriesIds.map((seriesId) => ({ seriesId })) } } : {}),
      },
    });
    await this.audit(actor, 'catalog.license.created', 'license', license.id, { contractRef: input.contractRef });
    return license;
  }

  public async updateLicense(actor: Actor, id: string, input: LicenseInput) {
    const current = await this.prisma.client.license.findUnique({ where: { id } });
    if (!current) throw new ResourceNotFoundError('license', id);
    this.assertPeriod(input.startsAt ?? current.startsAt.toISOString(), input.endsAt ?? current.endsAt.toISOString());
    const { seriesIds, startsAt, endsAt, ...data } = input;
    const license = await this.prisma.client.license.update({
      where: { id },
      data: {
        ...data,
        ...(startsAt ? { startsAt: new Date(startsAt) } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt) } : {}),
        ...(seriesIds ? { series: { deleteMany: {}, create: seriesIds.map((seriesId) => ({ seriesId })) } } : {}),
      },
    });
    await this.audit(actor, 'catalog.license.updated', 'license', id, input);
    return license;
  }

  public async deleteLicense(actor: Actor, id: string) {
    const current = await this.prisma.client.license.findUnique({ where: { id } });
    if (!current) throw new ResourceNotFoundError('license', id);
    await this.prisma.client.license.delete({ where: { id } });
    await this.audit(actor, 'catalog.license.deleted', 'license', id, {});
  }

  // ── Vitrine de la marque courante (tenant_series, RLS) ─────────────────────

  public async listTenantSeries(q: { q?: string; status?: 'HIDDEN' | 'LIVE' }) {
    const series = await this.prisma.client.series.findMany({
      where: {
        deletedAt: null,
        status: 'PUBLISHED',
        ...(q.q ? { OR: [{ titleFr: { contains: q.q, mode: 'insensitive' } }, { slug: { contains: q.q.toLowerCase() } }] } : {}),
      },
      orderBy: { titleFr: 'asc' },
      include: { licenses: { include: { license: true } }, _count: { select: { episodes: true } } },
    });
    const rows = await this.prisma.client.tenantSeries.findMany({});
    const byId = new Map(rows.map((r) => [r.seriesId, r]));
    const ctx = this.tenant.get();
    const now = new Date();
    return series
      .map((s) => {
        const ts = byId.get(s.id);
        return {
          seriesId: s.id,
          slug: s.slug,
          titleFr: s.titleFr,
          posterUrl: s.posterUrl,
          episodeCount: s._count.episodes,
          freeEpisodes: s.freeEpisodes,
          episodePriceCoins: s.episodePriceCoins,
          licensedForTenant: isLicensed(s.licenses.map((l) => l.license), ctx.defaultCountry, now, ctx.isFirstParty ?? false),
          status: ts?.status ?? 'HIDDEN',
          featured: ts?.featured ?? false,
          position: ts?.position ?? 0,
          freeEpisodesOverride: ts?.freeEpisodesOverride ?? null,
          episodePriceCoinsOverride: ts?.episodePriceCoinsOverride ?? null,
        };
      })
      .filter((r) => !q.status || r.status === q.status);
  }

  public async setTenantSeries(
    actor: Actor,
    seriesId: string,
    input: { status: 'HIDDEN' | 'LIVE'; featured?: boolean; position?: number; freeEpisodesOverride?: number | null; episodePriceCoinsOverride?: number | null },
  ) {
    const s = await this.prisma.client.series.findFirst({
      where: { id: seriesId, deletedAt: null },
      include: { licenses: { include: { license: true } } },
    });
    if (!s) throw new ResourceNotFoundError('series', seriesId);
    if (input.status === 'LIVE') {
      if (s.status !== 'PUBLISHED') {
        throw new BusinessRuleViolationError('SERIES_NOT_PUBLISHED', "La série n'est pas publiée au catalogue");
      }
      const ctx = this.tenant.get();
      // Marque tierce : seule une licence avec droit de sous-licence l'autorise (R-02, D-13).
      if (!isLicensed(s.licenses.map((l) => l.license), ctx.defaultCountry, new Date(), ctx.isFirstParty ?? false)) {
        throw new BusinessRuleViolationError('SERIES_NOT_LICENSED_FOR_TENANT', "Aucune licence n'autorise cette marque à diffuser la série");
      }
    }
    const tenantId = this.tenant.tenantId;
    const row = await this.prisma.client.tenantSeries.upsert({
      where: { tenantId_seriesId: { tenantId, seriesId } },
      create: { seriesId, ...input } as never,
      update: input,
    });
    await this.audit(actor, 'storefront.series.updated', 'series', seriesId, input);
    return row;
  }

  // ── Utilitaires ───────────────────────────────────────────────────────────

  private async nextEpisodeNumber(seriesId: string): Promise<number> {
    const last = await this.prisma.client.episode.findFirst({ where: { seriesId }, orderBy: { number: 'desc' }, select: { number: true } });
    return (last?.number ?? 0) + 1;
  }

  private async publishedEpisodeCounts(seriesIds: string[]) {
    if (!seriesIds.length) return new Map<string, number>();
    const rows = await this.prisma.client.episode.groupBy({
      by: ['seriesId'],
      where: { seriesId: { in: seriesIds }, status: 'PUBLISHED' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.seriesId, r._count._all]));
  }

  private async tenantStatuses(seriesIds: string[]) {
    if (!seriesIds.length) return new Map<string, string>();
    const rows = await this.prisma.client.tenantSeries.findMany({ where: { seriesId: { in: seriesIds } } });
    return new Map(rows.map((r) => [r.seriesId, r.status as string]));
  }

  private assertPeriod(startsAt: string, endsAt: string) {
    if (new Date(endsAt) <= new Date(startsAt)) {
      throw new BusinessRuleViolationError('LICENSE_PERIOD_INVALID', 'La fin de licence doit suivre son début');
    }
  }

  private async mustExist<T>(resource: string, id: string, find: () => Promise<T | null>): Promise<T> {
    const found = await find();
    if (!found) throw new ResourceNotFoundError(resource, id);
    return found;
  }

  private async unique<T>(run: () => Promise<T>, message: string): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({ code: 'DUPLICATE_RESOURCE', message });
      }
      throw error;
    }
  }

  private async audit(actor: Actor, action: string, resourceType: string, resourceId: string, after: Record<string, unknown>) {
    await this.prisma.client.auditLog.create({
      data: { actorId: actor.userId, action, resourceType, resourceId, after: after as Prisma.InputJsonValue } as never,
    });
  }
}

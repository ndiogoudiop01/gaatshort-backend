import { Injectable, Logger } from '@nestjs/common';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';
import { planImport, type RowError, type SeriesFields, type SeriesPlan } from '../domain/services/catalog-csv';
import { CatalogAdminService, type Actor } from './catalog-admin.service';
import { MediaService } from './media.service';

export type RowAction = 'CREATED' | 'UPDATED' | 'UNCHANGED' | 'ERROR';
export type VideoAction = 'QUEUED' | 'ALREADY_PRESENT' | 'NONE' | 'ERROR';

export interface ImportRowResult {
  line: number;
  seriesSlug: string;
  episodeNumber: number;
  episode: RowAction;
  video: VideoAction;
  message?: string;
}

export interface ImportReport {
  dryRun: boolean;
  totals: {
    rows: number;
    seriesCreated: number;
    seriesUpdated: number;
    episodesCreated: number;
    episodesUpdated: number;
    videosQueued: number;
    videosAlreadyPresent: number;
    errors: number;
  };
  series: { slug: string; action: RowAction; id?: string; message?: string }[];
  rows: ImportRowResult[];
  errors: RowError[];
  warnings: RowError[];
}

/**
 * Import en lot (BO-17). IDEMPOTENT : la série est retrouvée par son slug, l'épisode par
 * (série, numéro) ; une vidéo n'est importée que si l'épisode n'en a pas déjà une utilisable.
 * Rejouer le même fichier ne crée rien en double et ne relance aucun encodage.
 *
 * `dryRun` : même analyse, aucune écriture — le rapport annonce ce qui SERAIT fait.
 * Les séries créées restent en BROUILLON : la publication garde ses contrôles (licence…).
 */
@Injectable()
export class CatalogImportService {
  private readonly logger = new Logger(CatalogImportService.name);

  constructor(
    private readonly prisma: TenantPrismaService,
    private readonly catalog: CatalogAdminService,
    private readonly media: MediaService,
  ) {}

  public async import(actor: Actor, csv: string, dryRun: boolean): Promise<ImportReport> {
    const { plans, errors, warnings } = planImport(csv);
    const report: ImportReport = {
      dryRun,
      totals: { rows: 0, seriesCreated: 0, seriesUpdated: 0, episodesCreated: 0, episodesUpdated: 0, videosQueued: 0, videosAlreadyPresent: 0, errors: errors.length },
      series: [],
      rows: [],
      errors: [...errors],
      warnings: [...warnings],
    };

    const genreSlugs = [...new Set(plans.flatMap((p) => p.series.genreSlugs ?? []))];
    const genres = genreSlugs.length
      ? await this.prisma.client.genre.findMany({ where: { slug: { in: genreSlugs } }, select: { id: true, slug: true } })
      : [];
    const genreId = new Map(genres.map((g) => [g.slug, g.id]));
    const unknownGenres = genreSlugs.filter((g) => !genreId.has(g));
    if (unknownGenres.length) {
      report.warnings.push({ line: 1, message: `Genres inconnus ignorés : ${unknownGenres.join(', ')} (créez-les d’abord)` });
    }

    const ingests: IngestJob[] = [];
    for (const plan of plans) {
      await this.importSeries(actor, plan, genreId, dryRun, report, ingests);
    }
    // Les vidéos partent en parallèle (le fournisseur télécharge et encode de son côté) :
    // c'est ce qui permet à un fichier de 1 000 lignes de tenir dans la requête.
    await runPool(ingests, INGEST_CONCURRENCY, async (job) => {
      try {
        await this.media.ingestEpisodeFromUrl(actor, job.episodeId, job.url);
      } catch (e) {
        job.row.video = 'ERROR';
        job.row.message = errorMessage(e);
        report.totals.videosQueued--;
        this.logger.warn(`Import ligne ${job.row.line} : vidéo non lancée (${job.row.message})`);
      }
    });
    report.totals.rows = report.rows.length;
    report.totals.errors = report.errors.length + report.rows.filter((r) => r.episode === 'ERROR' || r.video === 'ERROR').length;

    if (!dryRun) {
      await this.prisma.client.auditLog.create({
        data: { actorId: actor.userId, action: 'catalog.import.completed', resourceType: 'catalog', resourceId: null, after: report.totals } as never,
      });
    }
    return report;
  }

  private async importSeries(
    actor: Actor, plan: SeriesPlan, genreId: Map<string, string>, dryRun: boolean, report: ImportReport, ingests: IngestJob[],
  ) {
    const { series: fields } = plan;
    const genreIds = fields.genreSlugs?.map((g) => genreId.get(g)).filter((id): id is string => !!id);
    const input = { ...seriesInput(fields), ...(genreIds?.length ? { genreIds } : {}) };

    let seriesId: string | undefined;
    try {
      const existing = await this.prisma.client.series.findUnique({
        where: { slug: fields.slug },
        select: { id: true, titleFr: true, synopsisFr: true, maturityRating: true, releaseYear: true, freeEpisodes: true, episodePriceCoins: true, posterUrl: true, bannerUrl: true, deletedAt: true, genres: { select: { genreId: true } } },
      });
      if (existing?.deletedAt) throw new Error('série archivée : restaurez-la avant de l’importer');
      if (!existing) {
        seriesId = dryRun ? undefined : (await this.catalog.createSeries(actor, { ...input, slug: fields.slug, titleFr: fields.titleFr })).id;
        report.totals.seriesCreated++;
        report.series.push({ slug: fields.slug, action: 'CREATED', id: seriesId });
      } else {
        seriesId = existing.id;
        const changed = changedSeriesFields(existing, input);
        if (Object.keys(changed).length) {
          if (!dryRun) await this.catalog.updateSeries(actor, existing.id, changed);
          report.totals.seriesUpdated++;
          report.series.push({ slug: fields.slug, action: 'UPDATED', id: existing.id });
        } else {
          report.series.push({ slug: fields.slug, action: 'UNCHANGED', id: existing.id });
        }
      }
    } catch (e) {
      const message = errorMessage(e);
      report.series.push({ slug: fields.slug, action: 'ERROR', message });
      for (const ep of plan.episodes) {
        report.rows.push({ line: ep.line, seriesSlug: fields.slug, episodeNumber: ep.number, episode: 'ERROR', video: 'NONE', message: `Série : ${message}` });
      }
      return;
    }

    const existingEpisodes = seriesId
      ? await this.prisma.client.episode.findMany({
          where: { seriesId, number: { in: plan.episodes.map((e) => e.number) } },
          select: { id: true, number: true, titleFr: true, priceCoinsOverride: true, video: { select: { status: true } } },
        })
      : [];
    const byNumber = new Map(existingEpisodes.map((e) => [e.number, e]));

    for (const ep of plan.episodes) {
      const row: ImportRowResult = { line: ep.line, seriesSlug: fields.slug, episodeNumber: ep.number, episode: 'UNCHANGED', video: 'NONE' };
      report.rows.push(row);
      try {
        const current = byNumber.get(ep.number);
        let episodeId = current?.id;
        if (!current) {
          if (!dryRun && seriesId) {
            episodeId = (await this.catalog.createEpisode(actor, seriesId, { number: ep.number, titleFr: ep.titleFr, priceCoinsOverride: ep.priceCoinsOverride })).id;
          }
          row.episode = 'CREATED';
          report.totals.episodesCreated++;
        } else {
          const patch: { titleFr?: string; priceCoinsOverride?: number } = {};
          if (ep.titleFr !== undefined && ep.titleFr !== current.titleFr) patch.titleFr = ep.titleFr;
          if (ep.priceCoinsOverride !== undefined && ep.priceCoinsOverride !== current.priceCoinsOverride) patch.priceCoinsOverride = ep.priceCoinsOverride;
          if (Object.keys(patch).length) {
            if (!dryRun) await this.catalog.updateEpisode(actor, current.id, patch);
            row.episode = 'UPDATED';
            report.totals.episodesUpdated++;
          }
        }

        if (ep.videoUrl) {
          const usable = current?.video && current.video.status !== 'FAILED';
          if (usable) {
            row.video = 'ALREADY_PRESENT';
            report.totals.videosAlreadyPresent++;
          } else {
            if (!dryRun && episodeId) ingests.push({ row, episodeId, url: ep.videoUrl });
            row.video = 'QUEUED';
            report.totals.videosQueued++;
          }
        }
      } catch (e) {
        row.message = errorMessage(e);
        row.episode = 'ERROR';
        this.logger.warn(`Import ligne ${ep.line} (${fields.slug} #${ep.number}) : ${row.message}`);
      }
    }
  }
}

const INGEST_CONCURRENCY = 6;

interface IngestJob {
  row: ImportRowResult;
  episodeId: string;
  url: string;
}

/** Exécute `run` sur chaque élément, `size` à la fois au plus. */
async function runPool<T>(items: T[], size: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
}

function seriesInput(f: SeriesFields) {
  const out: Record<string, unknown> = { titleFr: f.titleFr };
  const map: [keyof SeriesFields, string][] = [
    ['synopsisFr', 'synopsisFr'], ['maturityRating', 'maturityRating'], ['releaseYear', 'releaseYear'],
    ['freeEpisodes', 'freeEpisodes'], ['episodePriceCoins', 'episodePriceCoins'], ['posterUrl', 'posterUrl'], ['bannerUrl', 'bannerUrl'],
  ];
  for (const [from, to] of map) if (f[from] !== undefined) out[to] = f[from];
  return out as {
    titleFr: string; synopsisFr?: string; maturityRating?: string; releaseYear?: number;
    freeEpisodes?: number; episodePriceCoins?: number; posterUrl?: string; bannerUrl?: string; genreIds?: string[];
  };
}

/** Ne renvoie que ce qui change : rejouer le fichier ne réécrit rien (ni audit inutile). */
function changedSeriesFields(current: Record<string, unknown> & { genres: { genreId: string }[] }, input: ReturnType<typeof seriesInput>) {
  const changed: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'genreIds') {
      const now = new Set(current.genres.map((g) => g.genreId));
      const next = v as string[];
      if (next.length !== now.size || next.some((id) => !now.has(id))) changed.genreIds = next;
    } else if (v !== undefined && current[k] !== v) changed[k] = v;
  }
  return changed;
}

function errorMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'getResponse' in e && typeof e.getResponse === 'function') {
    const r = (e as { getResponse: () => unknown }).getResponse();
    if (r && typeof r === 'object' && 'message' in r) return String(r.message);
  }
  return e instanceof Error ? e.message : 'Erreur inconnue';
}

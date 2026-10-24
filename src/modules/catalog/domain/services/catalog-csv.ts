import { slugify } from './episode-access';

/**
 * Import en lot du catalogue (BO-17) : une ligne CSV = un épisode. Les champs de série sont
 * lus sur la PREMIÈRE ligne de chaque série ; les lignes suivantes peuvent les laisser vides.
 * Fonctions pures : aucune écriture, testables sans base.
 */

export const IMPORT_COLUMNS = [
  'series_slug', 'series_title', 'synopsis', 'genres', 'maturity_rating', 'release_year',
  'free_episodes', 'episode_price_coins', 'poster_url', 'banner_url',
  'episode_number', 'episode_title', 'episode_price_override', 'video_url',
] as const;

/** Au-delà, découper le fichier : l'import tient dans une requête (2 min, vidéos en parallèle). */
export const MAX_IMPORT_ROWS = 1000;

export interface SeriesFields {
  slug: string;
  titleFr: string;
  synopsisFr?: string;
  genreSlugs?: string[];
  maturityRating?: string;
  releaseYear?: number;
  freeEpisodes?: number;
  episodePriceCoins?: number;
  posterUrl?: string;
  bannerUrl?: string;
}

export interface EpisodeRow {
  line: number;
  number: number;
  titleFr?: string;
  priceCoinsOverride?: number;
  videoUrl?: string;
}

export interface SeriesPlan {
  series: SeriesFields;
  episodes: EpisodeRow[];
}

export interface RowError {
  line: number;
  message: string;
}

/** CSV RFC 4180 (guillemets, retours à la ligne dans un champ) ; « ; » détecté (Excel en français). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.slice(0, src.search(/\r?\n|$/));
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === sep) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

const httpsUrl = (v: string) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

function intIn(v: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= min && n <= max ? n : null;
}

/** Lignes → séries à importer + erreurs par ligne (numéro de ligne du fichier, en-tête = 1). */
export function planImport(text: string): { plans: SeriesPlan[]; errors: RowError[]; warnings: RowError[] } {
  const rows = parseCsv(text);
  const errors: RowError[] = [];
  const warnings: RowError[] = [];
  if (!rows.length) return { plans: [], errors: [{ line: 1, message: 'Fichier vide' }], warnings };

  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ['series_title', 'episode_number'].filter((c) => !header.includes(c));
  if (missing.length) return { plans: [], errors: [{ line: 1, message: `Colonnes obligatoires manquantes : ${missing.join(', ')}` }], warnings };
  const unknown = header.filter((h) => h && !(IMPORT_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) warnings.push({ line: 1, message: `Colonnes ignorées : ${unknown.join(', ')}` });
  if (rows.length - 1 > MAX_IMPORT_ROWS) {
    return { plans: [], errors: [{ line: 1, message: `Trop de lignes (${rows.length - 1}) : ${MAX_IMPORT_ROWS} au maximum par fichier` }], warnings };
  }

  const bySlug = new Map<string, SeriesPlan>();
  const seen = new Set<string>();

  rows.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (col: (typeof IMPORT_COLUMNS)[number]) => {
      const idx = header.indexOf(col);
      return idx >= 0 ? (cells[idx] ?? '').trim() : '';
    };
    const fail = (message: string) => errors.push({ line, message });

    const title = get('series_title');
    const slug = get('series_slug') ? slugify(get('series_slug')) : slugify(title);
    if (!slug) return fail('series_title (ou series_slug) requis');
    const number = intIn(get('episode_number'), 1, 10_000);
    if (number === null) return fail('episode_number : entier ≥ 1 attendu');
    const key = `${slug}#${number}`;
    if (seen.has(key)) return fail(`Épisode ${number} de « ${slug} » en double dans le fichier`);

    const episode: EpisodeRow = { line, number };
    const epTitle = get('episode_title');
    if (epTitle) episode.titleFr = epTitle.slice(0, 200);
    const override = get('episode_price_override');
    if (override) {
      const n = intIn(override, 0, 10_000);
      if (n === null) return fail('episode_price_override : entier entre 0 et 10000');
      episode.priceCoinsOverride = n;
    }
    const video = get('video_url');
    if (video) {
      if (!httpsUrl(video)) return fail('video_url : adresse https attendue');
      episode.videoUrl = video;
    }

    let plan = bySlug.get(slug);
    if (!plan) {
      if (!title) return fail(`series_title requis sur la première ligne de « ${slug} »`);
      const series: SeriesFields = { slug, titleFr: title.slice(0, 200) };
      const synopsis = get('synopsis');
      if (synopsis) series.synopsisFr = synopsis.slice(0, 4000);
      const genres = get('genres');
      if (genres) series.genreSlugs = [...new Set(genres.split('|').map((g) => slugify(g)).filter(Boolean))];
      const rating = get('maturity_rating');
      if (rating) {
        if (!/^(TP|\d{1,2}\+)$/.test(rating)) return fail('maturity_rating : « TP », « 13+ », « 16+ »…');
        series.maturityRating = rating;
      }
      const numeric: [keyof SeriesFields, (typeof IMPORT_COLUMNS)[number], number, number][] = [
        ['releaseYear', 'release_year', 1900, 2100],
        ['freeEpisodes', 'free_episodes', 0, 1000],
        ['episodePriceCoins', 'episode_price_coins', 0, 10_000],
      ];
      for (const [field, col, min, max] of numeric) {
        const v = get(col);
        if (!v) continue;
        const n = intIn(v, min, max);
        if (n === null) return fail(`${col} : entier entre ${min} et ${max}`);
        (series as unknown as Record<string, number>)[field] = n;
      }
      for (const [field, col] of [['posterUrl', 'poster_url'], ['bannerUrl', 'banner_url']] as const) {
        const v = get(col);
        if (!v) continue;
        if (!httpsUrl(v)) return fail(`${col} : adresse https attendue`);
        series[field] = v;
      }
      plan = { series, episodes: [] };
      bySlug.set(slug, plan);
    }
    seen.add(key);
    plan.episodes.push(episode);
  });

  for (const p of bySlug.values()) p.episodes.sort((a, b) => a.number - b.number);
  return { plans: [...bySlug.values()], errors, warnings };
}

/**
 * Façade publique du catalogue, consommée par les modules `wallet`, `library`
 * et `billing`. Elle répond TOUJOURS pour la marque courante (contexte tenant) :
 * une série n'y apparaît que publiée au catalogue, diffusée par la marque
 * (tenant_series LIVE) et couverte par une licence pour le pays demandé.
 */
export const CATALOG_FACADE = Symbol('CATALOG_FACADE');

export type Locale = 'fr' | 'en';

export interface GenreView {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export interface SeriesCard {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly synopsis: string;
  readonly posterUrl: string | null;
  readonly bannerUrl: string | null;
  readonly maturityRating: string;
  readonly releaseYear: number | null;
  readonly tags: readonly string[];
  readonly genres: readonly GenreView[];
  readonly episodeCount: number;
  readonly freeEpisodes: number;
  readonly featured: boolean;
  readonly publishedAt: Date | null;
}

export interface EpisodeView {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly durationSeconds: number | null;
  readonly thumbnailUrl: string | null;
  readonly isFree: boolean;
  readonly priceCoins: number;
}

export interface SeriesDetail extends SeriesCard {
  readonly episodes: readonly EpisodeView[];
}

export interface PlayableEpisode {
  readonly episode: EpisodeView;
  readonly seriesId: string;
  readonly seriesSlug: string;
  readonly videoReady: boolean;
  readonly subtitles: readonly { locale: string; url: string }[];
  readonly nextEpisodeId: string | null;
}

export interface CatalogFacade {
  listGenres(locale: Locale): Promise<GenreView[]>;
  listLiveSeries(params: {
    country: string;
    locale: Locale;
    genreSlug?: string;
    q?: string;
    ids?: readonly string[];
    sort?: 'position' | 'new';
    featuredOnly?: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ items: SeriesCard[]; total: number }>;
  getLiveSeries(slugOrId: string, country: string, locale: Locale): Promise<SeriesDetail>;
  /** Épisode publié d'une série diffusée et licenciée ; 404 sinon. */
  getPlayableEpisode(episodeId: string, country: string, locale: Locale): Promise<PlayableEpisode>;
  /** URL HLS signée ; à n'appeler QU'APRÈS le contrôle des droits. */
  signedPlaybackUrl(episodeId: string): Promise<{ url: string; expiresAt: Date }>;
}

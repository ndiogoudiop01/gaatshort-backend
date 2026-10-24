import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, IsUUID,
  Matches, Max, MaxLength, Min, MinLength,
} from 'class-validator';
import { OffsetPaginationQueryDto } from '@shared/dto/pagination-query.dto';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_OPTS = { require_tld: false, require_protocol: true };

export class GenreDto {
  @ApiProperty({ example: 'romance' }) @IsString() @Matches(SLUG) @MaxLength(40) public slug: string;
  @ApiProperty({ example: 'Romance' }) @IsString() @MinLength(1) @MaxLength(60) public nameFr: string;
  @ApiProperty({ example: 'Romance' }) @IsString() @MinLength(1) @MaxLength(60) public nameEn: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) public position?: number;
}

export class UpdateGenreDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) public nameFr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(60) public nameEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) public position?: number;
}

export class ListSeriesQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] })
  @IsOptional() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED'])
  public status?: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

  @ApiPropertyOptional({ description: 'Recherche dans le titre ou le slug' })
  @IsOptional() @IsString() @MaxLength(100)
  public q?: string;
}

export class SeriesBodyDto {
  @ApiPropertyOptional({ description: 'Déduit du titre si absent' })
  @IsOptional() @IsString() @Matches(SLUG) @MaxLength(80)
  public slug?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) public titleFr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) public titleEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) public synopsisFr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) public synopsisEn?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en'] }) @IsOptional() @IsIn(['fr', 'en']) public originalLocale?: 'fr' | 'en';
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTS) @MaxLength(1000) public posterUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTS) @MaxLength(1000) public bannerUrl?: string;
  @ApiPropertyOptional({ example: '13+' }) @IsOptional() @IsString() @MaxLength(8) public maturityRating?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1900) @Max(2100) public releaseYear?: number;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(40, { each: true }) public tags?: string[];
  @ApiPropertyOptional({ default: 5 }) @IsOptional() @IsInt() @Min(0) @Max(1000) public freeEpisodes?: number;
  @ApiPropertyOptional({ default: 15 }) @IsOptional() @IsInt() @Min(1) @Max(100000) public episodePriceCoins?: number;
  @ApiPropertyOptional({ type: [String], description: 'Identifiants de genres' })
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsUUID('all', { each: true })
  public genreIds?: string[];
}

export class CreateSeriesDto extends SeriesBodyDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) public declare titleFr: string;
}

export class CreateEpisodeDto {
  @ApiPropertyOptional({ description: 'Numéro ; par défaut le suivant' }) @IsOptional() @IsInt() @Min(1) @Max(5000) public number?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) public titleFr?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) public titleEn?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) public priceCoinsOverride?: number;
}

export class BulkEpisodesDto {
  @ApiProperty({ description: "Nombre d'épisodes à créer à la suite", example: 60 })
  @IsInt() @Min(1) @Max(500)
  public count: number;
}

export class UpdateEpisodeDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) public titleFr?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) public titleEn?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(100000) public priceCoinsOverride?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTS) @MaxLength(1000) public thumbnailUrl?: string;
}

export class SubtitleDto {
  @ApiProperty({ description: 'URL du fichier WebVTT' }) @IsUrl(URL_OPTS) @MaxLength(1000) public url: string;
}

export class IngestVideoDto {
  @ApiProperty({ description: 'URL du fichier source, téléchargé par le fournisseur vidéo' })
  @IsUrl(URL_OPTS) @MaxLength(2000)
  public sourceUrl: string;
}

export class LicenseDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(160) public licensorName: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) public contractRef: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTS) @MaxLength(1000) public documentUrl?: string;
  @ApiProperty() @IsDateString() public startsAt: string;
  @ApiProperty() @IsDateString() public endsAt: string;
  @ApiProperty({ type: [String], example: ['SN', 'GM'] })
  @IsArray() @ArrayMaxSize(50) @Matches(/^[A-Z]{2}$/, { each: true })
  public territories: string[];
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() public sublicensingAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) public notes?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) public seriesIds?: string[];
}

export class UpdateLicenseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(160) public licensorName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(120) public contractRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl(URL_OPTS) @MaxLength(1000) public documentUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() public startsAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() public endsAt?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(50) @Matches(/^[A-Z]{2}$/, { each: true }) public territories?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() public sublicensingAllowed?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) public notes?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(500) @IsUUID('all', { each: true }) public seriesIds?: string[];
}

export class TenantSeriesDto {
  @ApiProperty({ enum: ['HIDDEN', 'LIVE'] }) @IsIn(['HIDDEN', 'LIVE']) public status: 'HIDDEN' | 'LIVE';
  @ApiPropertyOptional() @IsOptional() @IsBoolean() public featured?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(10000) public position?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(1000) public freeEpisodesOverride?: number | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(100000) public episodePriceCoinsOverride?: number | null;
}

export class StorefrontSeriesQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) public q?: string;
  @ApiPropertyOptional({ enum: ['HIDDEN', 'LIVE'] }) @IsOptional() @IsIn(['HIDDEN', 'LIVE']) public status?: 'HIDDEN' | 'LIVE';
}


export class CatalogImportDto {
  @ApiProperty({
    description: 'Contenu CSV (UTF-8, séparateur « , » ou « ; »). Une ligne par épisode ; colonnes : series_slug, series_title, synopsis, genres (slugs séparés par |), maturity_rating, release_year, free_episodes, episode_price_coins, poster_url, banner_url, episode_number, episode_title, episode_price_override, video_url.',
  })
  @IsString() @MinLength(1) @MaxLength(900_000) public csv: string;
  @ApiPropertyOptional({ default: true, description: 'Vrai : analyse et rapport, aucune écriture.' })
  @IsOptional() @IsBoolean() public dryRun?: boolean;
}

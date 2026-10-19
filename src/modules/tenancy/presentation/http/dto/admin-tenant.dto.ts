import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
  ValidateNested,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';
import { OffsetPaginationQueryDto } from '@shared/dto/pagination-query.dto';
import {
  TENANT_MAX_COUNTRIES,
  TENANT_STATUSES,
  type TenantStatusValue,
} from '../../../domain/services/tenant-admin-rules';

/**
 * BSG-13 — DTO VALIDÉS de l'administration des tenants.
 *
 * Avant : `PATCH /admin/tenants/:id` prenait `@Body() data: Record<string,
 * unknown>` et l'écrivait en `$privileged()` — la combinaison la plus
 * dangereuse du backend (corps non contrôlé × écriture qui franchit
 * l'isolation). Avec `whitelist` + `forbidNonWhitelisted` (ValidationPipe
 * global), tout champ absent de ces classes est refusé en 400, y compris à
 * l'intérieur de `branding` (`@ValidateNested`).
 */

export const TENANT_SORT_FIELDS = ['name', 'slug', 'status', 'createdAt', 'updatedAt'] as const;
export type TenantSortField = (typeof TENANT_SORT_FIELDS)[number];

const toArray = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const unlessNull = ValidateIf((_: unknown, value: unknown) => value !== null && value !== undefined);

const FLAG_KEY = /^[a-zA-Z][a-zA-Z0-9]{1,40}$/;

/** `{ cle: booléen }`, 30 clés au plus, clés en camelCase. */
function IsFeatureFlags(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isFeatureFlags',
      target: object.constructor,
      propertyName,
      options: {
        message: 'featureFlags doit être un objet { cleCamelCase: booléen } (30 clés au plus)',
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          return entries.length <= 30 && entries.every(([k, v]) => FLAG_KEY.test(k) && typeof v === 'boolean');
        },
      },
    });
}

export class ListTenantsDto extends OffsetPaginationQueryDto {
  /** `declare` : cf. `SearchApplicationsDto.sortBy` (useDefineForClassFields). */
  @ApiPropertyOptional({ enum: TENANT_SORT_FIELDS, default: 'name' })
  @IsOptional() @IsIn(TENANT_SORT_FIELDS)
  public declare sortBy?: TenantSortField;

  @ApiPropertyOptional({ isArray: true, enum: TENANT_STATUSES })
  @IsOptional() @Transform(toArray) @IsArray() @ArrayMaxSize(3) @IsIn(TENANT_STATUSES, { each: true })
  public statuses?: TenantStatusValue[];

  @ApiPropertyOptional({ description: 'Nom, raison sociale ou slug (contient)' })
  @IsOptional() @IsString() @MaxLength(120)
  public search?: string;
}

export class TenantBrandingDto {
  @ApiPropertyOptional({ nullable: true, example: '#0F5132' })
  @IsOptional() @unlessNull @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'primaryColor doit être une couleur #RRGGBB' })
  public primaryColor?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'https://cdn.exemple.org/logo.svg' })
  @IsOptional() @Transform(emptyToNull) @unlessNull @MaxLength(2048)
  @Matches(/^https:\/\/[^\s]+$/, { message: 'logoUrl doit être une adresse https://' })
  public logoUrl?: string | null;
}

/**
 * Liste blanche des champs modifiables — identique à `TENANT_EDITABLE_FIELDS`.
 * Absents à dessein : `slug` (résolution par sous-domaine, clés de cache),
 * `isolation` et `schemaName` (infrastructure), `settings`, `deletedAt`, les
 * domaines, `id`, `createdAt`.
 */
export class UpdateTenantDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 120 })
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  public name?: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(200)
  public legalName?: string | null;

  @ApiPropertyOptional({ enum: TENANT_STATUSES, description: 'SUSPENDED / ARCHIVED coupent l’accès IMMÉDIATEMENT' })
  @IsOptional() @IsIn(TENANT_STATUSES)
  public status?: TenantStatusValue;

  @ApiPropertyOptional({ example: 'fr' })
  @IsOptional() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  public defaultLocale?: string;

  @ApiPropertyOptional({ example: 'SN' })
  @IsOptional() @Matches(/^[A-Z]{2}$/)
  public defaultCountry?: string;

  @ApiPropertyOptional({ example: 'XOF' })
  @IsOptional() @Matches(/^[A-Z]{3}$/)
  public defaultCurrency?: string;

  @ApiPropertyOptional({ example: 'Africa/Dakar' })
  @IsOptional() @IsString() @MaxLength(64)
  public timezone?: string;

  @ApiPropertyOptional({ type: TenantBrandingDto })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => TenantBrandingDto)
  public branding?: TenantBrandingDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'boolean' }, example: { simulator: true } })
  @IsOptional() @IsFeatureFlags()
  public featureFlags?: Record<string, boolean>;
}

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const upperEach = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value) ? value.map((v: unknown) => (typeof v === 'string' ? v.trim().toUpperCase() : v)) : value;

/**
 * Création d'une organisation — liste blanche stricte (ValidationPipe global :
 * `forbidNonWhitelisted`). Absents à dessein : `isolation`, `schemaName`,
 * `settings`, `deletedAt`, `id`, les domaines.
 * Le format fin du slug, le fuseau par défaut et l'existence des pays et
 * devises sont vérifiés par le domaine et le service (422 `TENANT_INVALID`).
 */
export class CreateTenantDto {
  @ApiProperty({ example: 'kaay-cote-ivoire', description: 'Sous-domaine, immuable : 3–63 caractères a-z, 0-9, tiret' })
  @Transform(lower) @IsString() @MinLength(3) @MaxLength(63)
  public slug!: string;

  @ApiProperty({ minLength: 2, maxLength: 120, example: 'Gaatshort Côte d’Ivoire' })
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  public name!: string;

  @ApiPropertyOptional({ type: String, nullable: true, maxLength: 200 })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(200)
  public legalName?: string | null;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'SUSPENDED'], default: 'ACTIVE', description: 'SUSPENDED : préparer l’organisation avant ouverture' })
  @IsOptional() @IsIn(['ACTIVE', 'SUSPENDED'])
  public status?: 'ACTIVE' | 'SUSPENDED';

  @ApiPropertyOptional({ example: 'fr', default: 'fr' })
  @IsOptional() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  public defaultLocale?: string;

  @ApiProperty({ example: 'CI', description: 'Pays actif du référentiel' })
  @Transform(upper) @Matches(/^[A-Z]{2}$/)
  public defaultCountry!: string;

  @ApiPropertyOptional({ example: 'XOF', description: 'Par défaut : la devise du pays' })
  @IsOptional() @Transform(upper) @Matches(/^[A-Z]{3}$/)
  public defaultCurrency?: string;

  @ApiPropertyOptional({ example: 'Africa/Abidjan', description: 'Par défaut : le fuseau connu du pays' })
  @IsOptional() @IsString() @MaxLength(64)
  public timezone?: string;

  @ApiPropertyOptional({ type: [String], example: ['CI', 'BF'], description: 'Pays rattachés en plus du pays par défaut' })
  @IsOptional() @Transform(upperEach) @IsArray() @ArrayMaxSize(TENANT_MAX_COUNTRIES) @ArrayUnique()
  @Matches(/^[A-Z]{2}$/, { each: true })
  public countries?: string[];

  @ApiPropertyOptional({ type: TenantBrandingDto })
  @IsOptional() @IsObject() @ValidateNested() @Type(() => TenantBrandingDto)
  public branding?: TenantBrandingDto;

  @ApiPropertyOptional({ type: 'object', additionalProperties: { type: 'boolean' }, example: { simulator: true, academy: false } })
  @IsOptional() @IsFeatureFlags()
  public featureFlags?: Record<string, boolean>;
}

/** `DELETE /admin/tenants/:id?confirm=<slug>` — garde-fou contre le mauvais clic. */
export class DeleteTenantQueryDto {
  @ApiProperty({ example: 'kaay-cote-ivoire', description: 'Recopier le slug de l’organisation à supprimer' })
  @IsString() @MaxLength(63)
  public confirm!: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { OffsetPaginationQueryDto } from '@shared/dto/pagination-query.dto';
import { USER_SORT_FIELDS, USER_STATUSES, type UserSortField } from '../../../application/queries/admin-access.query';

/**
 * BSG-12 — DTO de l'écran Utilisateurs. `whitelist` + `forbidNonWhitelisted`
 * (ValidationPipe global) : un champ absent de ces classes est refusé en 400
 * — impossible de glisser `allCountries`, `passwordHash` ou `tenantId` dans
 * une modification de profil.
 */

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() || null : value;
const toArray = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.split(',').filter(Boolean) : value;
const unlessNull = ValidateIf((_: unknown, value: unknown) => value !== null && value !== undefined);

const COUNTRY = /^[A-Z]{2}$/;
const ROLE_KEY = /^[A-Z][A-Z0-9_]{2,39}$/;
const E164 = /^\+[1-9]\d{6,14}$/;

export class ListUsersDto extends OffsetPaginationQueryDto {
  /** `declare` : cf. `SearchApplicationsDto.sortBy` (useDefineForClassFields). */
  @ApiPropertyOptional({ enum: USER_SORT_FIELDS, default: 'createdAt' })
  @IsOptional() @IsIn(USER_SORT_FIELDS)
  public declare sortBy?: UserSortField;

  @ApiPropertyOptional({ isArray: true, type: String, example: ['ADMIN', 'MANAGER'] })
  @IsOptional() @Transform(toArray) @IsArray() @ArrayMaxSize(20) @Matches(ROLE_KEY, { each: true })
  public roles?: string[];

  @ApiPropertyOptional({ isArray: true, enum: USER_STATUSES })
  @IsOptional() @Transform(toArray) @IsArray() @ArrayMaxSize(3) @IsIn(USER_STATUSES, { each: true })
  public statuses?: string[];

  @ApiPropertyOptional({ description: 'E-mail, prénom, nom ou téléphone (contient)' })
  @IsOptional() @IsString() @MaxLength(200)
  public search?: string;

  @ApiPropertyOptional({ example: 'SN' })
  @IsOptional() @Matches(COUNTRY)
  public countryCode?: string;
}

class ProfileFields {
  @ApiPropertyOptional({ nullable: true, maxLength: 80 })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(80)
  public firstName?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 80 })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(80)
  public lastName?: string | null;

  @ApiPropertyOptional({ nullable: true, example: '+221771234567' })
  @IsOptional() @Transform(emptyToNull) @unlessNull @Matches(E164, { message: 'phoneE164 doit être au format +221771234567' })
  public phoneE164?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'SN', description: 'Pays de rattachement' })
  @IsOptional() @Transform(emptyToNull) @unlessNull @Matches(COUNTRY)
  public countryCode?: string | null;
}

export class CreateUserDto extends ProfileFields {
  @ApiProperty({ example: 'awa.diop@gaatshort.com' })
  @Transform(trim) @IsEmail() @MaxLength(254)
  public email: string;

  @ApiProperty({ type: [String], example: ['MANAGER'] })
  @IsArray() @ArrayMaxSize(10) @Matches(ROLE_KEY, { each: true })
  public roleKeys: string[];
}

export class UpdateUserDto extends ProfileFields {}

export class SetUserRolesDto {
  @ApiProperty({ type: [String], example: ['MANAGER'] })
  @IsArray() @ArrayMaxSize(10) @Matches(ROLE_KEY, { each: true })
  public roleKeys: string[];
}

export class SetUserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'SUSPENDED'] })
  @IsIn(['ACTIVE', 'SUSPENDED'])
  public status: 'ACTIVE' | 'SUSPENDED';
}

export class SetUserCountriesDto {
  @ApiProperty({ description: '`true` : tous les pays du tenant' })
  @IsBoolean()
  public allCountries: boolean;

  @ApiProperty({ type: [String], example: ['MA'], description: 'Pays accordés EN PLUS du pays de rattachement' })
  @IsArray() @ArrayMaxSize(50) @Matches(COUNTRY, { each: true })
  public countryScope: string[];
}

export class CreateRoleDto {
  @ApiProperty({ example: 'REGIONAL_MANAGER', description: 'Majuscules, chiffres et _ (3 à 40)' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(ROLE_KEY)
  public key: string;

  @ApiProperty({ example: 'Gestionnaire régional' })
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  public name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(300)
  public description?: string | null;

  @ApiPropertyOptional({ example: 'MANAGER', description: 'Rôle dont copier les permissions' })
  @IsOptional() @Matches(ROLE_KEY)
  public copyFrom?: string;
}

export class UpdateRoleDto {
  @ApiProperty() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  public name: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @Transform(emptyToNull) @unlessNull @IsString() @MaxLength(300)
  public description?: string | null;
}

export class SetRolePermissionsDto {
  @ApiProperty({ type: [String], example: ['pool:read', 'partner:read'] })
  @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) @Matches(/^[a-z]+(:[a-z]+)*$/, { each: true })
  public permissionKeys: string[];
}

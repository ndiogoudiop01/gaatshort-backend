import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

export class LocaleQueryDto {
  @ApiPropertyOptional({ enum: ['fr', 'en'] }) @IsOptional() @IsIn(['fr', 'en']) public locale?: 'fr' | 'en';
}

export class SeriesListQueryDto extends LocaleQueryDto {
  @ApiPropertyOptional({ description: 'Slug du genre' }) @IsOptional() @IsString() @Matches(/^[a-z0-9-]{1,40}$/) public genre?: string;
  @ApiPropertyOptional({ description: 'Recherche' }) @IsOptional() @IsString() @MaxLength(100) public q?: string;
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) public page = 1;
  @ApiPropertyOptional({ default: 24, maximum: 50 }) @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(50) public perPage = 24;
}

export class ProgressDto {
  @ApiProperty({ example: 42 }) @IsInt() @Min(0) @Max(86_400) public positionSeconds: number;
  @ApiPropertyOptional({ default: false }) @IsOptional() @IsBoolean() public completed?: boolean;
}

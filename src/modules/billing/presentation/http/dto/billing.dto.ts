import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from 'class-validator';
import { OffsetPaginationQueryDto } from '@shared/dto/pagination-query.dto';

export class CreateOrderDto {
  @ApiProperty() @IsUUID() public packId: string;

  @ApiPropertyOptional({ description: "URL de retour après paiement (origine autorisée ou schéma de l'application)" })
  @IsOptional() @IsString() @MaxLength(500)
  public returnUrl?: string;
}

export class MyOrdersQueryDto {
  @ApiPropertyOptional({ default: 20 }) @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  public limit = 20;
}

export class AdminOrdersQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'] })
  @IsOptional() @IsIn(['PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED'])
  public status?: string;

  @ApiPropertyOptional({ description: 'Référence (GS-…)' }) @IsOptional() @IsString() @MaxLength(40)
  public q?: string;
}

export class PackDto {
  @ApiProperty({ example: 'pack-300' }) @IsString() @Matches(/^[a-z0-9-]{2,40}$/) public code: string;
  @ApiProperty({ example: 300 }) @IsInt() @Min(1) @Max(1_000_000) public coins: number;
  @ApiPropertyOptional({ example: 30 }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) public bonusCoins?: number;
  @ApiPropertyOptional({ default: 'XOF' }) @IsOptional() @IsIn(['XOF', 'GMD']) public currencyCode?: string;
  @ApiProperty({ description: 'Prix en unités mineures (XOF : francs)', example: 1000 }) @IsInt() @Min(1) @Max(100_000_000) public amountMinor: number;
  @ApiPropertyOptional({ example: 'Populaire' }) @IsOptional() @IsString() @MaxLength(30) public badge?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) public position?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() public active?: boolean;
}

export class UpdatePackDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1_000_000) public coins?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) public bonusCoins?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100_000_000) public amountMinor?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @MaxLength(30) public badge?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1000) public position?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() public active?: boolean;
}

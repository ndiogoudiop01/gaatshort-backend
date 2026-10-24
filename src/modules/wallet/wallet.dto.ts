import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength, NotEquals } from 'class-validator';

export class LedgerQueryDto {
  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(100)
  public limit = 20;

  @ApiPropertyOptional({ description: 'Curseur : `nextBefore` de la page précédente' })
  @IsOptional() @IsDateString()
  public before?: string;
}

export class AdjustWalletDto {
  @ApiProperty({ description: 'Crédits bonus ajoutés (positif) ou retirés (négatif)', example: 30 })
  @IsInt() @Min(-100000) @Max(100000) @NotEquals(0)
  public delta: number;

  @ApiProperty({ description: 'Motif (obligatoire, audité)' })
  @IsString() @MinLength(5) @MaxLength(500)
  public reason: string;
}

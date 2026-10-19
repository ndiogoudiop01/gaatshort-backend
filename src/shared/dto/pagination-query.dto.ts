import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class OffsetPaginationQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional() @IsInt() @Min(1)
  @Transform(({ value }) => Number(value))
  public page = 1;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  @Transform(({ value }) => Number(value))
  public perPage = 20;

  @ApiPropertyOptional({ description: 'Champ de tri' })
  @IsOptional() @IsString()
  public sortBy?: string;

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional() @IsIn(['asc', 'desc'])
  public sortDir: 'asc' | 'desc' = 'desc';

  public get skip(): number {
    return (this.page - 1) * this.perPage;
  }
}

export class CursorPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Curseur opaque renvoyé par la page précédente' })
  @IsOptional() @IsString()
  public cursor?: string;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional() @IsInt() @Min(1) @Max(100)
  @Transform(({ value }) => Number(value))
  public limit = 20;
}

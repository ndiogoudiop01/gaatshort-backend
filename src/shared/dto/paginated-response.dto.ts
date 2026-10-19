import { ApiProperty } from '@nestjs/swagger';

export class PaginationMetaDto {
  @ApiProperty({ required: false }) public total?: number;
  @ApiProperty({ required: false }) public page?: number;
  @ApiProperty({ required: false }) public perPage?: number;
  @ApiProperty({ required: false }) public totalPages?: number;
  @ApiProperty({ required: false, nullable: true }) public nextCursor?: string | null;
  @ApiProperty() public hasMore: boolean;
}

export class PaginatedResponseDto<T> {
  @ApiProperty({ isArray: true }) public data: T[];
  @ApiProperty({ type: PaginationMetaDto }) public meta: PaginationMetaDto;
}

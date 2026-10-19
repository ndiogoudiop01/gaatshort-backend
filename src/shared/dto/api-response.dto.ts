import { ApiProperty } from '@nestjs/swagger';

/**
 * Enveloppe unique de toutes les réponses. Le frontend écrit UN seul
 * intercepteur au lieu d'un cas particulier par endpoint.
 */
export class ApiErrorDto {
  @ApiProperty({ example: 'INVALID_STATE_TRANSITION' }) public code: string;
  @ApiProperty() public message: string;
  @ApiProperty({ required: false, type: Object }) public details?: Record<string, unknown>;
}

export class ApiEnvelopeDto<T> {
  @ApiProperty() public success: boolean;
  @ApiProperty({ required: false }) public data?: T;
  @ApiProperty({ required: false, type: ApiErrorDto }) public error?: ApiErrorDto;
  @ApiProperty({ example: '01JBQ8X4Z2K9' }) public requestId: string;
  @ApiProperty() public timestamp: string;
}

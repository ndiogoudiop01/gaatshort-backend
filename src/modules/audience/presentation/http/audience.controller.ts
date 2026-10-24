import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { RequirePermissions } from '@shared/decorators/permissions.decorator';
import { OffsetPaginationQueryDto } from '@shared/dto/pagination-query.dto';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { AdjustWalletDto } from '@modules/wallet/wallet.dto';
import { AudienceService } from '../../application/audience.service';

class ViewersQueryDto extends OffsetPaginationQueryDto {
  @ApiPropertyOptional({ description: 'Téléphone ou nom' }) @IsOptional() @IsString() @MaxLength(40) public q?: string;
}

@ApiTags('Back-office — Spectateurs et pilotage')
@ApiBearerAuth('access-token')
@Controller({ path: 'admin', version: '1' })
export class AudienceController {
  constructor(private readonly audience: AudienceService) {}

  @Get('dashboard') @RequirePermissions('metrics:read')
  @ApiOperation({ summary: 'Tableau de bord de la marque (7 et 30 jours)' })
  public dashboard() { return this.audience.dashboard(); }

  @Get('viewers') @RequirePermissions('viewer:read')
  @ApiOperation({ summary: 'Spectateurs de la marque' })
  public list(@Query() q: ViewersQueryDto) { return this.audience.listViewers({ q: q.q, page: q.page, perPage: q.perPage }); }

  @Get('viewers/:accountId') @RequirePermissions('viewer:read')
  @ApiOperation({ summary: 'Spectateur : solde, mouvements, commandes' })
  public detail(@Param('accountId', ParseUUIDPipe) id: string) { return this.audience.viewer(id); }

  @Post('viewers/:accountId/wallet/adjust') @HttpCode(200) @RequirePermissions('wallet:adjust')
  @ApiOperation({ summary: 'Ajuster les crédits bonus (motif obligatoire, audité)', description: '422 ADJUSTMENT_EXCEEDS_BONUS' })
  public adjust(@Param('accountId', ParseUUIDPipe) id: string, @Body() dto: AdjustWalletDto, @CurrentUser() user: AuthenticatedUser) {
    return this.audience.adjust(id, dto.delta, dto.reason, user.id);
  }
}

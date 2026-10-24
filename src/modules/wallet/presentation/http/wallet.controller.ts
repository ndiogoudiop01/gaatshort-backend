import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { CurrentUser } from '@shared/decorators/current-user.decorator';
import { requireAccountId } from '@shared/kernel/access/viewer';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { ViewerContextService } from '@infra/viewer/viewer-context.service';
import { WalletService } from '../../application/wallet.service';
import { LedgerQueryDto } from '../../wallet.dto';

@ApiTags('App — Portefeuille')
@ApiBearerAuth('access-token')
@Controller({ version: '1' })
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly viewer: ViewerContextService,
  ) {}

  @Get('wallet')
  @ApiOperation({ summary: 'Solde de crédits (commun à toutes les marques)' })
  public balance(@CurrentUser() user: AuthenticatedUser) {
    return this.wallet.balance(requireAccountId(user));
  }

  @Get('wallet/ledger')
  @ApiOperation({ summary: 'Historique des mouvements de crédits' })
  public ledger(@CurrentUser() user: AuthenticatedUser, @Query() q: LedgerQueryDto) {
    return this.wallet.ledger(requireAccountId(user), q.limit, q.before);
  }

  @Post('episodes/:id/unlock')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Débloquer un épisode payant avec des crédits',
    description: 'Idempotent : un épisode déjà débloqué ne débite rien. 409 INSUFFICIENT_BALANCE si le solde manque.',
  })
  public async unlock(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    const accountId = requireAccountId(user);
    const ctx = await this.viewer.resolve(req, user);
    return this.wallet.unlock({ accountId, episodeId: id, country: ctx.country, locale: ctx.locale });
  }
}

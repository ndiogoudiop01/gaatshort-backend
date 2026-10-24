import { Module } from '@nestjs/common';
import { WalletModule } from '@modules/wallet/wallet.module';
import { AudienceService } from './application/audience.service';
import { AudienceController } from './presentation/http/audience.controller';

/** Spectateurs de la marque et tableau de bord du back-office. */
@Module({
  imports: [WalletModule],
  controllers: [AudienceController],
  providers: [AudienceService],
})
export class AudienceModule {}

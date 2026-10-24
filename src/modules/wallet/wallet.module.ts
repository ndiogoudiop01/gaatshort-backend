import { Module } from '@nestjs/common';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { WALLET_FACADE } from './wallet.facade';
import { WalletService } from './application/wallet.service';
import { WalletController } from './presentation/http/wallet.controller';

/** Portefeuille commun (Q-02), grand livre immuable, droits de visionnage. */
@Module({
  imports: [CatalogModule],
  controllers: [WalletController],
  providers: [WalletService, { provide: WALLET_FACADE, useExisting: WalletService }],
  exports: [WALLET_FACADE],
})
export class WalletModule {}

import { Module } from '@nestjs/common';
import { CatalogModule } from '@modules/catalog/catalog.module';
import { WalletModule } from '@modules/wallet/wallet.module';
import { LibraryService } from './application/library.service';
import { StorefrontController } from './presentation/http/storefront.controller';

/** Vitrine publique, lecture, progression, favoris. */
@Module({
  imports: [CatalogModule, WalletModule],
  controllers: [StorefrontController],
  providers: [LibraryService],
})
export class LibraryModule {}

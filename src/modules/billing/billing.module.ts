import { Module } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import { WalletModule } from '@modules/wallet/wallet.module';
import { PAYMENT_PROVIDER } from './domain/ports/payment-provider.port';
import { OrdersService } from './application/orders.service';
import { PacksService } from './application/packs.service';
import { PaymentNotificationService } from './application/payment-notification.service';
import { FakePaymentProvider } from './infrastructure/payment/fake-payment.provider';
import { PaytechProvider } from './infrastructure/payment/paytech.provider';
import { BillingController } from './presentation/http/billing.controller';

/** Packs de crédits, commandes, paiement PayTech (et simulé hors production). */
@Module({
  imports: [WalletModule],
  controllers: [BillingController],
  providers: [
    PacksService,
    OrdersService,
    PaymentNotificationService,
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        config.payment.driver === 'paytech' ? new PaytechProvider(config) : new FakePaymentProvider(config),
    },
  ],
})
export class BillingModule {}

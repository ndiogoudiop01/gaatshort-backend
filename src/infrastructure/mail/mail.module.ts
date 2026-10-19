import { Global, Logger, Module } from '@nestjs/common';
import { MAILER } from '@shared/kernel/ports/mailer.port';
import { SMS_SENDER } from '@shared/kernel/ports/sms.port';
import { AppConfigService } from '@config/app-config.service';
import { LogSmsAdapter } from '@infra/sms/adapters/log-sms.adapter';
import { LogMailerAdapter } from './adapters/log-mailer.adapter';
import { SmtpMailerAdapter } from './adapters/smtp-mailer.adapter';
import { TemplateRenderer } from './template-renderer.service';

/**
 * Le fournisseur est choisi par `MAIL_DRIVER` / `SMS_DRIVER` (config), jamais
 * dans le code métier. Ajouter SES / Resend / Twilio / Orange = une classe
 * `MailerPort` / `SmsPort` de plus, câblée dans le `switch` ci-dessous.
 */
@Global()
@Module({
  providers: [
    TemplateRenderer,
    SmtpMailerAdapter,
    LogMailerAdapter,
    LogSmsAdapter,
    {
      provide: MAILER,
      inject: [AppConfigService, SmtpMailerAdapter, LogMailerAdapter],
      useFactory: (config: AppConfigService, smtp: SmtpMailerAdapter, log: LogMailerAdapter) => {
        switch (config.mail.driver) {
          case 'log':
            return log;
          case 'smtp':
            return smtp;
          default:
            new Logger('MailModule').warn(
              `MAIL_DRIVER="${config.mail.driver}" non implémenté — repli SMTP`,
            );
            return smtp;
        }
      },
    },
    {
      provide: SMS_SENDER,
      inject: [AppConfigService, LogSmsAdapter],
      useFactory: (config: AppConfigService, log: LogSmsAdapter) => {
        // 'twilio' / 'orange' : une classe SmsPort par fournisseur, puis un case ici.
        if (config.sms.driver !== 'log') {
          new Logger('MailModule').warn(`SMS_DRIVER="${config.sms.driver}" non implémenté — repli log`);
        }
        return log;
      },
    },
  ],
  exports: [MAILER, SMS_SENDER, TemplateRenderer],
})
export class MailModule {}

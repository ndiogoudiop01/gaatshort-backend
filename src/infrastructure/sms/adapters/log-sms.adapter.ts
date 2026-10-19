import { Injectable, Logger } from '@nestjs/common';
import type { SmsPort } from '@shared/kernel/ports/sms.port';

/**
 * Adaptateur de développement. En production : Twilio, Orange SMS API
 * (Sénégal/CI) ou Africa's Talking — une classe par fournisseur, sélectionnée
 * par `SMS_DRIVER` dans le provider du module.
 */
@Injectable()
export class LogSmsAdapter implements SmsPort {
  private readonly logger = new Logger(LogSmsAdapter.name);

  public send(params: { to: string; body: string }): Promise<{ providerId: string }> {
    this.logger.log(`[SMS] → ${params.to} : ${params.body}`);
    return Promise.resolve({ providerId: `log-${Date.now()}` });
  }
}

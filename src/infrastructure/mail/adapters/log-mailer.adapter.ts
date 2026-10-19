import { Injectable, Logger } from '@nestjs/common';
import type { MailMessage, MailerPort } from '@shared/kernel/ports/mailer.port';
import { TemplateRenderer } from '../template-renderer.service';

/**
 * Adaptateur e-mail de développement / CI (`MAIL_DRIVER=log`) : rend le gabarit
 * et l'écrit dans les logs au lieu de l'envoyer. Aucun serveur SMTP requis.
 * Pendant du `LogSmsAdapter`.
 */
@Injectable()
export class LogMailerAdapter implements MailerPort {
  private readonly logger = new Logger(LogMailerAdapter.name);

  constructor(private readonly renderer: TemplateRenderer) {}

  public async send(message: MailMessage): Promise<{ providerId: string }> {
    const { subject } = await this.renderer.render(
      message.template,
      'EMAIL',
      message.locale ?? 'fr',
      message.variables,
    );
    this.logger.log(`[MAIL] → ${String(message.to)} | ${message.subject || subject}`);
    return { providerId: `log-${Date.now()}` };
  }
}

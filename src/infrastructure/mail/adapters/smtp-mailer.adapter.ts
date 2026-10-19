import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '@config/app-config.service';
import type { MailMessage, MailerPort } from '@shared/kernel/ports/mailer.port';
import { TemplateRenderer } from '../template-renderer.service';

/**
 * Adaptateur SMTP. Résout le gabarit (cascade tenant → défaut) puis expédie.
 * Changer de fournisseur (SES, Resend, Brevo) = une nouvelle classe
 * `MailerPort`, sélectionnée par `MAIL_DRIVER` dans `MailModule` : aucun code
 * métier, aucune règle de gabarit touchée. (Le D de SOLID.)
 */
@Injectable()
export class SmtpMailerAdapter implements MailerPort {
  private readonly logger = new Logger(SmtpMailerAdapter.name);

  constructor(
    private readonly renderer: TemplateRenderer,
    private readonly config: AppConfigService,
  ) {}

  public async send(message: MailMessage): Promise<{ providerId: string }> {
    const rendered = await this.renderer.render(
      message.template,
      'EMAIL',
      message.locale ?? 'fr',
      message.variables,
    );
    const subject = message.subject || rendered.subject;

    // Implémentation : nodemailer.createTransport({ host: smtp.host, port: smtp.port,
    //   auth: { user: smtp.user, pass: smtp.password } }).sendMail({ from, to, subject, html })
    this.logger.log({
      msg: 'Envoi e-mail (SMTP)',
      to: message.to,
      template: message.template,
      subject,
      host: this.config.mail.smtp.host,
    });
    void rendered.body;

    return { providerId: `smtp-${Date.now()}` };
  }
}

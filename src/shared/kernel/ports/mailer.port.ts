export const MAILER = Symbol('MAILER');

/**
 * Demande d'e-mail par **clé de gabarit** : le transport résout la cascade
 * tenant → défaut (TemplateRenderer) et interpole. Changer de fournisseur
 * (SES, Resend, Brevo…) = une nouvelle classe `MailerPort`, sélectionnée par
 * `MAIL_DRIVER` dans `MailModule` — aucun code métier touché.
 */
export interface MailMessage {
  readonly to: string | string[];
  /** Optionnel : surcharge le sujet résolu par le gabarit. */
  readonly subject?: string;
  readonly template: string;
  readonly variables: Record<string, unknown>;
  readonly locale?: string;
  readonly replyTo?: string;
  readonly attachments?: { readonly filename: string; readonly url: string }[];
}

export interface MailerPort {
  send(message: MailMessage): Promise<{ providerId: string }>;
}

import { Injectable } from '@nestjs/common';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

export type TemplateChannel = 'EMAIL' | 'SMS';

export interface RenderedTemplate {
  readonly subject: string; // vide pour un SMS
  readonly body: string; // HTML pour un e-mail, texte brut pour un SMS
}

/**
 * Résolution des gabarits **en cascade**, identique pour l'e-mail et le SMS :
 *   1. gabarit personnalisé du tenant (branding, ton, mentions légales) ;
 *   2. gabarit par défaut de la plateforme.
 *
 * IMPORTANT : la lecture de `notification_templates` passe par
 * `TenantPrismaService` — table `tenant_id` sous RLS forcée. Avec le client
 * brut, `app.current_tenant_id` n'est pas posé → la requête renverrait 0 ligne
 * → la surcharge tenant serait silencieusement ignorée.
 */
@Injectable()
export class TemplateRenderer {
  constructor(private readonly prisma: TenantPrismaService) {}

  public async render(
    templateKey: string,
    channel: TemplateChannel,
    locale: string,
    variables: Record<string, unknown>,
  ): Promise<RenderedTemplate> {
    // `tenantId` + `set_config` injectés par l'extension tenant-scopée.
    const custom = await this.prisma.client.notificationTemplate.findFirst({
      where: { key: templateKey, channel, locale, isActive: true },
    });

    const fallback = channel === 'SMS' ? DEFAULT_SMS[templateKey] : DEFAULT_EMAIL[templateKey];
    const subject = custom?.subject ?? fallback?.subject ?? (channel === 'SMS' ? '' : 'Gaatshort');
    const body = custom?.body ?? fallback?.body ?? '';

    return {
      subject: this.interpolate(subject, variables),
      body: this.interpolate(body, variables),
    };
  }

  private interpolate(template: string, variables: Record<string, unknown>): string {
    return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
      const value = path
        .split('.')
        .reduce<unknown>((acc, key) => (acc as Record<string, unknown>)?.[key], variables);
      return this.stringify(value);
    });
  }

  private stringify(value: unknown): string {
    if (value === undefined || value === null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
    return JSON.stringify(value) ?? '';
  }
}

type DefaultTemplate = { subject?: string; body: string };

/** Gabarits e-mail de repli — la source de vérité reste la base par tenant. */
const DEFAULT_EMAIL: Record<string, DefaultTemplate> = {
  'auth.magic-link': {
    subject: 'Votre lien de connexion',
    body: '<p>Bonjour {{firstName}}, connectez-vous : <a href="{{link}}">accéder à mon compte</a>. Ce lien expire dans {{ttlMinutes}} minutes.</p>',
  },
  'auth.otp': {
    subject: 'Votre code de vérification',
    body: '<p>Votre code : <strong>{{code}}</strong> (valable {{ttlMinutes}} minutes).</p>',
  },
  'billing.order.paid': {
    subject: 'Paiement confirmé — {{coins}} crédits ajoutés',
    body: '<p>Votre paiement de {{amount}} (commande {{reference}}) est confirmé. {{coins}} crédits ont été ajoutés à votre solde.</p>',
  },
  'billing.order.failed': {
    subject: 'Paiement non abouti — commande {{reference}}',
    body: '<p>Le paiement de la commande {{reference}} n’a pas abouti. Aucun montant n’a été débité et votre solde n’a pas changé.</p>',
  },
};

/** Gabarits SMS de repli — texte brut, courts. Le SMS n'est PAS un repli du mail. */
const DEFAULT_SMS: Record<string, DefaultTemplate> = {
  'auth.magic-link': { body: 'Votre lien de connexion : {{link}} (expire dans {{ttlMinutes}} min).' },
  'auth.otp': { body: 'Code de vérification : {{code}} (valable {{ttlMinutes}} min). Ne le partagez pas.' },
};

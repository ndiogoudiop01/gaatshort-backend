import type { PrismaClient } from '@prisma/client';
import { tenantIdFor } from './fixed-ids';

/**
 * Marque maison de la plateforme (D-13) : tenant de démarrage, idempotent.
 * Les marques tierces sont créées depuis le back-office, jamais par le seed.
 */
export async function seedTenant(prisma: PrismaClient) {
  const tenant = await prisma.tenant.upsert({
    where: { slug: 'gaatshort' },
    create: {
      // ID stable : survit à un `migrate reset` / changement de branche.
      id: tenantIdFor('gaatshort'),
      slug: 'gaatshort',
      name: 'Gaatshort',
      defaultLocale: 'fr',
      defaultCountry: 'SN',
      defaultCurrency: 'XOF',
      timezone: 'Africa/Dakar',
      isFirstParty: true,
      branding: { accent: '#E0325E', logoUrl: null },
      featureFlags: {},
    },
    update: { isFirstParty: true },
  });

  const tenantId = tenant.id;

  // PRD §3 : Sénégal (pays par défaut) et Gambie.
  for (const code of ['SN', 'GM']) {
    await prisma.tenantCountry.upsert({
      where: { tenantId_countryCode: { tenantId, countryCode: code } },
      create: { tenantId, countryCode: code, isDefault: code === 'SN' },
      update: {},
    });
  }

  // Consentements de la marque (FR-AUTH-004) — textes à valider par le juriste (T0.8).
  const consents = [
    {
      key: 'personal_data_processing',
      label: "J'accepte le traitement de mes données personnelles par Gaatshort pour gérer mon compte, mes achats et ma lecture",
      purpose: 'Fourniture du service : compte, achats de crédits, droits de visionnage, reprise de lecture',
      isRequired: true,
    },
    {
      key: 'marketing_communications',
      label: 'Je souhaite être informé des nouvelles séries et des offres de Gaatshort',
      purpose: 'Communication marketing',
      isRequired: false,
    },
  ];
  for (const consent of consents) {
    await prisma.consentDefinition.upsert({
      where: { tenantId_key_version_locale: { tenantId, key: consent.key, version: 1, locale: 'fr' } },
      create: { tenantId, version: 1, locale: 'fr', ...consent },
      update: {},
    });
  }

  return tenant;
}

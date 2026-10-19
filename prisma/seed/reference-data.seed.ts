import type { PrismaClient } from '@prisma/client';

/**
 * Référentiels globaux de lancement : Sénégal et Gambie (PRD §3).
 * Ajouter un pays = une ligne ici + son ouverture par tenant (tenant_countries).
 */
export const COUNTRIES = [
  { code: 'SN', name: 'Senegal', nameFr: 'Sénégal', dialCode: '+221', currencyCode: 'XOF', flagEmoji: '🇸🇳' },
  { code: 'GM', name: 'The Gambia', nameFr: 'Gambie', dialCode: '+220', currencyCode: 'GMD', flagEmoji: '🇬🇲' },
];

/**
 * `rateToXOF` est une colonne héritée du socle, conservée uniquement pour que le
 * schéma reste compilable. Elle est SUPPRIMÉE en tâche T1.2 (NFR-MONEY-001 :
 * aucune conversion monétaire implicite) ; ne jamais l'utiliser dans un calcul.
 */
export const CURRENCIES = [
  { code: 'XOF', symbol: 'FCFA', name: 'Franc CFA (UEMOA)', decimals: 0, rateToXOF: 1 },
  { code: 'GMD', symbol: 'D', name: 'Dalasi gambien', decimals: 2, rateToXOF: 1 },
  // Reporting des achats intégrés des stores (phase 2, TRD §16.3).
  { code: 'USD', symbol: '$', name: 'Dollar américain', decimals: 2, rateToXOF: 1 },
];

export async function seedReferenceData(prisma: PrismaClient): Promise<void> {
  for (const currency of CURRENCIES) {
    await prisma.currency.upsert({ where: { code: currency.code }, create: currency, update: currency });
  }
  for (const country of COUNTRIES) {
    await prisma.country.upsert({ where: { code: country.code }, create: country, update: country });
  }
}

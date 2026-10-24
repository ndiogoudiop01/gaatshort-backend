import type { PrismaClient } from '@prisma/client';
import { deterministicUuid as uuidV5 } from './fixed-ids';

/**
 * Données de la marque et catalogue de DÉMONSTRATION.
 *
 *  • Genres et packs : paramétrage de départ (prix indicatifs du PRD §10 :
 *    500 XOF → 50 crédits, 1 000 → 105, 2 000 → 220, 5 000 → 600), modifiables
 *    au back-office. Créés si absents, jamais écrasés.
 *  • Séries de démonstration : FICTIVES, vidéo factice (pilote `fake`), licence
 *    fictive SN/GM. Seulement hors production et si SEED_DEMO_CATALOG ≠ false.
 */
const GENRES = [
  ['romance', 'Romance', 'Romance'],
  ['drame', 'Drame', 'Drama'],
  ['vengeance', 'Vengeance', 'Revenge'],
  ['famille', 'Famille', 'Family'],
  ['comedie', 'Comédie', 'Comedy'],
  ['mystere', 'Mystère', 'Mystery'],
] as const;

const PACKS = [
  { code: 'pack-50', coins: 50, bonusCoins: 0, amountMinor: 500, position: 1, badge: null },
  { code: 'pack-105', coins: 100, bonusCoins: 5, amountMinor: 1000, position: 2, badge: null },
  { code: 'pack-220', coins: 200, bonusCoins: 20, amountMinor: 2000, position: 3, badge: 'Populaire' },
  { code: 'pack-600', coins: 500, bonusCoins: 100, amountMinor: 5000, position: 4, badge: 'Meilleure offre' },
];

const DEMO_SERIES = [
  {
    slug: 'le-pacte-de-ngor', titleFr: 'Le Pacte de Ngor', titleEn: 'The Ngor Pact', genres: ['drame', 'vengeance'], episodes: 12,
    synopsisFr: "Trahie le jour de son mariage, Awa revient à Dakar sous un autre nom pour reprendre ce qu'on lui a volé.",
    synopsisEn: 'Betrayed on her wedding day, Awa returns to Dakar under another name to take back what was stolen from her.',
  },
  {
    slug: 'mariage-sous-contrat', titleFr: 'Mariage sous contrat', titleEn: 'Contract Marriage', genres: ['romance', 'comedie'], episodes: 10,
    synopsisFr: "Pour sauver l'entreprise familiale, Khady accepte un mariage d'un an avec un héritier qu'elle déteste.",
    synopsisEn: 'To save the family business, Khady agrees to a one-year marriage with an heir she cannot stand.',
  },
  {
    slug: 'la-maison-des-secrets', titleFr: 'La Maison des secrets', titleEn: 'House of Secrets', genres: ['mystere', 'famille'], episodes: 8,
    synopsisFr: "À la mort du patriarche, un testament inattendu réunit trois frères et sœurs que tout oppose.",
    synopsisEn: "When the patriarch dies, an unexpected will brings together three siblings who couldn't be more different.",
  },
];

export async function seedCatalog(prisma: PrismaClient, tenantId: string): Promise<void> {
  for (const [i, [slug, nameFr, nameEn]] of GENRES.entries()) {
    await prisma.genre.upsert({
      where: { slug },
      create: { id: uuidV5(`genre:${slug}`), slug, nameFr, nameEn, position: i },
      update: {},
    });
  }

  for (const pack of PACKS) {
    await prisma.coinPack.upsert({
      where: { tenantId_code: { tenantId, code: pack.code } },
      create: { id: uuidV5(`pack:${tenantId}:${pack.code}`), tenantId, currencyCode: 'XOF', ...pack },
      update: {},
    });
  }

  const demo = process.env.NODE_ENV !== 'production' && process.env.SEED_DEMO_CATALOG !== 'false';
  if (!demo) return;

  const licenseId = uuidV5('license:demo');
  await prisma.license.upsert({
    where: { id: licenseId },
    create: {
      id: licenseId,
      licensorName: 'Ayant droit de démonstration',
      contractRef: 'DEMO-0001',
      startsAt: new Date('2026-01-01T00:00:00Z'),
      endsAt: new Date('2030-12-31T00:00:00Z'),
      territories: ['SN', 'GM'],
      sublicensingAllowed: true,
      notes: 'Licence FICTIVE pour le développement. Ne jamais utiliser en production.',
    },
    update: {},
  });

  for (const [position, s] of DEMO_SERIES.entries()) {
    const seriesId = uuidV5(`series:${s.slug}`);
    await prisma.series.upsert({
      where: { slug: s.slug },
      create: {
        id: seriesId,
        slug: s.slug,
        titleFr: s.titleFr,
        titleEn: s.titleEn,
        synopsisFr: s.synopsisFr,
        synopsisEn: s.synopsisEn,
        status: 'PUBLISHED',
        publishedAt: new Date(Date.UTC(2026, 9, 1 + position)),
        tags: s.genres,
        genres: { create: s.genres.map((g) => ({ genreId: uuidV5(`genre:${g}`) })) },
        licenses: { create: [{ licenseId }] },
      },
      update: {},
    });
    for (let n = 1; n <= s.episodes; n++) {
      const assetId = uuidV5(`media:${s.slug}:${n}`);
      await prisma.mediaAsset.upsert({
        where: { id: assetId },
        create: { id: assetId, kind: 'VIDEO', provider: 'FAKE', providerRef: `fake-${s.slug}-${n}`, status: 'READY', durationSeconds: 90 + n * 7, width: 1080, height: 1920 },
        update: {},
      });
      await prisma.episode.upsert({
        where: { seriesId_number: { seriesId, number: n } },
        create: {
          id: uuidV5(`episode:${s.slug}:${n}`),
          seriesId,
          number: n,
          status: 'PUBLISHED',
          videoAssetId: assetId,
          durationSeconds: 90 + n * 7,
          publishedAt: new Date(),
        },
        update: {},
      });
    }
    await prisma.tenantSeries.upsert({
      where: { tenantId_seriesId: { tenantId, seriesId } },
      create: { tenantId, seriesId, status: 'LIVE', featured: position === 0, position },
      update: {},
    });
  }
}

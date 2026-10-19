import { createHash } from 'node:crypto';

/**
 * IDENTIFIANTS STABLES DU SEED
 *
 * Problème résolu : `@default(uuid())` tire un UUID neuf à chaque insertion.
 * Après un `prisma migrate reset` (changement de branche, migration
 * divergente, base recréée), le tenant et le compte administrateur
 * reviennent avec des IDs DIFFÉRENTS. Tout ce qui les référence en dur
 * casse : un JWT encore en cache dans le navigateur, un `tenantId` noté
 * dans Postman, un `.env` du front, une fixture de test, un lien du
 * back-office.
 *
 * Solution : les entités amorcées par le seed reçoivent un UUID **dérivé de
 * leur clé métier** (UUID v5, RFC 4122). Même slug ⇒ même UUID, sur
 * n'importe quelle machine, n'importe quelle branche, en dev comme en prod.
 * Aucune dépendance ajoutée : SHA-1 vient de `node:crypto`.
 *
 * Deux conséquences à connaître :
 *   - Le namespace ci-dessous fait partie du contrat. Le modifier change TOUS
 *     les IDs dérivés : ne jamais y toucher sur une base déjà déployée.
 *   - Ces IDs ne concernent que les données du seed. Les candidatures,
 *     partenaires et autres données créées par l'application gardent
 *     `@default(uuid())`.
 */

/** Namespace privé Gaatshort — figé. Ne jamais modifier une fois une base déployée. */
const GAATSHORT_NAMESPACE = 'ad73e58f-62fc-489b-8b40-922b263b8bee';

/** UUID v5 (SHA-1) : déterministe, conforme RFC 4122. */
export function deterministicUuid(name: string, namespace: string = GAATSHORT_NAMESPACE): string {
  const bytes = createHash('sha1')
    .update(Buffer.from(namespace.replace(/-/g, ''), 'hex'))
    .update(Buffer.from(name, 'utf8'))
    .digest();

  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant RFC 4122

  const hex = bytes.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** ID stable d'un tenant, dérivé de son slug. */
export const tenantIdFor = (slug: string): string => deterministicUuid(`tenant:${slug}`);

/** ID stable d'un utilisateur amorcé, dérivé de (tenant, e-mail). */
export const seedUserIdFor = (tenantSlug: string, email: string): string =>
  deterministicUuid(`user:${tenantSlug}:${email.toLowerCase().trim()}`);

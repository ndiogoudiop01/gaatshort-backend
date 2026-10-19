import type { AuthenticatedUser } from '../types/authenticated-user';
import { canSeeCountry, countryScopeOf } from './country-scope';

/** Le strict nécessaire pour trancher le périmètre. */
export interface ApplicationScope {
  readonly userId: string;
  readonly assignedToId: string | null;
  /**
   * BSG-12 — pays du dossier. OBLIGATOIRE dans le type : un appelant qui
   * oublierait de le charger ne compile pas, au lieu d'ouvrir en silence un
   * dossier hors périmètre pays.
   */
  readonly countryCode: string | null;
}

/**
 * Périmètre de lecture d'un dossier de candidature — la RÈGLE, sans la
 * sanction.
 *
 * Elle vit dans le kernel parce que DEUX contextes bornés doivent la faire
 * respecter à l'identique : les candidatures (fiche 360, bloc-notes) et les
 * pièces justificatives (URL de consultation signée). Un module n'a pas le
 * droit de lire les entrailles d'un autre (`no-cross-module-internals`,
 * `boundaries/element-types`) : le kernel est le seul endroit où cette
 * règle peut n'être écrite qu'une fois. La faire diverger, c'est rouvrir
 * par les pièces ce que la fiche 360 vient de fermer.
 *
 * La SANCTION, elle, reste à l'appelant — `ApplicationAccessPolicy` lève
 * « Candidature introuvable », la query des pièces lève « Pièce
 * justificative introuvable » : dans les deux cas un 404 identique à celui
 * de l'id inconnu, jamais un 403 qui confirmerait l'existence.
 */
export function canReadApplication(user: AuthenticatedUser, application: ApplicationScope): boolean {
  // Le candidat lit toujours son propre dossier.
  if (application.userId === user.id) return true;
  // BSG-12 : le périmètre PAYS passe AVANT les permissions. Même un
  // `application:read:any` ne lit pas un dossier d'un pays hors périmètre.
  if (!canSeeCountry(countryScopeOf(user), application.countryCode)) return false;
  if (user.permissions.includes('application:read:any')) return true;
  return user.permissions.includes('application:read:assigned') && application.assignedToId === user.id;
}

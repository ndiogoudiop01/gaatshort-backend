import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Route accessible sans authentification (vitrine, simulateur, candidature). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const IS_OPTIONAL_AUTH_KEY = 'auth:isOptional';

/**
 * Route publique qui PERSONNALISE sa réponse si un jeton valide est présent
 * (catalogue : épisodes déjà débloqués, favoris). Jeton absent → anonyme ;
 * jeton présent mais invalide ou révoqué → 401, pour que le client le rafraîchisse
 * au lieu de croire, à tort, que ses achats ont disparu.
 */
export const OptionalAuth = () => SetMetadata(IS_OPTIONAL_AUTH_KEY, true);

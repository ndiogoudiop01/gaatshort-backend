import { SetMetadata } from '@nestjs/common';

export const IDEMPOTENT_KEY = 'http:idempotent';

/**
 * Exige un en-tête `Idempotency-Key` et rejoue la réponse d'origine si la
 * même clé revient. À poser sur toute création déclenchée par un formulaire
 * public : sur mobile en 3G, le double-tap et le retry réseau sont la norme.
 */
export const Idempotent = (ttlSeconds = 86_400) => SetMetadata(IDEMPOTENT_KEY, { ttlSeconds });

import { SetMetadata } from '@nestjs/common';

export const REQUEST_TIMEOUT_KEY = 'requestTimeoutMs';

/**
 * Délai propre à une route, au-delà des 15 s globales — réservé aux opérations du
 * back-office longues PAR NATURE (import en lot). Ne jamais l'utiliser sur une route publique.
 */
export const RequestTimeout = (ms: number) => SetMetadata(REQUEST_TIMEOUT_KEY, ms);

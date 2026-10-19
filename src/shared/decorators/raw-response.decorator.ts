import { SetMetadata } from '@nestjs/common';
import { RAW_RESPONSE_KEY } from '@shared/interceptors/response-envelope.interceptor';

/**
 * Désactive l'enveloppe `{ success, data, requestId, timestamp }` sur ce
 * handler. À réserver aux réponses qui NE sont pas du JSON métier : flux de
 * fichier, redirection, corps imposé par une spec externe (webhook, OAuth).
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE_KEY, true);

import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'auth:isPublic';

/** Route accessible sans authentification (vitrine, simulateur, candidature). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

import { ForbiddenActionError } from '@shared/kernel/errors/domain.error';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';

/** Les routes « spectateur » exigent un compte global (connexion par téléphone). */
export function requireAccountId(user: AuthenticatedUser): string {
  if (!user.accountId) {
    throw new ForbiddenActionError('watch', 'account', 'compte spectateur requis (connexion par téléphone)');
  }
  return user.accountId;
}

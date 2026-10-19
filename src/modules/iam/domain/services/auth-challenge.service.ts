import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';

export interface ChallengeState {
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * Règles de validité d'un défi d'authentification (lien magique, OTP).
 * Isolées ici pour être testables sans base ni horloge système.
 */
export class AuthChallengeRules {
  public static assertUsable(state: ChallengeState, now: Date): void {
    if (state.consumedAt) {
      throw new BusinessRuleViolationError('CHALLENGE_ALREADY_USED', 'Ce code a déjà été utilisé');
    }
    if (state.expiresAt <= now) {
      throw new BusinessRuleViolationError('CHALLENGE_EXPIRED', 'Ce code a expiré, demandez-en un nouveau');
    }
    // Verrouillage après N tentatives : sans cela, un OTP à 6 chiffres se
    // force en 10^6 essais, ce qu'un script fait en quelques minutes.
    if (state.attempts >= state.maxAttempts) {
      throw new BusinessRuleViolationError(
        'CHALLENGE_LOCKED',
        'Trop de tentatives, demandez un nouveau code',
      );
    }
  }
}

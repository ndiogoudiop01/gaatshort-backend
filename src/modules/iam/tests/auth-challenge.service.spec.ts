import { BusinessRuleViolationError } from '@shared/kernel/errors/domain.error';
import { AuthChallengeRules } from '../domain/services/auth-challenge.service';

const NOW = new Date('2026-09-01T00:00:00.000Z');

describe('AuthChallengeRules', () => {
  it('accepte un défi valide, non consommé, dans les tentatives', () => {
    expect(() =>
      AuthChallengeRules.assertUsable(
        { attempts: 0, maxAttempts: 5, expiresAt: new Date('2026-09-01T00:10:00.000Z'), consumedAt: null },
        NOW,
      ),
    ).not.toThrow();
  });

  it('refuse un défi déjà consommé', () => {
    expect(() =>
      AuthChallengeRules.assertUsable(
        { attempts: 0, maxAttempts: 5, expiresAt: new Date('2026-09-01T00:10:00.000Z'), consumedAt: NOW },
        NOW,
      ),
    ).toThrow(BusinessRuleViolationError);
  });

  it('refuse un défi expiré', () => {
    expect(() =>
      AuthChallengeRules.assertUsable(
        { attempts: 0, maxAttempts: 5, expiresAt: new Date('2020-01-01'), consumedAt: null },
        NOW,
      ),
    ).toThrow(/expiré/);
  });

  it('verrouille après trop de tentatives', () => {
    expect(() =>
      AuthChallengeRules.assertUsable(
        { attempts: 5, maxAttempts: 5, expiresAt: new Date('2026-09-01T00:10:00.000Z'), consumedAt: null },
        NOW,
      ),
    ).toThrow(/tentatives/);
  });
});

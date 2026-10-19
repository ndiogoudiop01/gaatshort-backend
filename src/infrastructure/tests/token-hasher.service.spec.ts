import type { AppConfigService } from '@config/app-config.service';
import { TokenHasher } from '../security/token-hasher.service';

function buildHasher(overrides: { accessSecret?: string; refreshSecret?: string } = {}): TokenHasher {
  return new TokenHasher({
    auth: {
      accessSecret: overrides.accessSecret ?? 'test-access-secret',
      refreshSecret: overrides.refreshSecret ?? 'test-refresh-secret',
    },
  } as unknown as AppConfigService);
}

describe('TokenHasher', () => {
  it('génère des jetons opaques de la longueur demandée (encodée en base64url)', () => {
    const hasher = buildHasher();
    const token = hasher.generate(24);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('génère un code numérique de la longueur exacte', () => {
    const hasher = buildHasher();
    const code = hasher.generateNumericCode(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it('hash déterministe pour un même secret', () => {
    const hasher = buildHasher();
    expect(hasher.hash('mon-jeton')).toBe(hasher.hash('mon-jeton'));
  });

  it('deux jetons différents produisent des hashs différents', () => {
    const hasher = buildHasher();
    expect(hasher.hash('a')).not.toBe(hasher.hash('b'));
  });

  it('compare correctement un jeton à son propre hash', () => {
    const hasher = buildHasher();
    const hash = hasher.hash('mon-jeton');
    expect(hasher.compare('mon-jeton', hash)).toBe(true);
    expect(hasher.compare('mauvais-jeton', hash)).toBe(false);
  });

  it('ne lève pas quand le hash stocké a une longueur différente', () => {
    const hasher = buildHasher();
    expect(hasher.compare('mon-jeton', 'trop-court')).toBe(false);
  });

  it('utilise refreshSecret comme pepper, jamais accessSecret (séparation des clés)', () => {
    // Même refreshSecret, accessSecret différent -> hash identique : la clé
    // de signature JWT n'entre pas dans le calcul.
    const a = buildHasher({ accessSecret: 'jwt-secret-A', refreshSecret: 'pepper-commun' });
    const b = buildHasher({ accessSecret: 'jwt-secret-B', refreshSecret: 'pepper-commun' });
    expect(a.hash('mon-jeton')).toBe(b.hash('mon-jeton'));

    // refreshSecret différent -> hash différent, à accessSecret égal.
    const c = buildHasher({ accessSecret: 'jwt-secret-A', refreshSecret: 'autre-pepper' });
    expect(a.hash('mon-jeton')).not.toBe(c.hash('mon-jeton'));
  });
});

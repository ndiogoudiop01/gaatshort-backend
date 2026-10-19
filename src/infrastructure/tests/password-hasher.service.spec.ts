import type { AppConfigService } from '@config/app-config.service';
import { PasswordHasher } from '../security/password-hasher.service';

function buildHasher(): PasswordHasher {
  const config = { auth: { argon2: { memoryCost: 4096, timeCost: 2 } } } as unknown as AppConfigService;
  return new PasswordHasher(config);
}

describe('PasswordHasher', () => {
  it('vérifie avec succès un mot de passe contre son propre hash', async () => {
    const hasher = buildHasher();
    const hash = await hasher.hash('Sup3r-Secret!');
    expect(await hasher.verify(hash, 'Sup3r-Secret!')).toBe(true);
  });

  it('rejette un mauvais mot de passe', async () => {
    const hasher = buildHasher();
    const hash = await hasher.hash('Sup3r-Secret!');
    expect(await hasher.verify(hash, 'mauvais-mot-de-passe')).toBe(false);
  });

  it('ne lève jamais sur un hash corrompu — renvoie false', async () => {
    const hasher = buildHasher();
    expect(await hasher.verify('pas-un-hash-argon2', 'quelconque')).toBe(false);
  });
});

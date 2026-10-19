import { NullVirusScannerAdapter } from '../security/adapters/null-virus-scanner.adapter';

/**
 * US-IG-009 — ce test documente délibérément une LIMITE, pas une garantie :
 * cet adaptateur ne scanne rien, il pose seulement l'architecture
 * (`VirusScannerPort`) en attendant un vrai scanner (ClamAV ou API tierce).
 * S'il se met un jour à renvoyer autre chose que CLEAN sans raison, ce
 * test cassera — bon signal qu'il a été modifié sans le remplacer.
 */
describe('NullVirusScannerAdapter', () => {
  it('renvoie toujours CLEAN — c’est un placeholder, pas un scanner réel', async () => {
    const adapter = new NullVirusScannerAdapter();

    expect(await adapter.scan(Buffer.from('contenu quelconque'))).toBe('CLEAN');
    expect(await adapter.scan(Buffer.alloc(0))).toBe('CLEAN');
  });
});

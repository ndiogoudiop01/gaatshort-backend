import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Garde-fou d'architecture pour l'ADR multi-tenant :
 *
 *   « Aucun provider REQUEST-scoped n'est introduit. »
 *
 * Le contexte de tenant transite par AsyncLocalStorage (TenantContextService),
 * pas par le cycle de vie d'injection de Nest. Un seul `Scope.REQUEST` suffit
 * à faire reconstruire toute la chaîne contrôleur → use case → repository à
 * chaque requête : ~30 % de latence en plus et un GC qui souffre.
 *
 * On interdit donc `Scope.REQUEST` dans le code de production (hors
 * commentaires). `Scope.TRANSIENT` reste autorisé.
 */
const SRC = join(process.cwd(), 'src');

function productionFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'tests') return [];
      return productionFiles(full);
    }
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.endsWith('.spec.ts') || entry.name.endsWith('.d.ts')) return [];
    return [full];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // blocs /* … */
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // lignes // … (sans casser les URL http://)
}

describe('Architecture multi-tenant', () => {
  it('n’introduit aucun provider REQUEST-scoped (le contexte passe par ALS)', () => {
    const offenders = productionFiles(SRC)
      .filter((file) => /\bScope\.REQUEST\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

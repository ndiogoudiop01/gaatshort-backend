import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Garde-fou d'architecture :
 *
 *   « Aucun `process.env` lu hors de `src/config/`. »
 *
 * Partout ailleurs, on injecte `AppConfigService` (ou on passe par un module
 * de `src/config/`, comme `tracing-env.ts` pour l'amorçage OpenTelemetry qui
 * précède le conteneur d'injection). Un `process.env.FOO` qui vaut `undefined`
 * et ne casse qu'en production trois heures après le déploiement : jamais.
 *
 * La règle ESLint `no-restricted-syntax` bloque déjà `pnpm lint` ; ce test
 * verrouille le critère indépendamment de la config du linter.
 */
const SRC = join(process.cwd(), 'src');
const CONFIG_DIR = join(SRC, 'config');

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
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('Configuration', () => {
  it('ne lit `process.env` que dans src/config/', () => {
    const offenders = productionFiles(SRC)
      .filter((file) => !file.startsWith(CONFIG_DIR))
      .filter((file) => /\bprocess\.env\b/.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => relative(process.cwd(), file));

    expect(offenders).toEqual([]);
  });
});

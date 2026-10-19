import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garde-fou d'architecture :
 *
 *   « Un import qui viole le sens des dépendances fait échouer `pnpm lint`. »
 *
 * `boundaries/element-types` n'a de valeur que si ESLint sait résoudre les
 * alias TypeScript (`@infra/*`, `@shared/*`…). Sans `eslint-import-resolver-typescript`,
 * la règle ne classe rien et ne signale jamais rien — c'est exactement le bug
 * qui a laissé passer 27 imports interdits. Ces deux assertions bloquent tout
 * retour en arrière silencieux ; la troisième prouve, de bout en bout, que le
 * lint échoue sur un import `domaine → infrastructure`.
 */
const ROOT = process.cwd();
const req = createRequire(__filename);

describe('Frontières de couches', () => {
  it('câble le résolveur TypeScript dans eslint.config.mjs', () => {
    const config = readFileSync(join(ROOT, 'eslint.config.mjs'), 'utf8');
    expect(config).toMatch(/['"]import\/resolver['"]\s*:/);
    expect(config).toMatch(/typescript\s*:/);
  });

  it('a `eslint-import-resolver-typescript` installé', () => {
    expect(() => req.resolve('eslint-import-resolver-typescript')).not.toThrow();
  });

  it('fait échouer le lint sur un import domaine → infrastructure', () => {
    // Doit vivre sous `src/modules/*/domain/` pour être classé `domain`.
    const target = join(
      ROOT,
      'src/modules/localization/domain',
      `__dependency_direction_guard_${process.pid}.ts`,
    );
    writeFileSync(
      target,
      "import { PrismaService } from '@infra/persistence/prisma/prisma.service';\n" +
        'export const forbidden = (): unknown => PrismaService;\n',
    );

    let output = '';
    let exitCode = 0;
    try {
      execFileSync(process.execPath, [join(ROOT, 'node_modules/eslint/bin/eslint.js'), target], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      const e = err as { status?: number; stdout?: string; stderr?: string };
      exitCode = e.status ?? 1;
      output = `${e.stdout ?? ''}${e.stderr ?? ''}`;
    } finally {
      rmSync(target, { force: true });
    }

    expect(exitCode).not.toBe(0);
    expect(output).toContain('boundaries/element-types');
  }, 120_000);
});

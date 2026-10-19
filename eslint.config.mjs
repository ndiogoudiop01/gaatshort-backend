// @ts-check
import eslint from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tseslint from '@typescript-eslint/eslint-plugin';
import boundaries from 'eslint-plugin-boundaries';

/**
 * Les règles `boundaries` matérialisent l'architecture hexagonale.
 * Une PR qui viole la direction des dépendances échoue en CI : l'architecture
 * n'est pas un document, c'est une contrainte compilée.
 *
 *   presentation  -> application -> domain
 *   application    -> infrastructure  (consomme les adaptateurs : TenantPrismaService…)
 *   infrastructure -> config, kernel
 *   domain         -> kernel uniquement — jamais d'infrastructure, jamais de config
 *   kernel         -> kernel uniquement
 *
 * `domain` et `kernel` restent purs ; c'est la frontière qu'on protège vraiment.
 * Les fichiers de test câblent volontairement plusieurs couches : `boundaries`
 * y est désactivé (bloc dédié en fin de config).
 */
export default [
  eslint.configs.recommended,
  // @ts-expect-error — le plugin type tous les `configs` comme des configs "classic" (eslintrc),
  // mais les clés `flat/*` renvoient bien un tableau de configs flat au runtime.
  ...tseslint.configs['flat/recommended-type-checked'],
  {
    plugins: { boundaries },
    languageOptions: {
      parser: tsParser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    settings: {
      // `boundaries` doit résoudre les imports pour les classer : sans résolveur
      // TypeScript, les alias `@infra/*`, `@shared/*`… et même les imports relatifs
      // vers des fichiers `.ts` restent « non résolus » et la règle ne voit rien.
      'import/resolver': {
        typescript: { alwaysTryTypes: true, project: './tsconfig.json' },
      },
      'boundaries/include': ['src/**/*.ts'],
      'boundaries/elements': [
        { type: 'kernel', pattern: 'src/shared/**' },
        { type: 'config', pattern: 'src/config/**' },
        { type: 'infrastructure', pattern: 'src/infrastructure/**' },
        { type: 'domain', pattern: 'src/modules/*/domain/**', capture: ['module'] },
        { type: 'application', pattern: 'src/modules/*/application/**', capture: ['module'] },
        { type: 'module-infra', pattern: 'src/modules/*/infrastructure/**', capture: ['module'] },
        { type: 'presentation', pattern: 'src/modules/*/presentation/**', capture: ['module'] },
        { type: 'module-root', pattern: 'src/modules/*/*.ts', capture: ['module'] },
      ],
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-member-accessibility': ['error', { accessibility: 'explicit', overrides: { constructors: 'no-public' } }],
      '@typescript-eslint/consistent-type-imports': 'warn',
      // Autorise `const { omitted, ...rest } = x` — l'idiome standard pour retirer un champ —
      // et les paramètres/variables préfixés `_`, délibérément non utilisés (convention déjà
      // en usage dans le code : `_locale`, `_job`, `_id`…).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { ignoreRestSiblings: true, argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'boundaries/element-types': [
        'error',
        {
          default: 'disallow',
          rules: [
            // Le domaine est pur : il ne connaît que le kernel.
            { from: ['domain'], allow: ['kernel', ['domain', { module: '${from.module}' }]] },
            // L'applicatif orchestre le domaine, lit la config et consomme les
            // adaptateurs d'infrastructure (TenantPrismaService, TokenHasher…) :
            // c'est la convention #2 du README (« on passe par TenantPrismaService »).
            {
              from: ['application'],
              allow: [
                'kernel',
                'config',
                'infrastructure',
                ['domain', { module: '${from.module}' }],
                ['application', { module: '${from.module}' }],
              ],
            },
            // L'infrastructure de module implémente les ports du domaine.
            {
              from: ['module-infra'],
              allow: [
                'kernel',
                'config',
                'infrastructure',
                ['domain', { module: '${from.module}' }],
                ['application', { module: '${from.module}' }],
              ],
            },
            // La présentation ne descend jamais directement dans l'infrastructure de persistance.
            {
              from: ['presentation'],
              allow: [
                'kernel',
                'config',
                'infrastructure',
                ['application', { module: '${from.module}' }],
                ['domain', { module: '${from.module}' }],
              ],
            },
            { from: ['module-root'], allow: ['*'] },
            { from: ['infrastructure'], allow: ['kernel', 'config', 'infrastructure'] },
            { from: ['kernel'], allow: ['kernel'] },
            { from: ['config'], allow: ['kernel', 'config'] },
          ],
        },
      ],
      // Interdit le cross-import direct entre bounded contexts :
      // on passe par les events ou par un port public exposé dans le module racine.
      'boundaries/no-private': ['error', { allowUncles: false }],
      // `process.env` ne se lit qu'à un seul endroit : `src/config/`. Partout
      // ailleurs on injecte `AppConfigService`. Un accès `undefined` qui remonte
      // en production trois heures après le déploiement, c'est fini.
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='process'][property.name='env']",
          message:
            'Lecture de process.env interdite hors de src/config/ : injecte AppConfigService (ou passe par un module de src/config/).',
        },
      ],
    },
  },
  {
    // `src/config/` est le seul point d'entrée autorisé pour `process.env`.
    files: ['src/config/**/*.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    // Les fichiers de test câblent plusieurs couches et lisent l'environnement
    // de test à la main : ni `boundaries` ni l'interdiction de `process.env`
    // ne s'y appliquent.
    files: ['**/*.spec.ts', '**/tests/**/*.ts', 'test/**/*.ts'],
    rules: {
      'boundaries/element-types': 'off',
      'boundaries/no-private': 'off',
      'no-restricted-syntax': 'off',
    },
  },
  {
    // Les doublures de test implémentent des ports asynchrones (`async () => valeur`)
    // sans jamais avoir besoin d'un `await` interne : c'est la forme normale d'un mock.
    // Par ailleurs, `expect.objectContaining`/`expect.any`/`expect.stringContaining`
    // sont typés `any` par @types/jest : leur usage, même correct, déclenche les
    // règles `no-unsafe-*` sans qu'aucun risque réel ne soit présent en test.
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'prisma/generated/**'] },
];

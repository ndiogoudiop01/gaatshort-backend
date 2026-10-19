/**
 * Second filet de sécurité (indépendant d'ESLint) : détecte les cycles et
 * les dépendances inter-modules illégales. Exécuté en CI : `pnpm depcruise src`.
 */
module.exports = {
  forbidden: [
    { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '\\.d\\.ts$' }, to: {} },
    {
      name: 'domain-stays-pure',
      comment: 'Le domaine ne doit dépendre ni de NestJS, ni de Prisma, ni d’aucun driver.',
      severity: 'error',
      from: { path: '^src/modules/[^/]+/domain' },
      to: { path: 'node_modules/(@nestjs|@prisma|ioredis|bullmq|express|argon2)' },
    },
    {
      name: 'no-cross-module-internals',
      comment: 'Un module ne lit pas les entrailles d’un autre module.',
      severity: 'error',
      from: { path: '^src/modules/([^/]+)/' },
      to: { path: '^src/modules/([^/]+)/(domain|application|infrastructure|presentation)/', pathNot: '^src/modules/$1/' },
    },
    {
      name: 'no-raw-prisma-in-modules',
      comment:
        'PrismaService brut (et son échappatoire $privileged, qui pose app.bypass_rls) ' +
        'sont réservés à src/infrastructure/ et au module plateforme tenancy/. ' +
        'Ailleurs : injecter TenantPrismaService, qui porte l’isolation. ' +
        'Allowlist des jobs plateforme cross-tenant : cf. docs/11-tenant-isolation.md.',
      severity: 'error',
      from: {
        path: '^src/modules/',
        pathNot: [
          '\\.spec\\.ts$',
          '/tests/',
          '^src/modules/tenancy/',
          // Jobs plateforme cross-tenant explicitement autorisés (voir docs).
          '^src/modules/analytics/infrastructure/jobs/rollup-metrics\\.job\\.ts$',
          '^src/modules/analytics/infrastructure/jobs/rotate-partitions\\.job\\.ts$',
          '^src/modules/compliance/infrastructure/jobs/data-retention\\.job\\.ts$',
        ],
      },
      to: { path: '/prisma/prisma\\.service\\.ts$' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
  },
};

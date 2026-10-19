import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import { PrismaClient } from '@prisma/client';
import { execSync } from 'node:child_process';

/**
 * Environnement d'intégration jetable via Testcontainers.
 *
 * Pourquoi pas une base partagée ? Parce que les tests d'isolation
 * multi-tenant manipulent des rôles Postgres et des politiques RLS : les
 * exécuter sur une base commune produirait des interférences entre suites,
 * et des échecs impossibles à reproduire localement.
 *
 * Deux connexions sont exposées :
 *  - `databaseUrl`    : rôle propriétaire (migrations, DDL, seed privilégié).
 *  - `appDatabaseUrl` : rôle applicatif `gaatshort_app`, NOSUPERUSER / NOBYPASSRLS.
 *    C'est CELLE-CI que doit utiliser tout test qui vérifie la RLS : un
 *    superutilisateur (le rôle bootstrap de Testcontainers) contourne
 *    silencieusement toutes les politiques.
 */
const APP_ROLE = 'gaatshort_app';
const APP_PASSWORD = 'gaatshort_app';

export interface TenantTestEnv {
  databaseUrl: string;
  appDatabaseUrl: string;
  redisUrl: string;
}

export class TenantTestContext {
  private postgres?: StartedPostgreSqlContainer;
  private redis?: StartedRedisContainer;

  public async start(): Promise<TenantTestEnv> {
    this.postgres = await new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('gaatshort_test')
      .withUsername('gaatshort')
      .withPassword('gaatshort')
      .start();

    this.redis = await new RedisContainer('redis:7-alpine').start();

    const databaseUrl = this.postgres.getConnectionUri();
    // `directUrl` autant que `url` : `prisma migrate deploy` utilise le premier
    // s'il est défini, et le `.env` du dépôt pointe ailleurs — sans ça les
    // migrations partent sur la mauvaise base et le conteneur reste vide.
    process.env.DATABASE_URL = databaseUrl;
    process.env.DATABASE_DIRECT_URL = databaseUrl;

    execSync('pnpm prisma migrate deploy', { env: process.env, stdio: 'inherit' });

    const owner = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    try {
      // Rôle applicatif NON privilégié — miroir de prisma/sql/00-bootstrap-roles.sql,
      // que l'image Testcontainers nue ne joue pas. Créé AVANT rls-policies.sql :
      // le script y pose ses `GRANT ... TO gaatshort_app`.
      await owner.$executeRawUnsafe(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
            CREATE ROLE ${APP_ROLE} LOGIN PASSWORD '${APP_PASSWORD}'
              NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
          END IF;
        END
        $$;
      `);
      await owner.$executeRawUnsafe(`GRANT CONNECT ON DATABASE gaatshort_test TO ${APP_ROLE}`);
      await owner.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
      await owner.$executeRawUnsafe(
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`,
      );

      // Politiques RLS (idempotent). `prisma db execute` plutôt que `psql` :
      // psql n'est pas garanti sur le PATH (CI, postes Windows) et le script
      // est multi-instructions. Le script pose lui-même les GRANT DML par table.
      execSync(
        'pnpm prisma db execute --file prisma/sql/rls-policies.sql --schema prisma/schema.prisma',
        { env: process.env, stdio: 'inherit' },
      );
    } finally {
      await owner.$disconnect();
    }

    const appDatabaseUrl = withCredentials(databaseUrl, APP_ROLE, APP_PASSWORD);
    process.env.DATABASE_APP_URL = appDatabaseUrl;

    return { databaseUrl, appDatabaseUrl, redisUrl: this.redis.getConnectionUrl() };
  }

  public async stop(): Promise<void> {
    await Promise.all([this.postgres?.stop(), this.redis?.stop()]);
  }
}

function withCredentials(connectionUri: string, user: string, password: string): string {
  const url = new URL(connectionUri);
  url.username = user;
  url.password = password;
  return url.toString();
}

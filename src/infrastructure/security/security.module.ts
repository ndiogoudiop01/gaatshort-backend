import { type ExecutionContext, Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { AppConfigService } from '@config/app-config.service';
import { VIRUS_SCANNER } from '@shared/kernel/ports/virus-scanner.port';
import { PasswordHasher } from './password-hasher.service';
import { TokenHasher } from './token-hasher.service';
import { NullVirusScannerAdapter } from './adapters/null-virus-scanner.adapter';

/**
 * `@nestjs/throttler` applique TOUS les throttlers nommés à TOUTES les routes.
 * Sans ce filtre, le quota `public-form` (5/h) bridait aussi le back-office.
 * Les quotas serrés ne valent donc que sur les routes qui les déclarent via
 * `@Throttle({ '<nom>': … })`.
 */
export function onlyWhereDeclared(name: string) {
  return (context: ExecutionContext): boolean =>
    [context.getHandler(), context.getClass()].every(
      (target) => Reflect.getMetadata(`THROTTLER:LIMIT${name}`, target) === undefined,
    );
}

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          { name: 'default', ttl: config.rateLimit.ttlSeconds * 1000, limit: config.rateLimit.limit },
          // Quotas serrés sur les formulaires publics : candidature, lead
          // partenaire, newsletter. C'est là qu'arrivent les bots.
          {
            name: 'public-form',
            ttl: 3_600_000,
            limit: config.rateLimit.publicFormLimit,
            skipIf: onlyWhereDeclared('public-form'),
          },
          { name: 'auth', ttl: 900_000, limit: 10, skipIf: onlyWhereDeclared('auth') },
        ],
      }),
    }),
  ],
  providers: [PasswordHasher, TokenHasher, { provide: VIRUS_SCANNER, useClass: NullVirusScannerAdapter }],
  exports: [ThrottlerModule, PasswordHasher, TokenHasher, VIRUS_SCANNER],
})
export class SecurityModule {}

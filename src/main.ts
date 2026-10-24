import { startTracing } from '@infra/observability/tracing/tracing';
// L'instrumentation OpenTelemetry doit précéder tout autre import.
startTracing();

import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger as PinoLogger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from '@config/app-config.service';
import { setupGracefulShutdown } from './bootstrap/graceful-shutdown';
import { setupSecurity } from './bootstrap/security';
import { setupSwagger } from './bootstrap/swagger';
import { AllExceptionsFilter } from '@shared/filters/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from '@shared/interceptors/response-envelope.interceptor';
import { TimeoutInterceptor } from '@shared/interceptors/timeout.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true, // nécessaire pour vérifier les signatures de webhooks
  });
  // `bufferLogs: true` MET EN ATTENTE tous les logs jusqu'à l'attache
  // explicite d'un logger — sans cet appel (constaté sur le worker, SIB-55,
  // où son absence rendait le process totalement muet, y compris au démarrage
  // et à l'arrêt), rien ne garantit que les logs de boot soient jamais émis.
  // Il fait aussi passer TOUTES les lignes (Nest, use cases, filtres) par le
  // Pino configuré : JSON structuré, corrélé, expurgé.
  app.useLogger(app.get(PinoLogger));
  // 1 Mo (au lieu de 100 Ko) : l'import CSV du catalogue (BO-17) tient dans le corps JSON.
  app.useBodyParser('json', { limit: '1mb' });

  const config = app.get(AppConfigService);
  const reflector = app.get(Reflector);

  setupSecurity(app, config);

  app.setGlobalPrefix(config.app.globalPrefix, {
    exclude: ['health/live', 'health/ready', 'metrics'],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.app.defaultApiVersion,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true, // un champ inconnu = 400, pas un silence
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: false,
    }),
  );

  app.useGlobalInterceptors(
    new LoggerErrorInterceptor(), // journalise l'exception AVEC sa stack via Pino
    new TimeoutInterceptor(15_000, reflector),
    new ResponseEnvelopeInterceptor(reflector),
  );
  app.useGlobalFilters(new AllExceptionsFilter(config.app.isProduction));

  setupSwagger(app, config);
  setupGracefulShutdown(app);

  await app.listen(config.app.port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`API démarrée sur ${await app.getUrl()}/${config.app.globalPrefix}/v1`);
  logger.log(`Environnement : ${config.app.env} | Tenancy : ${config.tenancy.strategy}`);
}

void bootstrap();

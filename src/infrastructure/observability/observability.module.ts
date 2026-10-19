import { Global, Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { AppConfigService } from '@config/app-config.service';
import { buildLoggerConfig } from './logger/logger.config';
import { HealthController } from './health/health.controller';
import { RedisHealthIndicator } from './health/redis.health';
import { MetricsController } from './metrics/metrics.controller';
import { MetricsService } from './metrics/metrics.service';

@Global()
@Module({
  imports: [
    TerminusModule,
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        buildLoggerConfig({
          app: config.app,
          observability: config.observability,
        } as never),
    }),
  ],
  controllers: [HealthController, MetricsController],
  providers: [MetricsService, RedisHealthIndicator],
  // `LoggerModule` est ré-exporté : `PinoLogger` devient injectable partout
  // (module global), notamment dans `LogCorrelationInterceptor`.
  exports: [MetricsService, LoggerModule],
})
export class ObservabilityModule {}

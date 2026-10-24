import { parseTestPhones, type Env } from './env.schema';

/**
 * Projection de l'environnement plat vers des namespaces métier typés.
 * Le reste du code n'accède JAMAIS à `process.env` : il injecte
 * `AppConfigService` et lit une propriété fortement typée.
 */
export const buildConfiguration = (env: Env) =>
  ({
    app: {
      name: env.APP_NAME,
      env: env.NODE_ENV,
      port: env.APP_PORT,
      globalPrefix: env.APP_GLOBAL_PREFIX,
      defaultApiVersion: env.APP_DEFAULT_API_VERSION,
      publicUrl: env.APP_PUBLIC_URL,
      version: env.APP_VERSION,
      frontendUrl: env.FRONTEND_URL,
      corsOrigins: env.CORS_ORIGINS,
      isProduction: env.NODE_ENV === 'production',
    },
    tenancy: {
      strategy: env.TENANCY_STRATEGY,
      resolvers: env.TENANCY_RESOLVERS,
      headerName: env.TENANCY_HEADER_NAME,
      rootDomain: env.TENANCY_ROOT_DOMAIN,
      defaultSlug: env.TENANCY_DEFAULT_SLUG,
      cacheTtlSeconds: env.TENANCY_CACHE_TTL_SECONDS,
      allowAnonymousFallback: env.TENANCY_ALLOW_ANONYMOUS_FALLBACK,
    },
    database: {
      url: env.DATABASE_URL,
      directUrl: env.DATABASE_DIRECT_URL,
      readReplicaUrl: env.DATABASE_READ_REPLICA_URL || undefined,
      logQueries: env.DATABASE_LOG_QUERIES,
      slowQueryMs: env.DATABASE_SLOW_QUERY_MS,
    },
    redis: {
      url: env.REDIS_URL,
      keyPrefix: env.REDIS_KEY_PREFIX,
      cacheDefaultTtlSeconds: env.CACHE_DEFAULT_TTL_SECONDS,
    },
    auth: {
      accessSecret: env.JWT_ACCESS_SECRET,
      accessTtl: env.JWT_ACCESS_TTL,
      refreshSecret: env.JWT_REFRESH_SECRET,
      refreshTtl: env.JWT_REFRESH_TTL,
      magicLinkTtlSeconds: env.MAGIC_LINK_TTL_SECONDS,
      otpTtlSeconds: env.OTP_TTL_SECONDS,
      otpMaxAttempts: env.OTP_MAX_ATTEMPTS,
      otpLength: env.OTP_LENGTH,
      testPhones: parseTestPhones(env.AUTH_TEST_PHONES) ?? {},
      argon2: { memoryCost: env.ARGON2_MEMORY_COST, timeCost: env.ARGON2_TIME_COST },
    },
    storage: {
      driver: env.STORAGE_DRIVER,
      endpoint: env.STORAGE_ENDPOINT,
      region: env.STORAGE_REGION,
      bucket: env.STORAGE_BUCKET,
      accessKey: env.STORAGE_ACCESS_KEY,
      secretKey: env.STORAGE_SECRET_KEY,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      presignTtlSeconds: env.STORAGE_PRESIGN_TTL_SECONDS,
      downloadTtlSeconds: env.STORAGE_DOWNLOAD_TTL_SECONDS,
      maxFileSizeBytes: env.STORAGE_MAX_FILE_SIZE_MB * 1024 * 1024,
      allowedMimeTypes: env.STORAGE_ALLOWED_MIME,
    },
    mail: {
      driver: env.MAIL_DRIVER,
      from: env.MAIL_FROM,
      smtp: {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: env.SMTP_USER,
        password: env.SMTP_PASSWORD,
      },
    },
    sms: { driver: env.SMS_DRIVER, senderId: env.SMS_SENDER_ID },
    observability: {
      logLevel: env.LOG_LEVEL,
      logPretty: env.LOG_PRETTY,
      metricsEnabled: env.METRICS_ENABLED,
      otelEnabled: env.OTEL_ENABLED,
      otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      sentryDsn: env.SENTRY_DSN,
    },
    rateLimit: {
      ttlSeconds: env.RATE_LIMIT_TTL_SECONDS,
      limit: env.RATE_LIMIT_LIMIT,
      publicFormLimit: env.RATE_LIMIT_PUBLIC_FORM_LIMIT,
    },
    gdpr: {
      applicationRetentionDays: env.GDPR_RETENTION_APPLICATION_DAYS,
      rejectedRetentionDays: env.GDPR_RETENTION_REJECTED_DAYS,
      exportTtlHours: env.GDPR_EXPORT_TTL_HOURS,
    },
    video: {
      driver: env.VIDEO_DRIVER,
      fakeHlsUrl: env.VIDEO_FAKE_HLS_URL,
      playbackTtlSeconds: env.VIDEO_PLAYBACK_TTL_SECONDS,
      bunny: {
        libraryId: env.BUNNY_STREAM_LIBRARY_ID ?? '',
        apiKey: env.BUNNY_STREAM_API_KEY ?? '',
        cdnHost: env.BUNNY_STREAM_CDN_HOST ?? '',
        tokenKey: env.BUNNY_STREAM_TOKEN_KEY ?? '',
        webhookSecret: env.BUNNY_WEBHOOK_SECRET ?? '',
      },
    },
    payment: {
      driver: env.PAYMENT_DRIVER,
      orderTtlMinutes: env.PAYMENT_ORDER_TTL_MINUTES,
      paytech: {
        apiKey: env.PAYTECH_API_KEY ?? '',
        apiSecret: env.PAYTECH_API_SECRET ?? '',
        env: env.PAYTECH_ENV,
        successUrl: env.PAYTECH_SUCCESS_URL,
        cancelUrl: env.PAYTECH_CANCEL_URL,
      },
    },
  }) as const;

export type AppConfiguration = ReturnType<typeof buildConfiguration>;

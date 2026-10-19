import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import compression from 'compression';
import type { Express } from 'express';
import helmet from 'helmet';
import type { AppConfigService } from '@config/app-config.service';

export function setupSecurity(app: INestApplication, config: AppConfigService): void {
  app.use(
    helmet({
      contentSecurityPolicy: config.app.isProduction ? undefined : false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      hsts: { maxAge: 31_536_000, includeSubDomains: true, preload: true },
    }),
  );
  app.use(compression());

  // Derrière un ALB / Cloudflare : sans ça, req.ip renvoie l'IP du proxy et
  // la limitation de débit devient globale au lieu d'être par client.
  (app.getHttpAdapter().getInstance() as Express).set('trust proxy', 1);

  // L'origine de l'API elle-même (Swagger UI) : le navigateur envoie `Origin`
  // même sur un POST de même origine.
  const origins = [...config.app.corsOrigins, new URL(config.app.publicUrl).origin];
  const rootDomain = `.${new URL(config.app.publicUrl).hostname.split('.').slice(-2).join('.')}`;

  const corsOptions: CorsOptions = {
    // Les sous-domaines de tenants sont dynamiques : on valide le suffixe.
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // appels serveur-à-serveur
      const allowed = origins.includes(origin) || new URL(origin).hostname.endsWith(rootDomain);
      callback(allowed ? null : new Error(`Origine non autorisée : ${origin}`), allowed);
    },
    credentials: true,
    exposedHeaders: ['x-request-id', 'x-tenant', 'retry-after'],
    allowedHeaders: ['content-type', 'authorization', 'x-tenant-id', 'idempotency-key', 'accept-language'],
    maxAge: 86_400,
  };
  app.enableCors(corsOptions);
}

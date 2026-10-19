// Les méthodes des contrôleurs sont référencées sans jamais être invoquées
// « déliées » (elles servent uniquement de clé Reflect), le risque que cible
// cette règle ne s'applique donc pas ici.
/* eslint-disable @typescript-eslint/unbound-method */
import { HealthController } from '../observability/health/health.controller';
import { MetricsController } from '../observability/metrics/metrics.controller';

// `@nestjs/throttler` concatène le nom du seau à la clé, SANS séparateur
// (cf. `setThrottlerMetadata`). Même convention que dans
// `my-applications.controller.spec.ts`, qui lit le seau `public-form`.
const SKIP = 'THROTTLER:SKIP' + 'default';
const LIMIT = 'THROTTLER:LIMIT' + 'default';
const TTL = 'THROTTLER:TTL' + 'default';

/**
 * SIB-55 — les sondes et le scrape Prometheus sont `@Public()`, hors préfixe
 * `/api` et non versionnés : joignables sans authentification par quiconque
 * atteint le conteneur. Le `ThrottlerGuard` est donc leur seule borne.
 *
 * Ces tests ne vérifient pas le guard lui-même (il a les siens, cf.
 * `tenant-throttler.guard.spec.ts`) mais qu'il est branché sur les bonnes
 * routes avec les bons seuils — et surtout que l'exemption reste cantonnée
 * à `/health/live`. Une exemption posée sur la CLASSE est héritée par toutes
 * les routes : c'est précisément la régression que ces tests ferment.
 */
describe('Sondes et métriques — bornes de débit', () => {
  describe('HealthController', () => {
    it('exempte `/health/live` — sur la route, jamais sur la classe', () => {
      expect(Reflect.getMetadata(SKIP, HealthController.prototype.live)).toBe(true);
      expect(Reflect.getMetadata(SKIP, HealthController)).toBeUndefined();
    });

    it('n’exempte PAS `/health/ready` : il interroge Postgres et Redis à chaque appel', () => {
      expect(Reflect.getMetadata(SKIP, HealthController.prototype.ready)).toBeUndefined();
    });

    it('plafonne `/health/ready` à 60 par minute', () => {
      expect(Reflect.getMetadata(LIMIT, HealthController.prototype.ready)).toBe(60);
      expect(Reflect.getMetadata(TTL, HealthController.prototype.ready)).toBe(60_000);
    });
  });

  describe('MetricsController', () => {
    it('plafonne `/metrics` à 120 par minute (Prometheus scrape à 15-30 s)', () => {
      expect(Reflect.getMetadata(LIMIT, MetricsController)).toBe(120);
      expect(Reflect.getMetadata(TTL, MetricsController)).toBe(60_000);
    });

    it('n’exempte `/metrics` ni sur la classe ni sur la route', () => {
      expect(Reflect.getMetadata(SKIP, MetricsController)).toBeUndefined();
      expect(Reflect.getMetadata(SKIP, MetricsController.prototype.scrape)).toBeUndefined();
    });
  });
});

import type { INestApplication } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { AppConfigService } from '@config/app-config.service';
import { setupSecurity } from '../security';

function buildApp() {
  const set = jest.fn();
  const enableCors = jest.fn();
  const use = jest.fn();
  const app = {
    use,
    enableCors,
    getHttpAdapter: () => ({ getInstance: () => ({ set }) }),
  } as unknown as INestApplication;
  return { app, set, enableCors, use };
}

const CONFIG = {
  app: {
    isProduction: false,
    corsOrigins: ['https://gaatshort.com'],
    publicUrl: 'https://gaatshort.com',
  },
} as unknown as AppConfigService;

describe('setupSecurity', () => {
  it('configure helmet, la compression et la confiance au proxy', () => {
    const { app, set, use } = buildApp();
    setupSecurity(app, CONFIG);
    expect(use).toHaveBeenCalledTimes(2);
    expect(set).toHaveBeenCalledWith('trust proxy', 1);
  });

  it('autorise les appels serveur-à-serveur sans en-tête Origin', () => {
    const { app, enableCors } = buildApp();
    setupSecurity(app, CONFIG);
    const options = enableCors.mock.calls[0][0] as CorsOptions & {
      origin: (o: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
    };
    const callback = jest.fn();
    options.origin(undefined, callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('autorise une origine explicitement déclarée', () => {
    const { app, enableCors } = buildApp();
    setupSecurity(app, CONFIG);
    const options = enableCors.mock.calls[0][0] as CorsOptions & {
      origin: (o: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
    };
    const callback = jest.fn();
    options.origin('https://gaatshort.com', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('autorise un sous-domaine de tenant dynamique', () => {
    const { app, enableCors } = buildApp();
    setupSecurity(app, CONFIG);
    const options = enableCors.mock.calls[0][0] as CorsOptions & {
      origin: (o: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
    };
    const callback = jest.fn();
    options.origin('https://kaay.gaatshort.com', callback);
    expect(callback).toHaveBeenCalledWith(null, true);
  });

  it('refuse une origine hors périmètre', () => {
    const { app, enableCors } = buildApp();
    setupSecurity(app, CONFIG);
    const options = enableCors.mock.calls[0][0] as CorsOptions & {
      origin: (o: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void;
    };
    const callback = jest.fn();
    options.origin('https://malicious.example', callback);
    expect(callback).toHaveBeenCalledWith(expect.any(Error), false);
  });
});

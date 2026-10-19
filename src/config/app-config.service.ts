import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from './configuration';

/**
 * Façade typée au-dessus de ConfigService.
 * Interdit d'injecter `ConfigService` ailleurs : cf. règle ESLint `no-restricted-imports`.
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppConfiguration, true>) {}

  public get app(): AppConfiguration['app'] {
    return this.config.get('app', { infer: true });
  }
  public get tenancy(): AppConfiguration['tenancy'] {
    return this.config.get('tenancy', { infer: true });
  }
  public get database(): AppConfiguration['database'] {
    return this.config.get('database', { infer: true });
  }
  public get redis(): AppConfiguration['redis'] {
    return this.config.get('redis', { infer: true });
  }
  public get auth(): AppConfiguration['auth'] {
    return this.config.get('auth', { infer: true });
  }
  public get storage(): AppConfiguration['storage'] {
    return this.config.get('storage', { infer: true });
  }
  public get mail(): AppConfiguration['mail'] {
    return this.config.get('mail', { infer: true });
  }
  public get sms(): AppConfiguration['sms'] {
    return this.config.get('sms', { infer: true });
  }
  public get observability(): AppConfiguration['observability'] {
    return this.config.get('observability', { infer: true });
  }
  public get rateLimit(): AppConfiguration['rateLimit'] {
    return this.config.get('rateLimit', { infer: true });
  }
  public get gdpr(): AppConfiguration['gdpr'] {
    return this.config.get('gdpr', { infer: true });
  }
}

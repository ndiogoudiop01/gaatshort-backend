import { Global, Inject, Injectable, Module } from '@nestjs/common';
import type { Request } from 'express';
import { TENANT_CONTEXT, type TenantContextPort } from '@shared/kernel/ports/tenant-context.port';
import type { AuthenticatedUser } from '@shared/kernel/types/authenticated-user';
import { TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

export interface ViewerContext {
  readonly accountId: string | null;
  readonly country: string;
  readonly locale: 'fr' | 'en';
}

/** Indicatif → pays (PRD §3 : Sénégal, Gambie). */
export function countryFromPhone(phoneE164: string | null | undefined): string | null {
  if (!phoneE164) return null;
  if (phoneE164.startsWith('+221')) return 'SN';
  if (phoneE164.startsWith('+220')) return 'GM';
  return null;
}

/**
 * Pays et langue du spectateur, qui décident de la disponibilité des séries
 * (licences par territoire) et des textes renvoyés.
 *  • pays : celui du compte (déduit de l'indicatif) ; sinon l'en-tête pays posé
 *    par le CDN (`cf-ipcountry`) ; sinon le pays par défaut de la marque ;
 *  • langue : `?locale=` ; sinon celle du compte ; sinon `Accept-Language` ;
 *    sinon celle de la marque.
 */
@Injectable()
export class ViewerContextService {
  constructor(
    private readonly prisma: TenantPrismaService,
    @Inject(TENANT_CONTEXT) private readonly tenant: TenantContextPort,
  ) {}

  public async resolve(req: Request, user?: AuthenticatedUser | null): Promise<ViewerContext> {
    const accountId = user?.accountId ?? null;
    const account = accountId
      ? await this.prisma.client.account.findUnique({ where: { id: accountId }, select: { countryCode: true, locale: true } })
      : null;
    const header = req.headers['cf-ipcountry'];
    const cdnCountry = typeof header === 'string' && /^[A-Z]{2}$/.test(header) ? header : null;
    const t = this.tenant.get();
    const queryLocale = typeof req.query?.locale === 'string' ? req.query.locale : null;
    const accept = typeof req.headers['accept-language'] === 'string' ? req.headers['accept-language'].slice(0, 2) : null;
    const locale = [queryLocale, account?.locale, accept, t.defaultLocale].find((l) => l === 'fr' || l === 'en');
    return {
      accountId,
      country: account?.countryCode ?? cdnCountry ?? t.defaultCountry,
      locale: locale ?? 'fr',
    };
  }
}

@Global()
@Module({ providers: [ViewerContextService], exports: [ViewerContextService] })
export class ViewerContextModule {}

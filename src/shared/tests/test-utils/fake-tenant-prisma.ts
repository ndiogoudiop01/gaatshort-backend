import type { Prisma } from '@prisma/client';
import type { TenantClient, TenantPrismaService } from '@infra/persistence/prisma/tenant-prisma.service';

/** Signature du helper de SQL brut exposé par TenantPrismaService. */
type RunRaw = (run: (tx: Prisma.TransactionClient) => Promise<unknown>) => Promise<unknown>;

/**
 * Fake de TenantPrismaService : expose `client` sans base ni extension Prisma
 * réelle. Par défaut `runRawInTenantScope` délègue au même faux client ; le
 * vrai ouvre une transaction et y pose `app.current_tenant_id`, comportement
 * couvert par `tenant-prisma-raw-scope.spec.ts`. L'override sert aux tests
 * qui veulent vérifier que le repository passe bien par ce helper.
 */
export function fakeTenantPrisma(
  client: Record<string, unknown>,
  runRawInTenantScope?: RunRaw,
): TenantPrismaService {
  const fallback: RunRaw = (run) => run(client as unknown as Prisma.TransactionClient);
  return {
    client: client as unknown as TenantClient,
    runRawInTenantScope: runRawInTenantScope ?? fallback,
  } as unknown as TenantPrismaService;
}

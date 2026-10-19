import type { PrismaService } from '../persistence/prisma/prisma.service';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import type { TransactionHost } from '../persistence/prisma/transaction-host.service';
import { TenantPrismaService } from '../persistence/prisma/tenant-prisma.service';

/**
 * Le SQL brut échappe à l'extension Prisma tenant-scopée : aucun
 * `set_config('app.current_tenant_id', …)` n'est émis pour lui, et la portée
 * `TRUE` (= SET LOCAL) fait mourir au COMMIT la valeur posée par une requête
 * de modèle antérieure. La RLS étant fail-closed, un `$queryRaw` hors
 * transaction renvoie ZÉRO ligne sans lever d'erreur — un bug qui ne se voit
 * ni en revue ni dans les logs.
 *
 * Ces tests verrouillent la garantie du helper : le `set_config` est bien
 * émis, avec le bon tenant, AVANT la requête et dans la MÊME transaction.
 */
describe('TenantPrismaService.runRawInTenantScope', () => {
  function buildTx() {
    const order: string[] = [];
    const tx = {
      $executeRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
        void values;
        order.push(strings.join('?'));
        return 1;
      }),
      $queryRaw: jest.fn(async (strings: TemplateStringsArray) => {
        order.push(strings.join('?'));
        return [];
      }),
    };
    return { tx, order };
  }

  function build(tenantId: string, current: unknown = null) {
    const { tx, order } = buildTx();
    const prisma = {
      $transaction: async (arg: unknown) =>
        typeof arg === 'function'
          ? (arg as (client: unknown) => Promise<unknown>)(tx)
          : Promise.all(arg as unknown[]),
    } as unknown as PrismaService;
    const tenantContext = { tenantId } as unknown as TenantContextService;
    const txHost = {
      current,
      run: <T>(_tx: unknown, fn: () => Promise<T>): Promise<T> => {
        void _tx;
        return fn();
      },
    } as unknown as TransactionHost;
    const service = new TenantPrismaService(prisma, tenantContext, txHost);
    return { service, tx, order };
  }

  it('pose app.current_tenant_id AVANT d’exécuter le SQL brut', async () => {
    const { service, order } = build('tenant-1');

    await service.runRawInTenantScope((tx) => tx.$queryRaw`SELECT a.id FROM applications a`);

    expect(order).toHaveLength(2);
    expect(order[0]).toContain("set_config('app.current_tenant_id'");
    expect(order[1]).toContain('FROM applications a');
  });

  it('transmet le tenant courant à set_config', async () => {
    const { service, tx } = build('tenant-42');

    await service.runRawInTenantScope(async () => undefined);

    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw.mock.calls[0][1]).toBe('tenant-42');
  });

  it('réutilise la transaction en cours au lieu d’en ouvrir une seconde', async () => {
    const running = { $queryRaw: jest.fn(async () => []) };
    const { service, tx } = build('tenant-1', running);

    await service.runRawInTenantScope((client) => client.$queryRaw`SELECT 1`);

    // Le `set_config` de la transaction englobante est déjà posé ; en reposer
    // un ouvrirait une transaction imbriquée, que Prisma ne gère pas.
    expect(running.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});

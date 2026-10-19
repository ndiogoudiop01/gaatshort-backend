import type { Request } from 'express';
import type { TenantContextService } from '../tenancy/context/tenant-context.service';
import { TenantThrottlerGuard } from '../ratelimit/tenant-throttler.guard';

function buildGuard(tenantContext?: Partial<TenantContextService>): TenantThrottlerGuard {
  const guard = Object.create(TenantThrottlerGuard.prototype) as TenantThrottlerGuard;
  Object.defineProperty(guard, 'tenantContext', { value: tenantContext, writable: true });
  return guard;
}

function getTracker(guard: TenantThrottlerGuard, req: Partial<Request> & { user?: { id: string } }) {
  return (guard as unknown as { getTracker(r: typeof req): Promise<string> }).getTracker(req);
}

describe('TenantThrottlerGuard', () => {
  it('combine le tenant courant et l’utilisateur authentifié', async () => {
    const guard = buildGuard({ getOrNull: () => ({ tenantId: 'tenant-1' }) as never });
    expect(await getTracker(guard, { user: { id: 'user-1' } })).toBe('tenant-1:user-1');
  });

  it('retombe sur l’IP quand la requête est anonyme', async () => {
    const guard = buildGuard({ getOrNull: () => ({ tenantId: 'tenant-1' }) as never });
    expect(await getTracker(guard, { ip: '203.0.113.4' })).toBe('tenant-1:203.0.113.4');
  });

  it('utilise « anon » hors de tout contexte tenant', async () => {
    const guard = buildGuard({ getOrNull: () => null });
    expect(await getTracker(guard, { ip: '203.0.113.4' })).toBe('anon:203.0.113.4');
  });
});

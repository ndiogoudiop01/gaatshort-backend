import { PaginatedResult } from '@shared/kernel/application/pagination';

describe('PaginatedResult', () => {
  it('calcule le nombre total de pages et signale s’il en reste', () => {
    const result = PaginatedResult.offset(['a', 'b'], 42, 1, 20);
    expect(result.meta.totalPages).toBe(3);
    expect(result.meta.hasMore).toBe(true);
  });

  it('signale l’absence de page suivante sur la dernière page', () => {
    const result = PaginatedResult.offset(['a'], 21, 2, 20);
    expect(result.meta.hasMore).toBe(false);
  });

  it('garantit au moins une page même sur un total à zéro', () => {
    const result = PaginatedResult.offset([], 0, 1, 20);
    expect(result.meta.totalPages).toBe(1);
    expect(result.meta.hasMore).toBe(false);
  });

  it('la pagination par curseur expose le curseur suivant', () => {
    const withNext = PaginatedResult.cursor(['a', 'b'], 'cursor-2');
    const last = PaginatedResult.cursor(['c'], null);
    expect(withNext.meta.hasMore).toBe(true);
    expect(withNext.meta.nextCursor).toBe('cursor-2');
    expect(last.meta.hasMore).toBe(false);
  });

  it('map transforme les items en conservant la métadonnée', () => {
    const result = PaginatedResult.offset([1, 2, 3], 3, 1, 20).map((n) => n * 2);
    expect(result.items).toEqual([2, 4, 6]);
    expect(result.meta.total).toBe(3);
  });
});

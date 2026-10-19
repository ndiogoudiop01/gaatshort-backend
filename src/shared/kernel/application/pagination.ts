export interface OffsetPage {
  readonly page: number;
  readonly perPage: number;
}

export interface CursorPage {
  readonly cursor?: string;
  readonly limit: number;
}

export interface SortSpec<TField extends string = string> {
  readonly field: TField;
  readonly direction: 'asc' | 'desc';
}

/**
 * Deux pagination différentes, deux usages :
 *  - offset : back-office (l'utilisateur veut « page 7 sur 42 »)
 *  - cursor : listes publiques et flux infinis (stable et O(1) à profondeur)
 * Ne jamais offrir l'offset sur une table à forte volumétrie : `OFFSET 100000`
 * fait scanner 100 000 lignes à Postgres.
 */
export class PaginatedResult<T> {
  private constructor(
    public readonly items: readonly T[],
    public readonly meta: {
      readonly total?: number;
      readonly page?: number;
      readonly perPage?: number;
      readonly totalPages?: number;
      readonly nextCursor?: string | null;
      readonly hasMore: boolean;
    },
  ) {}

  public static offset<T>(items: T[], total: number, page: number, perPage: number) {
    return new PaginatedResult<T>(items, {
      total,
      page,
      perPage,
      totalPages: Math.max(1, Math.ceil(total / perPage)),
      hasMore: page * perPage < total,
    });
  }

  public static cursor<T>(items: T[], nextCursor: string | null) {
    return new PaginatedResult<T>(items, { nextCursor, hasMore: nextCursor !== null });
  }

  public map<U>(fn: (item: T) => U): PaginatedResult<U> {
    return new PaginatedResult<U>(this.items.map(fn), this.meta);
  }
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string | null;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  readonly sessionId: string;
  /**
   * BSG-12 — périmètre pays, figé dans le jeton comme les permissions.
   * `null` = tous les pays du tenant. Absent (jeton émis avant BSG-12,
   * 15 min au plus) = traité comme `null`, le comportement d'avant.
   */
  readonly countries?: readonly string[] | null;
}

export interface JwtAccessPayload {
  readonly sub: string;
  /** tenant id — scellé dans le token, fait autorité sur tout en-tête */
  readonly tid: string;
  readonly email: string | null;
  readonly roles: string[];
  readonly perms: string[];
  readonly sid: string;
  /** BSG-12 — pays visibles ; `null` = tous. Cf. `AuthenticatedUser.countries`. */
  readonly cty?: string[] | null;
  readonly iat: number;
  readonly exp: number;
}

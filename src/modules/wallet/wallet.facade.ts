export const WALLET_FACADE = Symbol('WALLET_FACADE');

export interface WalletBalance {
  readonly paidBalance: number;
  readonly bonusBalance: number;
  readonly total: number;
}

/**
 * Portefeuille COMMUN à toutes les marques (Q-02) : un compte = un solde, et un
 * épisode débloqué l'est partout. La marque d'origine de chaque mouvement est
 * tracée (`originTenantId`) pour les reversements.
 */
export interface WalletFacade {
  balance(accountId: string): Promise<WalletBalance>;
  unlockedEpisodeIds(accountId: string, episodeIds: readonly string[]): Promise<Set<string>>;
  /**
   * Crédit d'un achat payé. Idempotent par commande (index unique partiel) :
   * renvoie `false` si la commande avait déjà été créditée. Doit être appelé
   * DANS la transaction qui passe la commande à SUCCEEDED.
   */
  creditPurchase(params: {
    accountId: string;
    orderId: string;
    coins: number;
    bonusCoins: number;
    originTenantId: string;
  }): Promise<boolean>;
  ledger(accountId: string, limit: number, before?: string): Promise<{
    items: { id: string; kind: string; delta: number; paidDelta: number; bonusDelta: number; reason: string | null; orderId: string | null; episodeId: string | null; createdAt: Date }[];
    nextBefore: string | null;
  }>;
  /** Ajustement par l'assistance : crédits bonus uniquement, motif obligatoire, audité. */
  adjust(params: { accountId: string; delta: number; reason: string; actorUserId: string }): Promise<WalletBalance>;
}

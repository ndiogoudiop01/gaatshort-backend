export const STORAGE = Symbol('STORAGE');

export interface PresignedUpload {
  readonly url: string;
  readonly fields: Record<string, string>;
  readonly storageKey: string;
  readonly expiresAt: Date;
}

/**
 * Aucun binaire ne traverse l'API : le client téléverse directement vers S3
 * via une URL signée, l'API ne voit que des métadonnées. C'est ce qui permet
 * de tenir la charge sur US-IG-009 sans saturer les workers Node.
 */
export interface StoragePort {
  createPresignedUpload(params: {
    storageKey: string;
    mimeType: string;
    maxSizeBytes: number;
  }): Promise<PresignedUpload>;
  createPresignedDownload(storageKey: string, ttlSeconds?: number): Promise<string>;
  delete(storageKey: string): Promise<void>;
  exists(storageKey: string): Promise<boolean>;
  headObject(storageKey: string): Promise<{ sizeBytes: number; mimeType: string } | null>;
  /**
   * Lit le contenu binaire d'un objet — réservé au worker (analyse
   * antivirus, cf. `VirusScannerPort`). Ne contredit pas « aucun binaire ne
   * transite par l'API » (US-IG-009) : cette règle porte sur le chemin
   * HTTP requête/réponse, jamais emprunté ici — le scan tourne en tâche de
   * fond (BullMQ), hors de tout cycle de requête.
   */
  getObject(storageKey: string): Promise<Buffer>;
  /**
   * Écrit un objet généré côté serveur — réservé au worker (export CSV du
   * vivier, bundle RGPD). Même raisonnement que `getObject` : aucun binaire
   * *client* ne transite par l'API, mais un fichier généré en tâche de fond
   * (jamais reçu d'un utilisateur) doit bien atterrir sur le stockage
   * objet avant qu'une URL signée puisse être délivrée (US-IG-012).
   */
  putObject(params: { storageKey: string; body: Buffer; mimeType: string }): Promise<void>;
}

export const VIDEO_PROVIDER = Symbol('VIDEO_PROVIDER');

/** Paramètres de téléversement direct (TUS) remis au back-office. */
export interface DirectUploadTicket {
  readonly providerRef: string;
  readonly endpoint: string | null; // null : rien à téléverser (pilote factice)
  readonly headers: Record<string, string>;
}

export interface ProviderVideoState {
  readonly status: 'PROCESSING' | 'READY' | 'FAILED';
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly thumbnailUrl: string | null;
  readonly failureReason: string | null;
}

/**
 * Fournisseur vidéo (Bunny Stream par défaut, ADR TRD §7). Le domaine ne voit
 * qu'une référence opaque `providerRef`.
 */
export interface VideoProviderPort {
  readonly name: 'BUNNY_STREAM' | 'FAKE';
  createDirectUpload(title: string): Promise<DirectUploadTicket>;
  /** Le fournisseur télécharge lui-même le fichier source (import en lot). */
  ingestFromUrl(title: string, sourceUrl: string): Promise<{ providerRef: string }>;
  getState(providerRef: string): Promise<ProviderVideoState>;
  /** URL HLS signée, courte durée (anti-partage). */
  signedPlaybackUrl(providerRef: string, ttlSeconds: number): { url: string; expiresAt: Date };
  deleteVideo(providerRef: string): Promise<void>;
}

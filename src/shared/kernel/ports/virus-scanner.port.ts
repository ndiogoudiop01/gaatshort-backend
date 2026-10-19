export const VIRUS_SCANNER = Symbol('VIRUS_SCANNER');

export type ScanVerdict = 'CLEAN' | 'INFECTED';

/**
 * US-IG-009 — chaque pièce déposée est analysée avant d'être consultable.
 *
 * Port séparé de `StoragePort` : le stockage sait où vivent les octets, le
 * scanner sait s'ils sont sûrs — deux responsabilités, deux adaptateurs
 * remplaçables indépendamment (ClamAV auto-hébergé aujourd'hui, une API
 * tierce demain, sans toucher au job qui les orchestre).
 */
export interface VirusScannerPort {
  scan(content: Buffer): Promise<ScanVerdict>;
}

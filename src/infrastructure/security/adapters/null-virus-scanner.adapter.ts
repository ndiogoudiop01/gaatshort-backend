import { Injectable, Logger } from '@nestjs/common';
import type { ScanVerdict, VirusScannerPort } from '@shared/kernel/ports/virus-scanner.port';

/**
 * ⚠️ PLACEHOLDER — ne scanne RIEN, renvoie toujours CLEAN.
 *
 * Pose l'architecture (port + adaptateur, cf. VirusScannerPort) pour que
 * `ScanDocumentProcessor` et tout le reste du code n'aient jamais à changer
 * le jour où un vrai scanner est branché — seul ce fichier sera remplacé
 * (ex. un adaptateur ClamAV/clamd, ou un appel à une API tierce).
 *
 * NE JAMAIS déployer cet adaptateur en production tel quel : jusqu'à son
 * remplacement, AUCUN fichier déposé n'est réellement analysé, quoi que
 * `GetDownloadUrlQuery`/`ScanDocumentProcessor` en pensent. Le message
 * d'avertissement à chaque appel est volontaire — il doit être bruyant
 * dans les logs d'un environnement qui l'utiliserait par erreur.
 */
@Injectable()
export class NullVirusScannerAdapter implements VirusScannerPort {
  private readonly logger = new Logger(NullVirusScannerAdapter.name);

  public scan(content: Buffer): Promise<ScanVerdict> {
    void content;
    this.logger.warn(
      'NullVirusScannerAdapter : aucune analyse antivirus réelle effectuée — adaptateur non final (US-IG-009)',
    );
    return Promise.resolve('CLEAN');
  }
}

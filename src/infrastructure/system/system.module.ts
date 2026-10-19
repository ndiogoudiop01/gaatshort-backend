import { Global, Module } from '@nestjs/common';
import { CLOCK } from '@shared/kernel/ports/clock.port';
import { SystemClock } from './system-clock.service';

/**
 * Fournit les dépendances techniques transverses les plus banales —
 * l'horloge en tête. Les injecter plutôt que les appeler directement rend
 * chaque règle temporelle (expiration d'OTP, rétention RGPD, conflit
 * d'agenda) testable sans manipuler l'heure système.
 */
@Global()
@Module({
  providers: [SystemClock, { provide: CLOCK, useExisting: SystemClock }],
  exports: [CLOCK, SystemClock],
})
export class SystemModule {}

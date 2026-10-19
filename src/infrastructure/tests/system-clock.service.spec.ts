import { SystemClock } from '../system/system-clock.service';

describe('SystemClock', () => {
  const clock = new SystemClock();

  it('now() renvoie l’heure courante', () => {
    const before = Date.now();
    const now = clock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
  });

  it('today() tronque l’heure à minuit', () => {
    const today = clock.today();
    expect(today.getHours()).toBe(0);
    expect(today.getMinutes()).toBe(0);
    expect(today.getSeconds()).toBe(0);
  });

  it('addDays() ajoute des jours entiers', () => {
    const base = new Date('2026-01-01T12:00:00.000Z');
    expect(clock.addDays(base, 5).toISOString()).toBe('2026-01-06T12:00:00.000Z');
  });

  it('addSeconds() ajoute des secondes', () => {
    const base = new Date('2026-01-01T00:00:00.000Z');
    expect(clock.addSeconds(base, 90).toISOString()).toBe('2026-01-01T00:01:30.000Z');
  });
});

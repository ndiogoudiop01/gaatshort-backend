export const CLOCK = Symbol('CLOCK');

/**
 * Le temps est une dépendance comme une autre.
 * `new Date()` dans le domaine = test non déterministe garanti.
 */
export interface ClockPort {
  now(): Date;
  today(): Date;
  addDays(date: Date, days: number): Date;
  addSeconds(date: Date, seconds: number): Date;
}

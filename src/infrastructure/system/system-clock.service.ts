import { Injectable } from '@nestjs/common';
import type { ClockPort } from '@shared/kernel/ports/clock.port';

@Injectable()
export class SystemClock implements ClockPort {
  public now(): Date {
    return new Date();
  }

  public today(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  public addDays(date: Date, days: number): Date {
    return new Date(date.getTime() + days * 86_400_000);
  }

  public addSeconds(date: Date, seconds: number): Date {
    return new Date(date.getTime() + seconds * 1_000);
  }
}

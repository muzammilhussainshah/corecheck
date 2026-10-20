import { Injectable } from '@nestjs/common';

/** The current time, injectable so tests can move it forward. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

/**
 * The calendar date ("YYYY-MM-DD") at `instant` in an IANA time zone. Account
 * dates and due dates follow the organisation's time zone (NFR-005).
 */
export const dateInTimeZone = (instant: Date, timeZone: string): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);

export const addSeconds = (date: Date, seconds: number): Date =>
  new Date(date.getTime() + seconds * 1000);

export const addDays = (date: Date, days: number): Date =>
  addSeconds(date, days * 24 * 60 * 60);

import { QueryFailedError } from 'typeorm';

interface PgDriverError {
  code?: string;
  constraint?: string;
}

const driverError = (error: unknown): PgDriverError | null =>
  error instanceof QueryFailedError
    ? (error.driverError as PgDriverError)
    : null;

export const isUniqueViolation = (
  error: unknown,
  constraint?: string,
): boolean => {
  const pg = driverError(error);
  return (
    pg?.code === '23505' &&
    (constraint === undefined || pg.constraint === constraint)
  );
};

/** Raised by corecheck.enforce_seat_limit() (IAD-005). */
export const isSeatLimitError = (error: unknown): boolean =>
  driverError(error)?.code === 'CC001';

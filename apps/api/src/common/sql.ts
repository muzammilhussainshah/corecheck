/**
 * Collects positional parameters for hand-written SQL so values are never
 * interpolated into the query text.
 */
export class SqlParams {
  readonly values: unknown[] = [];

  /** Adds a value and returns its placeholder, e.g. "$3". */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Escapes LIKE wildcards so user text matches literally. */
export const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, '\\$&');

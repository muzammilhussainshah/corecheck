import { Body, Param, type PipeTransform, Query } from '@nestjs/common';
import { z } from 'zod';
import { notFound, validationFailed } from './errors.js';

/** Validates and converts input with a shared zod schema (VAL-001, VAL-002). */
export class ZodValidationPipe<
  TSchema extends z.ZodType,
> implements PipeTransform<unknown, z.output<TSchema>> {
  constructor(private readonly schema: TSchema) {}

  transform(value: unknown): z.output<TSchema> {
    const result = this.schema.safeParse(value ?? {});
    if (!result.success) {
      throw validationFailed(
        result.error.issues.map((issue) => ({
          field: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}

export const ValidBody = (schema: z.ZodType) =>
  Body(new ZodValidationPipe(schema));

export const ValidQuery = (schema: z.ZodType) =>
  Query(new ZodValidationPipe(schema));

const uuidSchema = z.uuid();

/**
 * A route id. Anything that is not a UUID cannot name a record, so it is
 * answered as "not found" rather than as a validation error.
 */
class IdPipe implements PipeTransform<string, string> {
  constructor(private readonly what: string) {}

  transform(value: string): string {
    if (!uuidSchema.safeParse(value).success) throw notFound(this.what);
    return value;
  }
}

export const IdParam = (what: string, name = 'id') =>
  Param(name, new IdPipe(what));

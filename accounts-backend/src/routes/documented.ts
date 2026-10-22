import type { FastifySchema } from 'fastify';

/** A credential a route takes, as the OpenAPI document names it. */
export type SecurityRequirement = Record<string, string[]>;

/** A route's schema, with what the OpenAPI document reads besides validation. */
export type DocumentedSchema = FastifySchema & {
  summary: string;
  description?: string;
  security?: SecurityRequirement[];
};

/**
 * A route's schema, under the `accounts` tag of the OpenAPI document. The
 * documentation fields are typed by `@fastify/swagger`, which the host
 * registers and this package does not depend on.
 * @param schema - the summary, the description and the validation
 * @returns the schema
 */
export function documented(schema: DocumentedSchema): FastifySchema {
  return { tags: ['accounts'], ...schema } as FastifySchema;
}

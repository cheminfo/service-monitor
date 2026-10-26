import type { FastifyReply } from 'fastify';

import { AccountError } from './accounts.ts';
import type { AccountRefusal } from './rules.ts';
import { REFUSAL_MESSAGES } from './rules.ts';
import type { AccountsError } from './types.ts';

/** The statuses the accounts refuse with, by the name Fastify gives them. */
const STATUS_NAMES = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  429: 'Too Many Requests',
} as const;

/** A status the accounts refuse with. */
export type RefusalStatus = keyof typeof STATUS_NAMES;

/**
 * The body of a refusal: Fastify's envelope, the reason in English, and its
 * code for a page to write in its own language.
 * @param statusCode - the HTTP status
 * @param code - why
 * @returns the body
 */
export function refusalBody(
  statusCode: RefusalStatus,
  code: AccountRefusal,
): AccountsError {
  return {
    statusCode,
    error: STATUS_NAMES[statusCode],
    message: REFUSAL_MESSAGES[code],
    code,
  };
}

/**
 * Answer with a refusal, in the shape every route refuses with.
 * @param reply - where it goes
 * @param statusCode - the HTTP status
 * @param code - why
 * @returns the reply, sent
 */
export function refuse(
  reply: FastifyReply,
  statusCode: RefusalStatus,
  code: AccountRefusal,
): FastifyReply {
  return reply.code(statusCode).send(refusalBody(statusCode, code));
}

/**
 * Answer a change the accounts cannot make with its reason, and let any other
 * error reach Fastify's handler.
 * @param reply - where the refusal goes
 * @param error - what the change threw
 * @returns the reply, sent
 * @throws {Error} When the error is not an {@link AccountError}.
 */
export function refuseAccountError(
  reply: FastifyReply,
  error: unknown,
): FastifyReply {
  if (error instanceof AccountError) return refuse(reply, 400, error.code);
  throw error;
}

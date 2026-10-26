import { AccountsRequestError } from './accountsClient.ts';
import type { AccountRefusal } from './rules.ts';

/**
 * Why a request to the accounts' routes did not go through: data, so a page
 * writes it in the language it is read in, at the moment it draws it.
 */
export interface AccountFailure {
  /**
   * The reason, when the server named one of the refusals; undefined for a
   * refusal it did not name (a body that does not validate, a server error)
   * and for a server that was not reached.
   */
  code: AccountRefusal | undefined;
  /** The HTTP status, 0 when the server could not be reached. */
  status: number;
  /** What the server said, in English: the words shown when there is no code. */
  message: string;
}

/**
 * The failure an error of the accounts' client stands for.
 * @param error - what a request threw
 * @returns the failure
 */
export function failureOf(error: unknown): AccountFailure {
  if (error instanceof AccountsRequestError) {
    return { code: error.code, status: error.status, message: error.message };
  }
  return {
    code: undefined,
    status: 0,
    message: error instanceof Error ? error.message : 'the request failed',
  };
}

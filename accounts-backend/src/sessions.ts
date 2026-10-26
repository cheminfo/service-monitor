import { fromHex, toHex } from './hex.ts';
import type { AccountRow } from './store/AccountStore.ts';

/**
 * How long a session lasts once signed in, in seconds: 400 days, the longest
 * a browser keeps a cookie (Chrome caps it there, as RFC 6265bis asks). With
 * the renewal on `GET /session`, somebody who keeps coming back is never
 * asked to sign in again.
 */
export const SESSION_SECONDS = 400 * 24 * 60 * 60;

/** How old a session is before `GET /session` hands out a fresh one: a day. */
export const RENEW_AFTER_SECONDS = 24 * 60 * 60;

/** A session as its cookie carries it: the account, the expiry, the HMAC. */
const SESSION_VALUE =
  /^(?<accountId>\d{1,12})\.(?<expiresAt>\d{1,12})\.(?<signature>[\da-f]{64})$/;

/** What sessions are signed with, and what they are for. */
export interface SessionsOptions {
  /**
   * What a session signs besides the account, so nothing else the same key
   * signs can pass for one — the site's name, say.
   */
  purpose: string;
  /**
   * The key sessions are signed with.
   * @default undefined — a random key drawn at start, so a restart ends every session
   */
  secret?: string;
}

/** A session that verified, and when it ends. */
export interface VerifiedSession {
  /** The account it is for, read again from the store. */
  account: AccountRow;
  /** When it ends, in unix seconds. */
  expiresAt: number;
}

/** Opens sessions, and tells a live one from anything else. */
export interface Sessions {
  /**
   * A new session for an account, as its cookie carries it.
   * @param account - the account signed in
   * @param now - when, in milliseconds
   * @returns the cookie's value
   */
  open: (account: AccountRow, now?: number) => Promise<string>;
  /**
   * The live session a cookie carries.
   * @param value - the cookie's value, if any
   * @param findAccount - reads an account by its id
   * @param now - when, in milliseconds
   * @returns the session, or null
   */
  verify: (
    value: string | undefined,
    findAccount: (id: number) => AccountRow | undefined,
    now?: number,
  ) => Promise<VerifiedSession | null>;
}

/**
 * The sessions of the accounts.
 *
 * A session is stateless: an account, an expiry, and an HMAC-SHA256 over
 * both, the site's `purpose` and the account's password hash. The server
 * keeps nothing, so a session outlives a restart only when `secret` is set;
 * changing the password, or removing the account, ends every session it had.
 * A session signed for any shorter time verifies the same way.
 * @param options - what sessions are signed with
 * @returns the sessions
 */
export async function createSessions(
  options: SessionsOptions,
): Promise<Sessions> {
  const { purpose } = options;
  const secret =
    options.secret?.trim() || toHex(crypto.getRandomValues(new Uint8Array(32)));
  const key = await crypto.subtle.importKey(
    'raw',
    encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );

  return {
    async open(account, now = Date.now()) {
      const expiresAt = Math.floor(now / 1000) + SESSION_SECONDS;
      const signature = await crypto.subtle.sign(
        'HMAC',
        key,
        signed(purpose, account, expiresAt),
      );
      return `${account.id}.${expiresAt}.${toHex(new Uint8Array(signature))}`;
    },
    async verify(value, findAccount, now = Date.now()) {
      const groups = SESSION_VALUE.exec(value ?? '')?.groups;
      if (
        groups?.accountId === undefined ||
        groups.expiresAt === undefined ||
        groups.signature === undefined
      ) {
        return null;
      }
      const expiresAt = Number(groups.expiresAt);
      const remaining = expiresAt * 1000 - now;
      if (remaining <= 0 || remaining > SESSION_SECONDS * 1000) return null;
      const account = findAccount(Number(groups.accountId));
      if (account === undefined) return null;
      // `verify` compares in constant time, which a string comparison of two
      // signatures would not.
      const valid = await crypto.subtle.verify(
        'HMAC',
        key,
        fromHex(groups.signature),
        signed(purpose, account, expiresAt),
      );
      return valid ? { account, expiresAt } : null;
    },
  };
}

/**
 * Whether a session is old enough to be handed out again: signed in more than
 * {@link RENEW_AFTER_SECONDS} ago.
 * @param session - the session
 * @param now - when, in milliseconds
 * @returns true once it is
 */
export function shouldRenew(
  session: VerifiedSession,
  now: number = Date.now(),
): boolean {
  const remaining = session.expiresAt - Math.floor(now / 1000);
  return remaining < SESSION_SECONDS - RENEW_AFTER_SECONDS;
}

/**
 * What a session's HMAC covers.
 * @param purpose - what the sessions are for
 * @param account - the account
 * @param expiresAt - when the session ends, in unix seconds
 * @returns the bytes signed
 */
function signed(
  purpose: string,
  account: AccountRow,
  expiresAt: number,
): Uint8Array<ArrayBuffer> {
  return encode(
    `${purpose}\n${account.id}\n${expiresAt}\n${account.passwordHash}`,
  );
}

/**
 * A text as the bytes Web Crypto reads.
 * @param text - the text
 * @returns its UTF-8 bytes
 */
function encode(text: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(text);
}

import type { AccountsClient } from './accountsClient.ts';
import { AccountsRequestError, sentenceOf } from './accountsClient.ts';
import type { AccountSession } from './types.ts';

/** What an action the server may refuse comes back with. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

/** Where this browser stands, as the pages read it. */
export interface AccountSessionState {
  /** What the server said, or null until it has. */
  session: AccountSession | null;
  /** Why signing in is asked again, once a session ended; else null. */
  notice: string | null;
}

/** Where a browser stands that is not signed in. */
const SIGNED_OUT: AccountSession = { signedIn: false, username: null };

/**
 * Where this browser stands, shared by every page of the site: the gate, the
 * account menu of the bar, the About's invitation and the Accounts page read
 * the same state, and a refusal anywhere signs them all out at once.
 * @param client - the routes it reads and writes through
 * @returns the store
 */
export function createAccountSession(client: AccountsClient) {
  let state: AccountSessionState = { session: null, notice: null };
  const listeners = new Set<() => void>();

  function set(next: AccountSessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  /** Ask the server where this browser stands. */
  async function load(): Promise<void> {
    try {
      set({ ...state, session: await client.session() });
    } catch {
      set({ ...state, session: SIGNED_OUT });
    }
  }

  /**
   * Go back to signed out when the server says the session has ended.
   * @param error - what a request threw
   * @returns whether it was that
   */
  function endIfRefused(error: unknown): boolean {
    if (!(error instanceof AccountsRequestError) || error.status !== 401) {
      return false;
    }
    set({ session: SIGNED_OUT, notice: sentenceOf(error) });
    return true;
  }

  return {
    client,
    /**
     * The state now.
     * @returns it
     */
    get: (): AccountSessionState => state,
    /**
     * Be told whenever the state changes.
     * @param listener - called after each change
     * @returns what stops it
     */
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Ask the server where this browser stands. */
    load,
    /**
     * Sign in.
     * @param username - as typed
     * @param password - as typed
     * @returns the session, or why the server refused it
     */
    signIn: async (
      username: string,
      password: string,
    ): Promise<Outcome<AccountSession>> => {
      try {
        const session = await client.signIn(username, password);
        set({ session, notice: null });
        return { ok: true, value: session };
      } catch (error: unknown) {
        return { ok: false, error: sentenceOf(error) };
      }
    },
    /** Sign this browser out. */
    signOut: async (): Promise<void> => {
      try {
        set({ session: await client.signOut(), notice: null });
      } catch {
        // Whether the cookie went or not, the server says where things stand.
        set({ ...state, notice: null });
        await load();
      }
    },
    /**
     * Take a new session, as changing one's own password answers.
     * @param session - the session
     */
    renew: (session: AccountSession): void => {
      set({ session, notice: null });
    },
    endIfRefused,
    /**
     * Run a change the server may refuse, and say why when it does; a refusal
     * of the session signs this browser out.
     * @param change - the change
     * @returns its result, or the reason it was refused
     */
    attempt: async <T>(change: () => Promise<T>): Promise<Outcome<T>> => {
      try {
        return { ok: true, value: await change() };
      } catch (error: unknown) {
        endIfRefused(error);
        return { ok: false, error: sentenceOf(error) };
      }
    },
    /**
     * A fetch for the host's own operator routes, such as the monitor's
     * panels: the browser sends the cookie, and a 401 signs this browser out.
     * @param input - what to fetch
     * @param init - how
     * @returns the response
     */
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(input, {
        credentials: 'same-origin',
        ...init,
      });
      if (response.status === 401) {
        set({
          session: SIGNED_OUT,
          notice: 'The session has ended: sign in again.',
        });
      }
      return response;
    },
  };
}

/** What {@link createAccountSession} returns. */
export type AccountSessionStore = ReturnType<typeof createAccountSession>;

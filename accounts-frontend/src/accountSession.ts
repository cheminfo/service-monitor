import type { AccountFailure } from './accountFailure.ts';
import { failureOf } from './accountFailure.ts';
import type { AccountsClient } from './accountsClient.ts';
import { REFUSAL_MESSAGES } from './rules.ts';
import type { AccountSession } from './types.ts';

/** What an action the server may refuse comes back with. */
export type Outcome<T> =
  { ok: true; value: T } | { ok: false; failure: AccountFailure };

/** Where this browser stands, as the pages read it. */
export interface AccountSessionState {
  /** What the server said, or null until it has. */
  session: AccountSession | null;
  /** Why signing in is asked again, once a session ended; else null. */
  notice: AccountFailure | null;
}

/** Where a browser stands that is not signed in. */
const SIGNED_OUT: AccountSession = {
  signedIn: false,
  username: null,
  role: null,
};

/** What a 401 from one of the site's own routes stands for. */
const SESSION_ENDED: AccountFailure = {
  code: 'sessionEnded',
  status: 401,
  message: REFUSAL_MESSAGES.sessionEnded,
};

/**
 * Where this browser stands, shared by every page of the site: the gate, the
 * account menu of the bar, the About's invitation and the Accounts page read
 * the same state, and a refusal anywhere signs them all out at once.
 * @param client - the routes it reads and writes through
 * @returns the store
 */
export function createAccountSession(client: AccountsClient) {
  let state: AccountSessionState = { session: null, notice: null };
  let loading: Promise<void> | undefined;
  const listeners = new Set<() => void>();

  function set(next: AccountSessionState): void {
    state = next;
    for (const listener of listeners) listener();
  }

  async function ask(): Promise<void> {
    try {
      set({ ...state, session: await client.session() });
    } catch {
      set({ ...state, session: SIGNED_OUT });
    }
  }

  /**
   * Ask the server where this browser stands; a server that cannot be
   * reached reads as signed out, so a gate shows its form. A call made while
   * the server is being asked shares that question.
   * @returns once it has answered
   */
  function load(): Promise<void> {
    loading ??= ask().finally(() => {
      loading = undefined;
    });
    return loading;
  }

  /**
   * Go back to signed out when the server says the session has ended.
   * @param error - what a request threw
   * @returns whether it was that
   */
  function endIfRefused(error: unknown): boolean {
    const failure = failureOf(error);
    if (failure.status !== 401) return false;
    set({ session: SIGNED_OUT, notice: failure });
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
    load,
    /**
     * Ask the server where this browser stands, unless it has said already:
     * what a gate calls when it is drawn.
     * @returns once it has answered
     */
    ensureLoaded: (): Promise<void> =>
      state.session === null ? load() : Promise.resolve(),
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
        return { ok: false, failure: failureOf(error) };
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
        return { ok: false, failure: failureOf(error) };
      }
    },
    /**
     * A fetch for the host's own guarded routes, such as the monitor's
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
        set({ session: SIGNED_OUT, notice: SESSION_ENDED });
      }
      return response;
    },
  };
}

/** What {@link createAccountSession} returns. */
export type AccountSessionStore = ReturnType<typeof createAccountSession>;

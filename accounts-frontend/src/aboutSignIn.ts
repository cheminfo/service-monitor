import type { AccountSessionState } from './accountSession.ts';

/** Where signing in happens, as react-cheminfo's About takes it. */
export interface SignInEntry {
  /**
   * The address of the sign-in, so a middle click opens a tab.
   * @default undefined
   */
  href?: string;
  /**
   * What picking it does: route to that page.
   * @default undefined
   */
  onSignIn?: () => void;
}

/**
 * The About's invitation to sign in: there while the server has said nobody
 * is signed in, gone once somebody is — the account is then in the bar — and
 * gone while it has not said.
 * @param state - where this browser stands
 * @param entry - where signing in happens
 * @returns the `signIn` of `AboutPage`, or undefined
 */
export function aboutSignIn(
  state: AccountSessionState,
  entry: SignInEntry,
): SignInEntry | undefined {
  return state.session?.signedIn === false ? entry : undefined;
}

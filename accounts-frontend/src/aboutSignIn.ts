import type { AboutSignInProps } from 'react-cheminfo/ui';

import type { AccountSessionState } from './accountSession.ts';

/** Where signing in happens: react-cheminfo's `AboutSignIn` props. */
export type SignInEntry = AboutSignInProps;

/**
 * The About's invitation to sign in: there while the server has said nobody
 * is signed in, gone once somebody is — the account is then in the bar — and
 * gone while it has not said.
 *
 * A site with a page for signing in passes its address; one without passes
 * `onSignIn`, opening a `SignInDialog`.
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

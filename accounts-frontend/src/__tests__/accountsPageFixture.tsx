import { AccountsPage } from '../AccountsPage.tsx';
import { createAccountSession } from '../accountSession.ts';
import { createAccountsClient } from '../accountsClient.ts';

import { mount } from './dom.ts';
import { API, fakeServer } from './fakeServer.ts';

/**
 * The accounts page, signed in on a fake server.
 * @param options - Who is signed in, and whether luc is the .env's.
 * @param options.signedIn - The account signed in, or null for nobody.
 * @param options.envAdmin - Whether luc is the .env's administrator.
 * @returns The page, the server and the session.
 */
export async function page(
  options: { signedIn?: string | null; envAdmin?: boolean } = {},
) {
  const { signedIn = 'luc', envAdmin } = options;
  const server = fakeServer({ signedIn: signedIn ?? undefined, envAdmin });
  const store = createAccountSession(createAccountsClient(API, server.fetcher));
  await store.load();
  const host = await mount(<AccountsPage store={store} />);
  return { host, server, store };
}

/**
 * The cells of each row of the accounts table.
 * @param host - The page.
 * @returns Their text, row by row.
 */
export function rows(host: HTMLElement): string[][] {
  return [
    ...host.querySelectorAll('[data-testid="accounts-table"] tbody tr'),
  ].map((row) =>
    [...row.querySelectorAll('td')].map((cell) =>
      cell.querySelector('select') === null
        ? (cell.textContent ?? '')
        : `[${cell.querySelector('select')?.value}]`,
    ),
  );
}

/**
 * The methods and routes the server was asked, in order.
 * @param server - The fake server.
 * @returns `METHOD url`, one per request.
 */
export function routes(server: ReturnType<typeof fakeServer>): string[] {
  return server.asked.map((each) => `${each.method} ${each.url}`);
}

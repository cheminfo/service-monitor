# service-accounts-frontend

The pages of a service's accounts: the sign-in form, a gate in front of every
operator's page, the Accounts page, and the account menu of the bar, read from
the routes of
[`service-accounts-backend`](https://www.npmjs.com/package/service-accounts-backend).
Built on Blueprint and react-cheminfo, which the host provides with React.

```sh
npm install service-accounts-frontend
```

```tsx
import 'service-accounts-frontend/styles.css';
import {
  AccountMenu,
  AccountsPage,
  SignInGate,
  aboutSignIn,
  createAccountSession,
  createAccountsClient,
  useAccountSession,
} from 'service-accounts-frontend';

// Once, for the whole site: every page reads the same session.
export const accounts = createAccountSession(createAccountsClient('/v1/admin'));

// An operator's page: the form until signed in, the page once.
<SignInGate store={accounts} note="The imports, the statistics and the logs.">
  <StatusPage />
</SignInGate>;

// The account's initials at the right of the bar, once signed in.
<SiteHeader
  account={
    <AccountMenu
      store={accounts}
      items={[{ id: 'accounts', label: 'Accounts', href: '/accounts' }]}
    />
  }
/>;

// The About's invitation, while nobody is signed in.
const state = useAccountSession(accounts);
<AboutPage content={ABOUT} signIn={aboutSignIn(state, { href: '/status' })} />;

// The Accounts page, behind the gate.
<SignInGate store={accounts}>
  <AccountsPage store={accounts} />
</SignInGate>;

// The host's own operator routes, such as the monitor's panels: the cookie
// goes with them, and a 401 signs every page out at once.
<ServiceMonitor apiBasePath="/v1/admin/monitor" fetcher={accounts.fetch} />;
```

The session is a cookie no script can read: nothing is kept in the browser.
A request any page sends that the server refuses with 401 signs the whole site
out, and the form says why. The pages are styled with the tokens of
react-cheminfo's `chrome.css`.

More in the [repository's README](https://github.com/cheminfo/service-monitor).

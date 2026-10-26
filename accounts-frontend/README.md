# service-accounts-frontend

The pages of a service's accounts: the sign-in form and dialog, a gate in front
of every page an account needs, the Accounts page of the administrators, and
the account menu of the bar, read from the routes of
[`service-accounts-backend`](https://www.npmjs.com/package/service-accounts-backend).
Built on Blueprint and react-cheminfo, which the host provides with React:
every word is react-cheminfo's chrome, in the five languages of the family.

```sh
npm install service-accounts-frontend
```

```tsx
import 'service-accounts-frontend/styles.css';
import {
  AccountMenu,
  AccountsPage,
  SignInDialog,
  SignInGate,
  aboutSignIn,
  createAccountSession,
  createAccountsClient,
  useAccountSession,
} from 'service-accounts-frontend';

// Once, for the whole site: every page reads the same session.
export const accounts = createAccountSession(
  createAccountsClient('/v1/account'),
);
void accounts.load();

// The account's initials at the right of the bar, once signed in: its name,
// its role, its pages, the administrators' pages, and Sign out.
<SiteHeader
  account={
    <AccountMenu
      store={accounts}
      adminItems={[{ id: 'users', label: 'Users', href: '/users' }]}
    />
  }
/>;

// The About's invitation, while nobody is signed in. With a page for it, its
// `href`; without, a dialog.
const state = useAccountSession(accounts);
const [signingIn, setSigningIn] = useState(false);
<AboutPage
  content={ABOUT}
  signIn={aboutSignIn(state, { onSignIn: () => setSigningIn(true) })}
/>;
<SignInDialog
  store={accounts}
  isOpen={signingIn}
  onClose={() => setSigningIn(false)}
/>;

// A page for one role: the form until signed in, a refusal below the role.
<SignInGate store={accounts} role="write" note="Adding and correcting samples.">
  <SamplesEditor />
</SignInGate>;

// The administrators' page.
<SignInGate store={accounts} role="admin">
  <AccountsPage store={accounts} />
</SignInGate>;

// The host's own guarded routes, such as the monitor's panels: the cookie
// goes with them, and a 401 signs every page out at once.
<ServiceMonitor apiBasePath="/v1/admin/monitor" fetcher={accounts.fetch} />;
```

- **`<SignInGate store role? title? note?>`** draws its page once the account
  signed in has `role` (`read` when left out), the sign-in form until somebody
  is, a refusal with "Sign in as somebody else" below the role, and a spinner
  while the server has not said.
- **`<SignInDialog store isOpen onClose note?>`** signs in without leaving the
  page, and closes itself once signed in.
- **`<SignInForm store title? note? onSignedIn?>`** is the form the gate draws.
- **`<AccountMenu store items? adminItems? onSignedOut?>`** is nothing until
  somebody is signed in, then react-cheminfo's `AccountButton`: `items` for
  every account, `adminItems` after them for an administrator.
- **`<AccountsPage store>`** lists the accounts with their role, a select to
  change it, Set password and Remove; adds an account with its role; and
  changes your own password. Your own row, and the one the server's `.env`
  defines (tagged `defined in .env`), are read only.
- **`<ChangePasswordForm store onChanged?>`** and
  **`<AddAccountForm store onChanged?>`** are its two forms, for a page of the
  host's own.

The session is a cookie no script can read: nothing is kept in the browser.
A request any page sends that the server refuses with 401 signs the whole site
out, and the form says why. A refusal is kept as a code, `AccountFailure`, and
written in the language of the page when it is drawn: `useAccountFailureText`.

Every word comes from react-cheminfo's chrome catalog (`account.*`), so the
peer is react-cheminfo 0.70.0 or later. The pages are styled with the tokens of
react-cheminfo's `chrome.css`, which the host imports.

More in the [repository's README](https://github.com/cheminfo/service-monitor).

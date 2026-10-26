import { Button, Dialog, DialogBody, DialogFooter } from '@blueprintjs/core';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

import { SignInFields } from './SignInFields.tsx';
import type { AccountSessionStore } from './accountSession.ts';
import { useSignIn } from './useSignIn.ts';

/** What the sign-in dialog needs. */
export interface SignInDialogProps {
  /** The site's session. */
  store: AccountSessionStore;
  /** Whether it is open. */
  isOpen: boolean;
  /** Closes it: once signed in, or when the visitor backs out. */
  onClose: () => void;
  /**
   * One line above the fields: what signing in gives access to.
   * @default undefined
   */
  note?: ReactNode;
}

/**
 * Sign in without leaving the page: what the About's invitation opens on a
 * site that has no page of its own for signing in. It closes itself once
 * signed in, and the account is then in the bar.
 *
 * ```tsx
 * const [signingIn, setSigningIn] = useState(false);
 * <AboutPage content={ABOUT} signIn={aboutSignIn(state, { onSignIn: () => setSigningIn(true) })} />
 * <SignInDialog store={accounts} isOpen={signingIn} onClose={() => setSigningIn(false)} />
 * ```
 * @param props - The session, and whether the dialog is open.
 * @returns The dialog.
 */
export function SignInDialog(props: SignInDialogProps) {
  const { store, isOpen, onClose, note } = props;
  const t = useChromeT();
  // A closing dialog keeps its content through the exit transition, and one
  // opened again meanwhile would reuse it: each opening is a form of its own,
  // so the fields start empty every time.
  const [openings, setOpenings] = useState({ open: isOpen, count: 0 });
  if (openings.open !== isOpen) {
    setOpenings({
      open: isOpen,
      count: isOpen ? openings.count + 1 : openings.count,
    });
  }

  return (
    <Dialog
      isOpen={isOpen}
      title={t('account.signIn')}
      icon="log-in"
      onClose={onClose}
    >
      <SignInDialogForm
        key={openings.count}
        store={store}
        onClose={onClose}
        note={note}
      />
    </Dialog>
  );
}

/**
 * The fields of the dialog and its two buttons.
 * @param props - The session, what closes the dialog, and its note.
 * @returns The form.
 */
function SignInDialogForm(props: Omit<SignInDialogProps, 'isOpen'>) {
  const { store, onClose, note } = props;
  const t = useChromeT();
  const state = useSignIn(store, onClose);

  return (
    <form data-testid="sign-in-dialog" onSubmit={state.submit}>
      <DialogBody className="accounts-form">
        {note === undefined ? null : <p className="accounts-note">{note}</p>}
        <SignInFields state={state} autoFocus />
      </DialogBody>
      <DialogFooter
        actions={
          <>
            <Button
              type="button"
              text={t('confirm.cancel')}
              onClick={onClose}
            />
            <Button
              type="submit"
              intent="primary"
              text={t('account.signIn')}
              loading={state.pending}
              disabled={!state.ready}
            />
          </>
        }
      />
    </form>
  );
}

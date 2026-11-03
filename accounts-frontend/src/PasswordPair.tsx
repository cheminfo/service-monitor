import { FormGroup, InputGroup } from '@blueprintjs/core';
import { useId } from 'react';
import { useChromeT } from 'react-cheminfo/ui';

/**
 * A new password, typed twice.
 * @param props - The two values, and what typing does.
 * @param props.next - The new password.
 * @param props.repeat - The same, typed again.
 * @param props.onNext - Called with the new password.
 * @param props.onRepeat - Called with the repetition.
 * @returns The two fields.
 */
export function PasswordPair(props: {
  next: string;
  repeat: string;
  onNext: (value: string) => void;
  onRepeat: (value: string) => void;
}) {
  const { next, repeat, onNext, onRepeat } = props;
  const t = useChromeT();
  const id = useId();

  return (
    <>
      <FormGroup label={t('account.newPassword')} labelFor={`${id}-next`}>
        <InputGroup
          id={`${id}-next`}
          type="password"
          autoComplete="new-password"
          value={next}
          onValueChange={onNext}
        />
      </FormGroup>
      <FormGroup label={t('account.repeatPassword')} labelFor={`${id}-repeat`}>
        <InputGroup
          id={`${id}-repeat`}
          type="password"
          autoComplete="new-password"
          value={repeat}
          onValueChange={onRepeat}
        />
      </FormGroup>
    </>
  );
}

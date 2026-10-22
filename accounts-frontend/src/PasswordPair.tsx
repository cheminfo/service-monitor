import { FormGroup, InputGroup } from '@blueprintjs/core';

/**
 * A new password, typed twice.
 * @param props - The two values, and what typing does.
 * @param props.id - The id of the first field; the second adds `-repeat`.
 * @param props.next - The new password.
 * @param props.repeat - The same, typed again.
 * @param props.onNext - Called with the new password.
 * @param props.onRepeat - Called with the repetition.
 * @returns The two fields.
 */
export function PasswordPair(props: {
  id: string;
  next: string;
  repeat: string;
  onNext: (value: string) => void;
  onRepeat: (value: string) => void;
}) {
  const { id, next, repeat, onNext, onRepeat } = props;
  return (
    <>
      <FormGroup label="New password" labelFor={id}>
        <InputGroup
          id={id}
          type="password"
          autoComplete="new-password"
          value={next}
          onValueChange={onNext}
        />
      </FormGroup>
      <FormGroup label="New password, again" labelFor={`${id}-repeat`}>
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

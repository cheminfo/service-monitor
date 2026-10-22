/**
 * Why a new password and its repetition cannot be used.
 * @param next - the new password
 * @param repeat - the same, typed again
 * @returns the reason, or null when the two agree
 */
export function pairProblem(next: string, repeat: string): string | null {
  return next === repeat ? null : 'The two new passwords differ.';
}

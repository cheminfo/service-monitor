/**
 * Whether two secrets are the same, in a time that does not tell how much of
 * them matched: both are hashed, then every byte of the hashes is compared.
 * @param expected - the secret held
 * @param given - the secret a request brings
 * @returns whether they are equal
 */
export async function sameSecret(
  expected: string,
  given: string,
): Promise<boolean> {
  const [left, right] = await Promise.all([digest(expected), digest(given)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * The SHA-256 of a text.
 * @param text - the text
 * @returns its 32 bytes
 */
async function digest(text: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
}

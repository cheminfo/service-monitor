/**
 * Rounds of PBKDF2: what OWASP asks of PBKDF2-HMAC-SHA-512, and still well
 * under a tenth of a second per sign-in.
 */
const ITERATIONS = 210_000;
const SALT_BYTES = 16;
const KEY_BITS = 512;
const PREFIX = 'pbkdf2$sha512';

/**
 * Hash a password with PBKDF2-HMAC-SHA-512, through Web Crypto. The format is
 * learn.cheminfo.org's and molecules.cheminfo.org's, so a hash moves between
 * the sites unchanged.
 * @param password - the password, in clear
 * @returns `pbkdf2$sha512$<iterations>$<salt>$<hash>`, salt and hash in base64
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `${PREFIX}$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/**
 * Whether a password is the one a hash was made from, compared in constant
 * time. A hash that cannot be read answers false rather than throwing, so an
 * account whose hash was damaged cannot sign in.
 * @param password - the password, in clear
 * @param stored - the hash, as {@link hashPassword} writes it
 * @returns true when they match
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5) return false;
  const [algorithm, digest, rawIterations, rawSalt, rawHash] = parts;
  if (`${algorithm}$${digest}` !== PREFIX) return false;
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;
  const salt = fromBase64(rawSalt ?? '');
  const expected = fromBase64(rawHash ?? '');
  if (salt.length === 0 || expected.length === 0) return false;
  const actual = await derive(password, salt, iterations);
  return sameBytes(actual, expected);
}

/**
 * Derive the key a password and a salt make.
 * @param password - the password, in clear
 * @param salt - the salt
 * @param iterations - how many rounds
 * @returns the derived bytes
 */
async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-512', salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/**
 * Whether two byte strings are equal, without saying where they first differ.
 * @param left - one string
 * @param right - the other
 * @returns true when they are equal
 */
function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

/**
 * Bytes as base64.
 * @param bytes - the bytes
 * @returns their base64
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCodePoint(byte);
  return btoa(binary);
}

/**
 * Base64 as bytes.
 * @param text - the base64
 * @returns the bytes, none when the text is not base64
 */
function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    return new Uint8Array(0);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.codePointAt(index) ?? 0;
  }
  return bytes;
}

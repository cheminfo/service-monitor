const HEX = /^(?:[\da-f]{2})*$/i;

/**
 * Write bytes as lowercase hexadecimal.
 * @param bytes - the bytes
 * @returns two characters per byte
 */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Read hexadecimal back into the bytes it writes.
 * @param hex - two hexadecimal digits per byte, in either case
 * @returns the bytes
 * @throws {Error} When the text is not an even run of hexadecimal digits.
 */
export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!HEX.test(hex)) throw new Error('that is not hexadecimal');
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(hex.slice(2 * index, 2 * index + 2), 16);
  }
  return bytes;
}

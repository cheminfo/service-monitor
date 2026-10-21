/**
 * A share, kept between 0 and 1.
 * @param part - the part
 * @param whole - the whole
 * @returns the share, 0 when the whole is not positive
 */
export function shareOf(part: number, whole: number): number {
  if (!(whole > 0)) return 0;
  return Math.min(1, Math.max(0, part / whole));
}

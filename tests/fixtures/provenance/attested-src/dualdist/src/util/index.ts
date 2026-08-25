/* The attested SOURCE of the 'dualdist/util' subpath. The published
 * "import" target for this subpath is ./dist/esm/util/index.js — two
 * segments of build output in front of the source twin, not one. */
export interface Logger {
  warn(message: string): void;
}

export const TAG = "util-tag";

export function shout(s: string): string {
  return s.toUpperCase() + "!";
}

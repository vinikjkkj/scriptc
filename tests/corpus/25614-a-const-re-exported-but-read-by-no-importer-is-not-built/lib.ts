const SRC: Record<string, number> = { a: 1, b: 2, c: 3 };
function build(): Record<string, { code: number }> {
  const out: Record<string, { code: number }> = {};
  for (const [k, v] of Object.entries(SRC)) out[k] = { code: v };
  return out;
}
export const VIEW = build();
export const VERSION = "1";

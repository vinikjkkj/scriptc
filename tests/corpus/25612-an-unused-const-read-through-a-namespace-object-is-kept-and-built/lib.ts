const SRC: Record<string, number> = { a: 1, b: 2 };
function build(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(SRC)) out[k] = v * 100;
  return out;
}
export const TABLE = build();
export const OTHER = 5;

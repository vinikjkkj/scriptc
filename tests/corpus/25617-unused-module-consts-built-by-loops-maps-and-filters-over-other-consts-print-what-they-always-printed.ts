// Several unused tables built by loops, map/filter/reduce and object builders over other module consts; only the printed ones matter.
const NAMES: string[] = ["alpha", "beta", "gamma", "delta"];
const BY_NAME: Record<string, number> = { alpha: 1, beta: 2, gamma: 3, delta: 4 };
export const UNUSED_LEN = NAMES.map((n) => n.length);
export const UNUSED_SUM = NAMES.reduce((acc, n) => acc + (BY_NAME[n] ?? 0), 0);
export const UNUSED_PAIRS = Object.entries(BY_NAME).filter(([, v]) => v % 2 === 0);
export const UNUSED_INDEX: Record<string, string> = Object.fromEntries(NAMES.map((n, i) => [n, `#${i}`]));
export const PRINTED_SUM = NAMES.reduce((acc, n) => acc + (BY_NAME[n] ?? 0), 0);
export const PRINTED_KEYS = Object.keys(BY_NAME).join("+");
console.log(PRINTED_SUM, PRINTED_KEYS, NAMES.length);

export function libFn(n: number): number { return n + 1; }
export const libArrow = (n: number): number => n * 5;
export const libNamed = function inner(n: number): number { return n - 1; };

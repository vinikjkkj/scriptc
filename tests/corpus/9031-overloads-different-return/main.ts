import type { D } from "./dd/diff";
export function run(d: D): void { const s: string = d.get("a"); console.log(s); const n: number = d.get("a", 3); console.log(n + 1); }
const o: D = { get: (k: string, n?: number): any => (n === undefined ? k : n) } as any;
run(o);

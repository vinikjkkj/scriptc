import type { G } from "./dd/valuegap";
export function run(g: G): void { const f = g.get; const n: number = f("a", 3); console.log(n + 1); }
const o: G = { get: (k: string, n?: number): any => (n === undefined ? k : n) } as any;
run(o);

import type { V } from "./dd/valued";
export function run(v: V): void { const f = v.get; console.log(f("q")); }
const o: V = { get: (k: string, n?: number): any => (n === undefined ? k : n) } as any;
run(o);

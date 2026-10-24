import type { O } from "./dd/optional";
export function run(o: O): void { console.log(o.f(2)); console.log(o.f(2, 5)); }
const v: O = { f: (a: number, b?: number): number => a + (b ?? 100) } as any;
run(v);

import type { S } from "./dd/same";
export function run(s: S): void { s.m("a"); s.m("a", "b"); }
const o: S = { m: (a: string, b?: string): void => { console.log(a, b); } };
run(o);

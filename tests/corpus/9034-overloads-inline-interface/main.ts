interface L { m(a: string): string; m(a: string, b: number): number; }
export function run(l: L): void { const r: string = l.m("a"); console.log(r); const q: number = l.m("a", 2); console.log(q * 10); }
const o: L = { m: (a: string, b?: number): any => (b === undefined ? a + "!" : b) } as any;
run(o);

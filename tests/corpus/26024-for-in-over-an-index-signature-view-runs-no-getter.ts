// for-in lists keys without reading any value; a getter that deletes a later key shows only at the visit of that key.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
const o: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; delete this.b; return 1 }, b: 2, c: 3 }");
const r = o as Record<string, number>;
const ks: string[] = [];
for (const k in r) ks.push(k);
console.log(ks.join(","), cnt());

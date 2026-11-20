// Object.keys lists the keys BEFORE any getter runs; the getter's delete shows from the next read on.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
const o: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; delete this.b; return 1 }, b: 2, c: 3 }");
const r = o as Record<string, number>;
console.log(Object.keys(r).join(","), cnt());
console.log(r.b, cnt());
console.log(r.a, cnt());
console.log(r.b, Object.keys(r).join(","), cnt());

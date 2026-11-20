// `o as Record<string, number>` is erased in Node: nothing is read at the cast, a getter runs at each READ of its member.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
const o: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; return 1 }, b: 2 }");
const r = o as Record<string, number>;
console.log("cast", cnt());
console.log(Object.keys(r).join(","), cnt());
console.log(r.b, cnt());
console.log(r.a, cnt());
console.log(r.a, cnt());
console.log(Object.values(r).join(","), cnt());

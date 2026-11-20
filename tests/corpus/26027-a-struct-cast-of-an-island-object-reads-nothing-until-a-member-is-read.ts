// `o as S` is erased in Node: the cast reads nothing and a getter runs at each READ of its member.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
interface S { a: number; b: number }
const o: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; return 1 }, b: 2 }");
const s = o as S;
console.log("cast", cnt());
console.log(s.b, cnt());
console.log(s.a, cnt());
console.log(s.a, cnt());

// A shape with declared members AND an index signature: nothing is read at the cast, a getter that deletes a later key shows from the next read on,
// keys are listed before any getter runs, and writes and deletes through the cast reach the object.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
interface H { a: number; b?: number; [k: string]: number | undefined }
const o: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; delete this.q; return 1 }, b: 2, q: 3, z: 4 }");
const h = o as H;
console.log("cast", cnt());
console.log(Object.keys(h).join(","), cnt());
console.log(h.q, cnt());
console.log(h.a, cnt());
console.log(h.q, h.z, Object.keys(h).join(","), cnt());
h.z = 40; h.w = 5; console.log(o.z, o.w, Object.keys(o).join(","));
delete h.b; console.log(o.b, h.b, Object.keys(o).join(","));
o.a2 = 7; console.log(h.a2);

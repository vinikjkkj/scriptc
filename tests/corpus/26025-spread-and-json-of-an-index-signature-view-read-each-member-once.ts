// Spread and JSON.stringify read every member exactly once, at the spread / the stringify.
const mkf: any = (s: string) => (new Function(s))();
const cnt = (): number => mkf("return globalThis.n") as number;
const o2: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; return 1 }, b: 2 }");
const cp = { ...(o2 as Record<string, number>) };
console.log(Object.keys(cp).join(","), cp.a, cnt());
const o3: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; return 1 }, b: 2 }");
console.log(JSON.stringify(o3 as Record<string, number>), cnt());
const o4: any = mkf("globalThis.n = 0; return { get a() { globalThis.n++; return 1 }, b: 2 }");
console.log(Object.entries(o4 as Record<string, number>).map(([k, v]) => k + "=" + v).join(","), cnt());

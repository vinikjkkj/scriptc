// The members the narrow type does not name may hold ANY type; Node's arrays hold them as they are.
interface Wide { id: string; count?: number; flag?: boolean; nested?: { a: number }; list?: string[]; none?: null }
interface Narrow { readonly id: string }
function narrow(w: Wide): Narrow { const n: Narrow = w; return n; }
function send(payload: unknown): string { return JSON.stringify(payload); }
const w1: Wide = { id: "a", count: 3, flag: true, nested: { a: 7 }, list: ["x", "y"], none: null };
const w2: Wide = { id: "b", count: undefined, flag: false };
for (const w of [w1, w2]) {
  const r = narrow(w);
  console.log(send(r));
  console.log(JSON.stringify(Object.values(r)));
  console.log(JSON.stringify(Object.entries(r)));
  console.log(Object.keys(r).length);
}

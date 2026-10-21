interface Box { id: number; data: Map<string, number> | Map<string, string>; }
function use(b: Box): string {
  return b.id + ":" + b.data.size + ":" + b.data.has("k");
}
console.log(use({ id: 1, data: new Map<string, number>([["k", 1]]) }));
console.log(use({ id: 2, data: new Map<string, string>() }));
type M = Map<string, number> | Map<string, string>;
const holder = { m: new Map<string, number>([["k", 1]]) as M, n: 1 };
console.log(holder.m.size + holder.n);

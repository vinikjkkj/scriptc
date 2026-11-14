// a dyn object checked into an index-signature record: the LLVM backend walks the dyn entries inline (backend/llvm/dyn.ts entryAt)
interface Row { id: number; name: string; [extra: string]: number | string }
function pick(j: string): Row {
  const d: any = JSON.parse(j);
  return d as Row;
}
const r1 = pick('{"id":1,"name":"a","x":2,"y":"z","w":4}');
console.log(r1.id, r1.name, r1.x, r1.y, r1.w, Object.keys(r1).join(","));
const big: any = { id: 7, name: "big" };
for (let i = 0; i < 30; i++) big["k" + i] = i % 2 === 0 ? i : "s" + i;
const r2 = big as Row;
console.log(r2.id, r2.k0, r2.k29, Object.keys(r2).length);

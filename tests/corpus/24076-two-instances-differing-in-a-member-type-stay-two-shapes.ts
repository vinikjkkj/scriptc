// Two instantiations of one generic that differ only in a member's type stay two shapes, even though each is mutually assignable
// with the other ({ hex: string } against any).
type Same<T> = { [K in keyof T]: T[K] };
interface P<T, U> { _id: T; label: string; kids: P<T, Same<U>>[]; other?: P<any, U> }
function build(depth: number): P<{ hex: string }, { z: number }> {
  const kids: P<{ hex: string }, { z: number }>[] = [];
  if (depth > 0) kids.push(build(depth - 1));
  return { _id: { hex: "h" + depth }, label: "L" + depth, kids, other: depth > 1 ? { _id: depth * 10, label: "O" + depth, kids: [] } : undefined };
}
const p = build(4);
console.log(p._id.hex, p.kids[0]!._id.hex, p.kids[0]!.kids[0]!.kids[0]!._id.hex);
const o = p.other!;
console.log(typeof o._id, o._id, o.label);
p.kids[0]!._id = { hex: "written" };
o._id = "now a string";
console.log(p.kids[0]!._id.hex, o._id, typeof o._id);

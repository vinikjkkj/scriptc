// A generic whose member names itself with a deeper argument: each level is a new type to the checker, one shape to the program.
type Same<T> = { [K in keyof T]: T[K] };
interface Tree<T> { label: string; n: number; kids: Tree<Same<T>>[] }
function mk(label: string, depth: number): Tree<{ a: number }> {
  const kids: Tree<{ a: number }>[] = [];
  if (depth > 0) for (let i = 0; i < 2; i++) kids.push(mk(label + i, depth - 1));
  return { label, n: depth, kids };
}
function sum(t: Tree<{ a: number }>): number {
  let s = t.n;
  for (const k of t.kids) s += sum(k);
  return s;
}
const t = mk("r", 3);
console.log(sum(t), t.kids.length, t.kids[0]!.kids[1]!.label);
t.kids[0]!.kids[0]!.kids[1]!.n = 100;
t.kids[1]!.label = "changed";
console.log(sum(t), t.kids[0]!.kids[0]!.kids[1]!.n, t.kids[1]!.label);
const deep = t.kids[0]!.kids[0]!.kids[0]!;
deep.kids.push({ label: "extra", n: 7, kids: [] });
console.log(deep.kids.length, deep.kids[0]!.label, sum(t), JSON.stringify(t).length);
const moved: Tree<{ a: number }> = deep.kids[0]!;
moved.kids.push(deep);
console.log(moved.kids.length, moved.kids[0]!.label, t.kids[0]!.kids[0]!.kids[0]!.kids[0]!.kids[0]!.label);

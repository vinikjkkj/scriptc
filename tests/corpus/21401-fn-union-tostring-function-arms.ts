// `string | Function` holding each kind of function value: the exact source
// text Node prints, through .toString() and String().
function decl(a: number, b: number): number {
  return a + b;
}
const arrow = (a: number): number => a * 2;
const obj = {
  m(a: number): number {
    return a + 3;
  },
};
const bound = decl.bind(null);

function show(v: string | Function): string {
  return v.toString();
}
console.log(show(decl));
console.log(show(arrow));
console.log(show(obj.m));
console.log(show(bound));
console.log(show("text arm"));

let slot: string | Function = arrow;
console.log(slot.toString());
console.log(String(slot));
slot = decl;
console.log(`${slot}`);

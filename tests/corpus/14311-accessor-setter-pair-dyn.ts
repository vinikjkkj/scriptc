// A getter/setter pair written before the crossing: the crossed value reads the stored result.
// a setter-only plus a getter/setter pair, reading the dyn value
let store = 0;
function make() {
  return {
    get val(): number { return store; },
    set val(x: number) { store = x * 2; },
    tag: "x",
  };
}
const c = make();
c.val = 5;
const u: unknown = c;
console.log(JSON.stringify(u));
console.log(store);

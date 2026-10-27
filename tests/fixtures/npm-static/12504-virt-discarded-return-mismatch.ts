// npm-static: the base end() returns a quit record, the override returns nothing. Each call's value is
// discarded (an expression statement), so the dispatch answers over the differing return types.
import v from "virt12504";
type B = InstanceType<typeof v.Base>;
const p = new v.Pool(1);
console.log(p.close());
const b = new v.Base(2);
console.log(b.close());
let s: B = v.make(0);
for (let i = 0; i < 3; i++) {
  s = v.make(i);
  s.end("x");
  console.log(s.close());
}

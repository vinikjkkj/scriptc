// npm-static: a base method passes differently typed arguments to an overridden method through
// `this`. The receiver is a base-class binding that is REASSIGNED (never provably exact), so the
// runtime class decides at each call.
import v from "virt12502";
type S = InstanceType<typeof v.Store>;
let s: S = v.make(0);
for (let i = 0; i < 3; i++) {
  s = v.make(i);
  console.log(s.run(42), "/", s.fill(), "/", s.put("k"));
}
function use(x: S): string {
  return x.run("u") + " | " + x.fill();
}
console.log(use(new v.Store()));
console.log(use(new v.DiskStore()));

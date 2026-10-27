// npm-static: overrides at three depths; the middle class calls super.end(x) with a typed value while
// the base calls this.end(x) with a different type. The receiver is reassigned, so the runtime class
// decides. Dispatch must reach the most-derived override.
import v from "virt12503";
type B = InstanceType<typeof v.Base>;
let b: B = v.pick(0);
for (let i = 0; i < 3; i++) {
  b = v.pick(i);
  console.log(b.go(1), b.go("s"), b.go({}));
}

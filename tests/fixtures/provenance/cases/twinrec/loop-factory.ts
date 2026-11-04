// A table of factories built in a loop: each closes over the loop body's own bindings and some carry a property.
import { make, makeUnsigned, hasUnsigned, names } from "twinrec/factory";
for (const n of names()) {
  const a = make(n, 3);
  console.log(n, a.type, a.value, a.unsigned, hasUnsigned(n));
  if (hasUnsigned(n)) {
    const u = makeUnsigned(n, 3);
    console.log(" unsigned", u.value, u.unsigned);
  }
}
console.log(make("nil", null).value);

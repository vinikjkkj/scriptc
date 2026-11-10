// Two import() results and a static `import * as` of one module are the same object; the namespace is a first-class value (stored, passed, keyed) and reads live bindings.
import * as self from "./lib1.ts";
const ns: any = await import("./lib1.ts");
const ns2: any = await import("./lib1.ts");
console.log(ns === ns2, (ns as unknown) === (self as unknown));
const hold = [self];
console.log(Object.keys(hold[0]!).join(), typeof self, Object.prototype.toString.call(self));
self.bump();
console.log(self.a, ns.a);

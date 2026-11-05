// A member of a record a package declares (a .d.ts), whose type has no static representation, is a checked-dynamic slot that works
// exactly: read, write, undefined, a nested read and a write through it. A record the program declares itself keeps its refusal.
import type { Opts } from "./24072-a-package-declared-member-without-a-static-type-is-a-checked-dynamic-slot/shape.js";

function raw(v: number): any {
  return JSON.parse('{"v":' + v + ',"tag":"t' + v + '","next":{"v":' + (v + 1) + ',"tag":"u' + v + '","next":{"v":' + (v + 2) + ',"tag":"w' + v + '"}}}');
}
function makeOpts(): Opts { return { name: "n", count: 3, weird: raw(5) }; }
function describe(o: Opts): string {
  const w = o.weird;
  return o.name + ":" + o.count + ":" + (w === undefined ? "none" : w.v + "/" + w.tag);
}

const o = makeOpts();
console.log(describe(o));
console.log(o.weird!.next!.v, o.weird!.next!.next!.tag);
o.weird = raw(40);
console.log(describe(o), o.weird!.next!.tag);
o.weird!.v = 77;
console.log(o.weird!.v, describe(o));
o.weird = undefined;
console.log(describe(o), o.weird === undefined);
const p: Opts = { name: "lit", count: 9 };
console.log(describe(p), p.weird === undefined);
p.weird = raw(1);
console.log(describe(p), p.weird!.next!.next!.v);

// A callback written inside a typed emitter listener's body (v.tags.map((t) => t.length)) is implicitly `any` in the listener's erased twin, because the twin's parameter is `any` and the callback loses the contextual type. That used to fail the twin program's preflight (noImplicitAny) and leave the typed listener on the checked boundary, which throws for a payload outside the declared type where Node carries on.
import { EventEmitter } from "node:events";
interface R { id: number; tags: string[] }
class Box extends EventEmitter { n = 0; }
const b = new Box();
const hold: { v: any } = { v: b };
b.on("x", (v: R) => {
  console.log(typeof v.id, v.tags.map((t) => t.length).join(","));
});
hold.v.emit.apply(hold.v, ["x", { id: 1, tags: ["ab", "c"] }]);
hold.v.emit.apply(hold.v, ["x", { id: "one", tags: ["xyz"] }]);

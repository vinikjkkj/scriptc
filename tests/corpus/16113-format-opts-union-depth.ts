// Union-typed arguments dispatch per arm at the options depth.
import { formatWithOptions } from "node:util";

type Shape = { kind: "box"; inner: { w: { h: number } } } | { kind: "dot"; at: { x: number } };
const shapes: Shape[] = [{ kind: "box", inner: { w: { h: 2 } } }, { kind: "dot", at: { x: 1 } }];
for (const s of shapes) {
  console.log(formatWithOptions({ depth: 0 }, "%O", s));
  console.log(formatWithOptions({ depth: 2 }, "rest", s));
}

// The two class shapes a box has to tell apart, beyond the standalone one:
// a HIERARCHY member and a RUNTIME class.
//
// The narrow is the preorder-interval test `x instanceof C` compiles to,
// asked of the box's instance. That only answers correctly if the box reads
// the instance's OWN position rather than the static type it was widened
// from — a Base-typed slot holding a Derived must still narrow to Derived.
// Hierarchy instances carry the rc+vt prefix and the vtable knows; a
// standalone class has no vt word and no subclasses, so its descriptor's
// interval IS the answer. The box records which of the two it is, and reads
// the fact from the same ClassMeta `instanceof` reads.
//
// `Readable` is the second shape and the one the corpus actually hit: a
// runtime-provided class, so its RC pair comes from the runtime rather than
// from an emitted per-class helper, and its interval is stamped into the
// runtime vtable at main(). Nothing about the box changes.

import { Readable } from "node:stream";

class Shape {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
  area(): number {
    return 0;
  }
}

class Circle extends Shape {
  r: number;
  constructor(r: number) {
    super("circle");
    this.r = r;
  }
  area(): number {
    return 3 * this.r * this.r;
  }
}

class Square extends Shape {
  side: number;
  constructor(side: number) {
    super("square");
    this.side = side;
  }
  area(): number {
    return this.side * this.side;
  }
}

const c = new Circle(2);
const sq = new Square(3);

// Widened from the BASE-typed slot. The box still holds a Circle, and the
// vtable is where that survives.
const base: Shape = c;
const ub: unknown = base;
const asShape = ub as Shape;
console.log("base narrow:", asShape.name, asShape.area(), asShape === c);

// …and back to the DERIVED class, from a box made at the base type. This
// is the assertion the `vt` flag exists for: a descriptor that recorded
// only the static class would answer Shape's interval and refuse here.
const asCircle = ub as Circle;
console.log("derived narrow:", asCircle.r, asCircle === c, asCircle === base);

// Virtual dispatch through the narrowed value is the ordinary one — the
// instance never changed, so the override runs.
const shapes: Shape[] = [c, sq];
for (const s of shapes) {
  const u: unknown = s;
  const back = u as Shape;
  console.log(back.name, back.area());
}

// A RUNTIME class: same box, RC pair from the runtime, interval stamped at
// main(). The stream is never read through the box — the box carries it.
const rs = Readable.from(["a", "b"]);
const ur: unknown = rs;
const backStream = ur as Readable;
console.log("stream identity:", backStream === rs);

// The zapo shape in miniature: a predicate over a union whose non-string
// arm is a runtime class instance.
type Body = string | Readable;
function isStreamy(v: unknown): boolean {
  return typeof v === "object" && v !== null;
}
function bodyKind(b: Body): string {
  if (isStreamy(b)) return "stream";
  return "text";
}
console.log(bodyKind("inline"), bodyKind(rs));

// And the same union carried inside a RECORD, which is how it reaches the
// conversion in a real message type: the record deep-copies, the class
// member is carried by reference inside the copy.
interface Part {
  readonly kind: "part";
  readonly body: Body;
}
function isPart(v: unknown): v is Part {
  return typeof v === "object" && v !== null && "kind" in v && v.kind === "part";
}
const parts: Part[] = [{ kind: "part", body: "hello" }, { kind: "part", body: rs }];
for (const p of parts) {
  console.log(isPart(p), bodyKind(p.body));
}

// The stream still works afterwards — the crossing carried it, it did not
// consume or copy it.
async function drain(s: Readable): Promise<string> {
  let out = "";
  for await (const chunk of s) out = out + String(chunk);
  return out;
}
drain(backStream).then((text) => {
  console.log("drained:", text);
});

// An index-signature keyed read INITIALIZING a binding — the rung after the
// dyn slot and the presence test. `const id = node.attrs.id; if (!id) return`
// types `id` as `string`, because tsc types an index-signature read by the
// signature's VALUE type, and no string width can hold the undefined an
// absent key answers: the read trapped one line before the author's own
// guard. The binding takes the read at DYN width instead, and the
// destination decides all over again — one level down, at every REFERENCE.
//
// A reference tsc narrowed to the scalar it believes bridges through a
// VALIDATED extraction, so a use that needs the value throws the catchable
// dyn-boundary TypeError where Node throws its own; and the consumers that
// have a total answer for every dyn kind ask the dyn itself, so they answer
// exactly as Node does: truthiness, the unit comparisons, strict equality,
// `??`, `||`/`&&`, and the console formatter. A HIT is what it always was.
//
// Two restrictions carry the reasoning. Only IMMUTABLE PRIMITIVES widen — a
// composite read into a dyn slot is a deep copy, which would sever aliasing
// the binding has today. And the binding's spelled width must be the read's
// own, or that width plus an undefined arm: the second is the author who
// wrote `string | undefined` and had tsc narrow it away at the declaration,
// whose readers were then compiled as bare arm peeks. Both land on dyn,
// where every reader is checked and no peek exists.
//
// A read flowing into a slot that is NOT a binding of its own width — a
// `string` parameter, a `string[]` element, a declared field — keeps the
// trap it has: that slot belongs to code compiled for the narrow type.
//
// Everything below is behaviour Node and scriptc AGREE on.

type Attrs = Readonly<Record<string, string>>;

interface BinaryNode {
  readonly tag: string;
  readonly attrs: Attrs;
}

// --- the zapo shape: the guard the author wrote, one line after the read

function tryResolvePending(node: BinaryNode): boolean {
  const id = node.attrs.id;
  if (!id) {
    return false;
  }
  return id.length > 0;
}

const ping: BinaryNode = { tag: "iq", attrs: { type: "get" } };
const iq: BinaryNode = { tag: "iq", attrs: { id: "42", type: "result" } };
console.log("resolve-miss", tryResolvePending(ping));
console.log("resolve-hit", tryResolvePending(iq));

// --- every reader that ANSWERS, over a hit, a miss and a falsy present value

function readers(label: string, m: Attrs): void {
  const v = m["k"];
  console.log(label, "log", v);
  console.log(label, "truthy", v ? "T" : "F");
  console.log(label, "not", !v);
  console.log(label, "eq-undef", v === undefined);
  console.log(label, "neq-undef", v !== undefined);
  console.log(label, "eq-null-loose", v == null);
  console.log(label, "neq-null-loose", v != null);
  console.log(label, "typeof", typeof v);
  console.log(label, "eq-lit", v === "vv");
  console.log(label, "neq-lit", v !== "vv");
  console.log(label, "nullish", v ?? "D");
  console.log(label, "or", v || "D");
  console.log(label, "and", v && "Y");
  console.log(label, "boolean", Boolean(v));
  console.log(label, "String", String(v));
  console.log(label, "ternary", v === undefined ? "none" : "some");
}

readers("hit", { k: "vv" });
readers("miss", { other: "vv" });
readers("empty", { k: "" });

// --- the value uses: Node throws, and so does this, catchably

function consumers(label: string, m: Attrs): void {
  const v = m["k"];
  try {
    console.log(label, "len", v.length);
  } catch {
    console.log(label, "len threw");
  }
  try {
    console.log(label, "slice", v.slice(0, 1));
  } catch {
    console.log(label, "slice threw");
  }
}

consumers("hit", { k: "vv" });
consumers("miss", { other: "vv" });

// --- a guard makes every later reader safe, exactly as it does in Node

function guarded(m: Attrs): string {
  const v = m["k"];
  if (v === undefined) {
    return "absent";
  }
  return v + ":" + String(v.length);
}

console.log("guarded-hit", guarded({ k: "abc" }));
console.log("guarded-miss", guarded({ other: "abc" }));

function guardedTruthy(m: Attrs): number {
  const v = m["k"];
  if (!v) {
    return -1;
  }
  return v.length;
}

console.log("truthy-hit", guardedTruthy({ k: "abcd" }));
console.log("truthy-miss", guardedTruthy({ other: "abcd" }));
console.log("truthy-empty", guardedTruthy({ k: "" }));

// --- the r03 shape: the author SPELLED the undefined arm and tsc narrowed
// it away at the declaration

const rec: Attrs = { a: "1" };
const hit: string | undefined = rec.a;
const miss: string | undefined = rec.zzz;
console.log("annot-hit", hit);
console.log("annot-miss", miss);
console.log("annot-miss-eq", miss === undefined);
console.log("annot-hit-eq", hit === undefined);
console.log("annot-dflt", miss ?? "D");
console.log("annot-or", miss || "D");

// --- file scope takes the same rule as a function body

const fileScope: string = rec.nope;
console.log("file-scope", fileScope);
console.log("file-scope-eq", fileScope === undefined);
console.log("file-scope-dflt", fileScope ?? "D");

// --- a let, reassigned both ways

function reassigned(m: Attrs, replace: boolean): string {
  let v = m["k"];
  if (replace) {
    v = "set";
  }
  if (!v) {
    return "fallback";
  }
  return v;
}

console.log("let-miss", reassigned({ other: "x" }, false));
console.log("let-miss-set", reassigned({ other: "x" }, true));
console.log("let-hit", reassigned({ k: "orig" }, false));

// --- a closure capturing the binding

function capture(m: Attrs): () => boolean {
  const v = m["k"];
  return () => v === undefined;
}

console.log("capture-miss", capture({ other: "x" })());
console.log("capture-hit", capture({ k: "x" })());

// --- number and boolean signatures take the same route

type Counts = Readonly<Record<string, number>>;
type Flags = Readonly<Record<string, boolean>>;

function scalars(label: string, c: Counts, f: Flags): void {
  const n = c["n"];
  const b = f["b"];
  console.log(label, "n", n, n === undefined, typeof n, n ?? -1);
  console.log(label, "b", b, b === undefined, typeof b, b ?? true);
  console.log(label, "n-truthy", n ? "T" : "F");
  console.log(label, "b-truthy", b ? "T" : "F");
}

scalars("num-hit", { n: 7 }, { b: true });
scalars("num-miss", { other: 7 }, { other: true });
scalars("num-zero", { n: 0 }, { b: false });

// --- declared fields ALONGSIDE a signature: the field always answers

interface Hybrid {
  readonly named: string;
  readonly [key: string]: string;
}

function hybrid(h: Hybrid): void {
  const named = h.named;
  const extra = h["extra"];
  console.log("hybrid", named, extra, extra === undefined, named === undefined);
}

hybrid({ named: "N" });
hybrid({ named: "N", extra: "E" });

// --- a runtime key, and fifty reads through the interned helper

function drain(m: Attrs, keys: readonly string[]): string {
  let out = "";
  for (const k of keys) {
    const v = m[k];
    if (v !== undefined) {
      out = out + v;
    } else {
      out = out + ".";
    }
  }
  return out;
}

console.log("drain", drain({ a: "A", c: "C" }, ["a", "b", "c", "d"]));

function many(m: Attrs): number {
  let n = 0;
  for (let i = 0; i < 50; i++) {
    const v = m["k"];
    if (v) {
      n = n + 1;
    }
  }
  return n;
}

console.log("many-miss", many({ other: "x" }));
console.log("many-hit", many({ k: "x" }));

// --- a key expression with EFFECTS still runs

let keyCalls = 0;
function keyName(): string {
  keyCalls = keyCalls + 1;
  return "k";
}

function effectful(m: Attrs): boolean {
  const v = m[keyName()];
  return v === undefined;
}

console.log("effect-miss", effectful({ other: "x" }), keyCalls);
console.log("effect-hit", effectful({ k: "x" }), keyCalls);

// --- a signature that can ALREADY say undefined is untouched by all of it

type Opt = Readonly<Record<string, string | undefined>>;

function optional(m: Opt): void {
  const v = m["k"];
  console.log("opt", v, v === undefined, v ?? "D", v ? "T" : "F");
}

optional({ k: "x" });
optional({ other: "x" });
optional({ k: undefined });

// --- and a dyn signature keeps the answers it already had

type Unk = Readonly<Record<string, unknown>>;

function unknowns(m: Unk): void {
  const v = m["k"];
  console.log("unk", v, v === undefined, v ?? "D");
}

unknowns({ k: "x" });
unknowns({ other: "x" });
unknowns({ k: 5 });

console.log("done");

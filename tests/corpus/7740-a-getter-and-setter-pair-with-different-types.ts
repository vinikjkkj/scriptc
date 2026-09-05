// A getter and a setter for ONE property, annotated with DIFFERENT types —
// the shape mongodb's `AbstractOperation` declares:
//
//     get session(): ClientSession | undefined { return this._session }
//     set session(session: ClientSession)      { this._session = session }
//
// TypeScript has admitted this since 4.3 and unrelated halves since 5.1, and
// the idiom it spells is "write a value, read back maybe-not-set-yet". The
// halves are not two views of one slot: a class accessor has NO slot of its
// own. `get p` and `set p` are two independent methods with two independent
// signatures, and the property's storage is whatever the accessor BODIES
// touch — here `_holder`, a declared field with its own single type.
//
// So the properties pinned here are the ones a shared-slot model would get
// wrong: a read BEFORE any write must produce the getter's undefined arm
// (not zeroed memory and not a tag read off a slot that never carried one);
// a write must hand the setter the BARE value its parameter declares (not a
// value wrapped at the getter's wider type); and the two must keep agreeing
// after any number of writes.

class Session {
  id: string;
  constructor(id: string) {
    this.id = id;
  }
}

class Operation {
  private _holder: Session | undefined = undefined;

  // The pair: the getter is armed with `undefined`, the setter is not.
  get session(): Session | undefined {
    return this._holder;
  }
  set session(s: Session) {
    this._holder = s;
  }

  clear(): void {
    this._holder = undefined;
  }

  // A read through the getter from INSIDE the class — the same call, one
  // receiver in.
  describe(): string {
    const s = this.session;
    return s === undefined ? "<none>" : s.id;
  }
}

// ---------------------------------------------------------------- the arm
// Read BEFORE any write: the getter's `undefined` arm has to be reachable,
// and has to be the value Node produces, not an absent slot read as zero.
const op = new Operation();
console.log(op.session);
console.log(op.session === undefined);
console.log(typeof op.session);
console.log(op.describe());

// ------------------------------------------------------- through the pair
op.session = new Session("s1");
console.log(op.session === undefined ? "<none>" : op.session.id);
console.log(op.describe());

// Overwritten: the second write goes through the same setter and the same
// storage, and the read still narrows.
op.session = new Session("s2");
const read = op.session;
if (read !== undefined) console.log("narrowed", read.id);
console.log(op.describe());

// Back to the undefined arm through a method that writes the FIELD, and
// read back through the getter — the two ends of one storage.
//
// Read through `peek`, not through `op.session` at this statement: tsc has
// `op.session` narrowed to `Session` from the write four lines up and does
// NOT reset that narrowing across the `op.clear()` call (its documented
// property-narrowing unsoundness). Every backend here trusts the checker, so
// the direct spelling aborts on the extraction rather than printing what
// Node prints — a divergence that predates this pair and has nothing to do
// with it. Inside `peek` the read is unnarrowed and both agree.
function peek(o: Operation): Session | undefined {
  return o.session;
}
op.clear();
console.log(peek(op), op.describe());

// ------------------------------------------------- the value's onward life
// The getter's value flows into every slot its type fits: a parameter, an
// array element, a record field, a nullish default. A write-typed value
// (bare `Session`) must never appear in any of them, and an undefined-armed
// one must never be stripped.
function name(s: Session | undefined): string {
  return s === undefined ? "u" : s.id;
}

op.session = new Session("s3");
console.log(name(op.session));
console.log(op.session?.id);
const held: (Session | undefined)[] = [op.session];
console.log(held.length, name(held[0]));
const box = { inner: op.session };
console.log(name(box.inner));
op.clear();
console.log(name(peek(op)), peek(op)?.id, name({ inner: peek(op) }.inner));

// ------------------------------------------------------ the other direction
// The setter WIDER than the getter: the read is a bare `string`, the write
// takes three kinds. Nothing about the read may carry a tag, and each written
// arm has to reach the setter as itself.
class Label {
  private _text: string = "init";
  get text(): string {
    return this._text;
  }
  set text(v: string | number | boolean) {
    this._text = typeof v === "boolean" ? (v ? "T" : "F") : String(v);
  }
}

const label = new Label();
console.log(label.text, label.text.length);
label.text = 5;
console.log(label.text, label.text.length);
label.text = true;
console.log(label.text, label.text.length);
label.text = "ok";
console.log(label.text, label.text.length);
const asUnion: string | number = 42;
label.text = asUnion;
console.log(label.text, label.text.length);

// --------------------------------------------------------- more than two arms
// The getter's extra arm as `null` rather than `undefined`, and a getter with
// three arms over a two-arm setter.
class Cell {
  private _v: string | number | null = null;
  get v(): string | number | null {
    return this._v;
  }
  set v(x: string) {
    this._v = x;
  }
  reset(): void {
    this._v = null;
  }
}

const cell = new Cell();
console.log(cell.v, cell.v === null);
cell.v = "hi";
const cv = cell.v;
if (typeof cv === "string") console.log("string arm", cv.length);
function peekCell(c: Cell): string | number | null {
  return c.v;
}
cell.reset();
console.log(peekCell(cell), peekCell(cell) === null);

// ----------------------------------------------- inheritance, both halves
// A base class carries the pair; the subclass overrides BOTH halves with the
// same (divergent) types. Reads and writes through a BASE-typed reference
// must dispatch to the subclass's halves — get and set devirtualize
// independently, so a model that shared one slot would pick one of them.
class Base {
  protected _v: string | undefined = undefined;
  get v(): string | undefined {
    return this._v;
  }
  set v(x: string) {
    this._v = x;
  }
  show(): string {
    return this.v === undefined ? "-" : this.v;
  }
}

class Loud extends Base {
  get v(): string | undefined {
    return this._v === undefined ? undefined : this._v.toUpperCase();
  }
  set v(x: string) {
    this._v = "[" + x + "]";
  }
}

const plain: Base = new Base();
const loud: Base = new Loud();
console.log(plain.v, loud.v);
plain.v = "a";
loud.v = "b";
console.log(plain.v, loud.v);
console.log(plain.show(), loud.show());

// `super.v` on both sides: a direct call of the base half, with the derived
// setter's own (different) parameter type in front of it.
class Prefixed extends Base {
  get v(): string | undefined {
    return super.v;
  }
  set v(x: string) {
    super.v = "S" + x;
  }
}
const pre = new Prefixed();
console.log(pre.v);
pre.v = "c";
console.log(pre.v);
const preAsBase: Base = pre;
preAsBase.v = "d";
console.log(preAsBase.v, preAsBase.show());

// ----------------------------------------------------- an ABSTRACT pair
// Declared abstract (both halves body-less, erased at run time), implemented
// below with the same divergence, dispatched through the abstract type.
abstract class Holder {
  abstract get slot(): string | undefined;
  abstract set slot(x: string);
  report(): string {
    return "slot=" + String(this.slot);
  }
}

class RealHolder extends Holder {
  private _s: string | undefined = undefined;
  get slot(): string | undefined {
    return this._s;
  }
  set slot(x: string) {
    this._s = x;
  }
}

const holder: Holder = new RealHolder();
console.log(holder.report());
holder.slot = "q";
console.log(holder.report(), holder.slot);

// ------------------------------------------------------- through containers
// The pair reached through an array element, a Map value and a for-of
// binding — every receiver spelling the write path resolves.
const ops: Operation[] = [new Operation(), new Operation(), new Operation()];
ops[0]!.session = new Session("a");
ops[2]!.session = new Session("c");
for (const each of ops) console.log(each.describe());

const byName = new Map<string, Operation>();
byName.set("first", ops[0]!);
const got = byName.get("first");
if (got !== undefined) {
  got.session = new Session("a2");
  console.log(got.describe());
}

// A destructuring ASSIGNMENT whose target is the accessor property: the
// value is built at the SETTER's type, and the read after it at the
// getter's.
const source = { session: new Session("d") };
({ session: ops[1]!.session } = source);
console.log(ops[1]!.describe());
console.log(ops.map((o) => o.describe()).join(","));

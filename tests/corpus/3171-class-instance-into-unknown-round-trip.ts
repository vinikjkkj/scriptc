// A CLASS INSTANCE widened to `unknown`, and narrowed back.
//
// Before SCR_DYN_OBJINST the widening was the fence: `converting typed
// values to 'unknown' is not supported yet` (SC1101), because the dyn tree
// had no representation for a class instance and the conversion domain had
// no `object` arm. Records and interfaces crossed by DEEP COPY, functions
// crossed BOXED, bytes crossed by REFERENCE — a class had nothing.
//
// The half that makes the crossing worth having is the RETURN. A widening
// that loses identity gives back a value nobody can use: the whole point of
// handing an instance to an `unknown`-typed helper is to get THAT instance
// back, not a copy of its fields. So the box holds the object by reference
// and the narrow unwraps that very pointer, which is what every assertion
// below is really testing:
//
//     unbox(box(x)) === x        the round trip is the identity
//     box(x) === box(x)          two crossings of one value are one value
//
// The `=== created` idiom this exists for is at the bottom.

class Ticket {
  id: number;
  label: string;
  constructor(id: number, label: string) {
    this.id = id;
    this.label = label;
  }
  describe(): string {
    return this.label + "#" + String(this.id);
  }
}

class Coupon {
  code: string;
  constructor(code: string) {
    this.code = code;
  }
}

const t = new Ticket(7, "row");

// Widen. No copy is made: the dyn value and `t` are the same object.
const u: unknown = t;

// Narrow. The pointer that comes back is the one that went in, so the
// instance is fully usable again — fields and methods both.
const back = u as Ticket;
console.log(back.id, back.label, back.describe());
console.log("identity:", back === t);

// Two independent crossings of one value are still one value.
const u2: unknown = t;
console.log("two boxes, one value:", (u2 as Ticket) === (u as Ticket));

// A DIFFERENT instance of the same class is a different value.
const other = new Ticket(7, "row");
const uo: unknown = other;
console.log("distinct instances:", (uo as Ticket) === t, other.id === t.id);

// A second class crosses on its own terms — the box carries which class
// it holds, so two classes in `unknown` slots stay apart. (The MISMATCHED
// narrow, `uc as Ticket`, is deliberately not exercised here: this
// compiler's `as` on an unknown value is a CHECKED cast that throws, while
// Node erases the assertion entirely and reads undefined off the wrong
// object — a documented divergence, so a differential program must not
// depend on it either way.)
const uc: unknown = new Coupon("SAVE10");
console.log("right class:", (uc as Coupon).code);

// Widening through a PARAMETER and back through a RETURN — the shape a
// helper written against `unknown` actually has.
function passThrough(v: unknown): unknown {
  return v;
}
console.log("through a call:", (passThrough(t) as Ticket) === t);

// The idiom the identity requirement exists for: an in-flight slot held
// as `unknown`, checked against the value that filled it before being
// cleared. (A single slot rather than a Map, because a Map VALUE of type
// `unknown` is a separate boundary this change does not touch — reading
// one back is still SC2011.)
class Dedup {
  key: string;
  slot: unknown;
  filled: boolean;
  constructor() {
    this.key = "";
    this.slot = undefined;
    this.filled = false;
  }
  start(key: string, made: Ticket): boolean {
    if (this.filled) return false;
    this.key = key;
    this.slot = made;
    this.filled = true;
    return true;
  }
  replace(made: Ticket): void {
    this.slot = made;
  }
  settle(created: Ticket): string {
    if (!this.filled) return "empty";
    // The comparison the whole kind is for. `this.slot` is the boxed
    // value; the narrow hands back the very instance `created` names, so
    // this is a pointer compare and answers true exactly when nobody
    // replaced the slot underneath us.
    if ((this.slot as Ticket) === created) {
      this.filled = false;
      this.slot = undefined;
      return "cleared " + created.describe();
    }
    return "superseded";
  }
}

const d = new Dedup();
const a1 = new Ticket(1, "a");
console.log(d.start("a", a1));
console.log(d.start("a", new Ticket(2, "a")));
console.log(d.settle(a1));
console.log(d.settle(a1));

// A replaced slot answers the other way, which is the case the compare has
// to get right for the idiom to mean anything.
const d2 = new Dedup();
const b1 = new Ticket(3, "b");
const b2 = new Ticket(4, "b");
console.log(d2.start("b", b1));
d2.replace(b2);
console.log(d2.settle(b1));
console.log(d2.settle(b2));
console.log("filled:", d2.filled);

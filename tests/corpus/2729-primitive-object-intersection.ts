// A primitive intersected with an object that has real members.
//
// `number & { low: number; high: number; unsigned: boolean }` is how
// protobuf typings spell "a number, or the Long object this becomes past
// 2^53". The value really is one or the other at runtime, so it lowers to
// the checked-dynamic tree: members read through the dyn, use as a number
// exits through a checked cast, and a lying value throws instead of being
// misread.
//
// Mapping it to the PRIMITIVE would be simpler and wrong -- a Long object
// read as an f64 is garbage, silently. The empty-object refinement still
// answers first, so `string & {}` keeps collapsing to the string.
type Long = { low: number; high: number; unsigned: boolean };
type LongLike = number & Long;

// The union protobuf actually declares for a timestamp field.
type Stamp = number | LongLike;

function asNumber(v: Stamp): number {
  return typeof v === "number" ? v : 0;
}

const plain: Stamp = 1234;
console.log(asNumber(plain));

// Held in a record, which is where it mattered: a field of this type used
// to fail the whole record, and with it every union arm and class above.
type Mutation = { readonly kind: string; readonly at: Stamp };
const e: Mutation = { kind: "set", at: 7 };
console.log(e.kind, asNumber(e.at));

const events: Mutation[] = [e, { kind: "remove", at: 9 }];
let total = 0;
for (const ev of events) total += asNumber(ev.at);
console.log(events.length, total);

// A callback taking one -- the shape that kept a class from collecting.
class Sink {
  private readonly seen: string[] = [];
  private readonly emit?: (ev: Mutation) => void;
  constructor(emit?: (ev: Mutation) => void) {
    this.emit = emit;
  }
  accept(ev: Mutation): void {
    this.seen.push(ev.kind);
    if (this.emit !== undefined) this.emit(ev);
  }
  report(): string {
    return this.seen.join(",");
  }
}
const sink = new Sink();
for (const ev of events) sink.accept(ev);
console.log(sink.report());

// The empty-object refinement is untouched: this is still a plain string.
type Branded = string & {};
const b: Branded = "brand";
console.log(b.toUpperCase(), b.length);

// `emit.bind(x)` into a generic key-map slot dispatches through a
// TAG-CHECKED payload-array read.
//
// The slot's shape is `<K extends keyof M>(event: K, ...args:
// Parameters<M[K]>) => void`. Erased to its constraint that is
// `(name: string, args: U[]) => void`, where U flattens EVERY armed
// event's payload types into one union — so the dispatcher tests the
// NAME and then has to get the payload's arm out of U. It used to take
// that arm on the name test's word alone. The array is the caller's, and
// the pair (name, payload) is bound by tsc's generic instantiation and by
// nothing the runtime performed, so a wrong pair peeked one event's
// payload through another's struct.
//
// Where the pair is honest the check is one predictable compare that
// always passes, and that is what this program pins: every emit below is
// correct, so every answer is Node's answer. A SUBCLASS in a base-class
// position is honest too — tsc admits it, the payload pointer is
// prefix-compatible and carries its own vtable — so the check admits the
// descendant arms as well, and `who()` still reaches the override.
//
// The dishonest direction cannot be differential: Node hands the listener
// the wrong object and lets the reads answer undefined (or, for a wider
// record, prints the value that happens to sit at the offset).
// tests/harness/dyncheck.test.ts covers it with the three shapes that used
// to answer wrongly instead of loudly — a wider record whose surplus field
// is a NUMBER (the read loaded a double as a string pointer: SIGSEGV on
// both backends), a wider record whose surplus field is a STRING (the
// wrong string came back, exit 0, no diagnostic), and the same confusion
// through the nested regroup helper's unconditional tail.
import { EventEmitter } from "node:events";

interface Ping {
  readonly at: number;
}
interface Note {
  readonly text: string;
}
interface Wide {
  readonly extra: number;
  readonly text: string;
}
interface Ack {
  readonly id: string;
  readonly ok: boolean;
}

class Shape {
  readonly tag: string;
  constructor(tag: string) {
    this.tag = tag;
  }
  who(): string {
    return "shape:" + this.tag;
  }
}
class Round extends Shape {
  readonly r: number;
  constructor(tag: string, r: number) {
    super(tag);
    this.r = r;
  }
  who(): string {
    return "round:" + this.tag + ":" + String(this.r);
  }
}

interface Ev {
  ping: (p: Ping) => void;
  note: (n: Note) => void;
  wide: (w: Wide) => void;
  ack: (a: Ack) => void;
  // A payload that is itself a UNION: no single arm of U carries it, so
  // this position goes through the nested regroup helper.
  either: (v: Note | Ack) => void;
  // A CLASS position, with a descendant class armed by another event.
  shape: (s: Shape) => void;
  round: (s: Round) => void;
  // Scalar positions.
  count: (n: number) => void;
  tick: (n: number) => void;
}

interface Sink {
  readonly emitEvent: <K extends keyof Ev>(event: K, ...args: Parameters<Ev[K]>) => void;
}

class Bus extends EventEmitter {
  sink(): Sink {
    return { emitEvent: this.emit.bind(this) };
  }
}

const bus = new Bus();
bus.on("ping", (p: Ping) => {
  console.log("ping at=" + String(p.at));
});
bus.on("note", (n: Note) => {
  console.log("note text=" + n.text);
});
bus.on("wide", (w: Wide) => {
  console.log("wide extra=" + String(w.extra) + " text=" + w.text);
});
bus.on("ack", (a: Ack) => {
  console.log("ack id=" + a.id + " ok=" + String(a.ok));
});
bus.on("either", (v: Note | Ack) => {
  console.log("either " + ("text" in v ? "note:" + v.text : "ack:" + v.id));
});
bus.on("shape", (s: Shape) => {
  console.log("shape " + s.who());
});
bus.on("round", (s: Round) => {
  console.log("round " + s.who() + " r=" + String(s.r));
});
bus.on("count", (n: number) => {
  console.log("count " + String(n));
});

const s: Sink = bus.sink();

// Every position, in order.
s.emitEvent("ping", { at: 1 });
s.emitEvent("note", { text: "hello" });
s.emitEvent("wide", { extra: 2, text: "wider" });
s.emitEvent("ack", { id: "a1", ok: true });
s.emitEvent("either", { text: "as-note" });
s.emitEvent("either", { id: "a2", ok: false });
s.emitEvent("shape", new Shape("plain"));
s.emitEvent("round", new Round("circle", 3));
s.emitEvent("count", 42);

// A DESCENDANT in the base-class position: tsc admits it, the vtable
// rides with the pointer, and `who()` reaches Round's override.
s.emitEvent("shape", new Round("smuggled", 9));

// The same sink through a second reference, and a second bound sink from
// the same class — the dispatcher is interned per (class, slot), so both
// must reach the same function.
const s2: Sink = bus.sink();
s2.emitEvent("note", { text: "second-sink" });

// A loop, so the check runs on a hot path rather than once.
let total = 0;
bus.on("tick", (n: number) => {
  total += n;
});
for (let i = 0; i < 500; i++) {
  s.emitEvent("tick", i);
}
console.log("looped total=" + String(total));

// An event named by the map with a listener registered AFTER the bind:
// the dispatcher's arm set is program-global, so this still lands.
bus.on("ping", (p: Ping) => {
  console.log("ping2 at=" + String(p.at));
});
s.emitEvent("ping", { at: 5 });

console.log("done");

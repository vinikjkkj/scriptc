// The PUBLISHED-CLASS shape: a package exports a class as an interface plus
// a cast constructor, keeping the implementation unexported.
//
//   class Impl { … }                        // not exported
//   export interface C extends Impl { … }   // the instance type
//   export const C = Impl as unknown as CCtor
//
// Two things have to see through it. The VALUE side: `new C()` constructs
// Impl -- the casts are erasure, so the const IS the class's static side,
// and the interface merged under the same name contributes no value. The
// TYPE side: the interface only RE-TYPES members Impl already declares, so
// an instance of it IS an Impl. Mapping the interface structurally instead
// would answer a record no instance of the class can satisfy, and every use
// of the published surface would fence.
//
// The re-typing is the POINT of the pattern: it gives `on`/`emit` a typed
// event map the class itself cannot express.
class EmitterImpl {
  private readonly events: string[];
  private readonly listeners: ((payload: string) => void)[];
  readonly name: string;
  constructor(name: string) {
    this.name = name;
    this.events = [];
    this.listeners = [];
  }
  on(event: string, listener: (payload: string) => void): this {
    this.events.push(event);
    this.listeners.push(listener);
    return this;
  }
  fire(event: string, payload: string): boolean {
    const i = this.events.indexOf(event);
    if (i < 0) return false;
    this.listeners[i]!(payload);
    return true;
  }
  describe(): string {
    return `${this.name}/${this.events.length}`;
  }
}

type EventMap = { ready: (payload: string) => void; done: (payload: string) => void };

interface BusCtor {
  new (name: string): Bus;
}
// Adds nothing: `on` is a NARROWER spelling of a member Impl already has.
export interface Bus extends EmitterImpl {
  on<K extends keyof EventMap>(event: K, listener: EventMap[K]): this;
}
export const Bus = EmitterImpl as unknown as BusCtor;

const bus = new Bus("main");
bus.on("ready", (p) => {
  console.log("ready:", p);
});
bus.on("done", (p) => {
  console.log("done:", p);
});

// Members reached through the published (interface) type: the re-typed one,
// and the ones inherited untouched.
console.log(bus.fire("ready", "one"));
console.log(bus.fire("done", "two"));
console.log(bus.fire("absent", "three"));
console.log(bus.name, bus.describe());

// The published type in a PARAMETER position -- the ABI has to exist, not
// just typecheck at the binding.
function drive(b: Bus, label: string): string {
  b.on("ready", (p) => {
    console.log(label, p);
  });
  b.fire("ready", "via-param");
  return b.describe();
}
console.log(drive(bus, "driven:"));

// Chaining works because `this` is the class, not a fresh record.
console.log(
  new Bus("chain")
    .on("ready", (p) => {
      console.log("chained:", p);
    })
    .describe(),
);

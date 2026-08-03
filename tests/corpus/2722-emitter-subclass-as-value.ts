// A class that EXTENDS EventEmitter, used as a value.
//
// The builtin emitter itself is runtime-provided and has no class object
// to reference, so taking IT as a value fences. A subclass is different:
// it is program-declared, so it has the emitted static every other class
// value uses, and constructing one directly already worked. Only the
// value spelling was refused, which left the library idiom -- declare the
// implementation, export it through a constructor-typed alias -- with no
// way to compile.
import { EventEmitter } from "node:events";

class ClientImpl extends EventEmitter {
  readonly name: string;
  count = 0;
  constructor(name: string) {
    super();
    this.name = name;
  }
  fire(): void {
    this.count += 1;
    this.emit("ready", this.name);
  }
}

// The export idiom: the class as a value behind a constructor type.
type ClientCtor = new (name: string) => ClientImpl;
const Client = ClientImpl as unknown as ClientCtor;

const a = new Client("first");
a.on("ready", (n: string) => console.log("ready:", n));
a.fire();
a.fire();
console.log(a.name, a.count);

// The value crossing a call boundary, and constructing there.
function build(C: ClientCtor, name: string): ClientImpl {
  return new C(name);
}
const b = build(Client, "second");
b.on("ready", (n: string) => console.log("also:", n));
b.fire();
console.log(b.name, b.count);

// Held in a record slot -- the injection-point shape a transport keeps.
const config: { ctor: ClientCtor; label: string } = { ctor: Client, label: "third" };
const c = new config.ctor(config.label);
c.fire();
console.log(c.name, c.count, config.label);

// Two instances stay independent, and listeners do not leak across them.
console.log(a.count, b.count, c.count);

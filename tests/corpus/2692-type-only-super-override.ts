// A TYPE-ONLY override of a runtime-owned member: the class re-declares an
// inherited member purely to narrow its TypeScript signature, and the body
// forwards verbatim.
//
//   public on<K extends keyof EvMap>(event: K, l: EvMap[K]): this
//   public on(event: string, l: (...a: any[]) => void): this
//   public on(event: string, l: (...a: any[]) => void): this {
//     return super.on(event, l)
//   }
//
// This is the standard way to publish typed events over EventEmitter. The
// wrapper does nothing at runtime -- the call it makes is the call it
// received -- so the declaration is erased and the member goes on
// dispatching into the runtime surface that owns the emitter.
//
// NOT exercised here, because a corpus case has to compile: a wrapper that
// is observable still fences. Forwarding to a DIFFERENT member, reordering
// or synthesizing arguments, wrapping in async (which answers a Promise
// instead of the forwarded value), and decorating the method (which can
// replace it outright) each keep the override rejection.
import { EventEmitter } from "node:events";

type EvMap = {
  ready: (payload: string) => void;
  done: (payload: string) => void;
};

class Bus extends EventEmitter {
  readonly id: string;
  constructor(id: string) {
    super();
    this.id = id;
  }
  // Narrowed `on`, three declarations: two overload signatures (which
  // declare nothing at runtime) and the forwarding implementation.
  on<K extends keyof EvMap & string>(event: K, listener: EvMap[K]): this;
  on(event: string, listener: (...args: any[]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }
  // `once` the same way, to show the rule is per member and not special
  // to one name.
  once<K extends keyof EvMap & string>(event: K, listener: EvMap[K]): this;
  once(event: string, listener: (...args: any[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this {
    return super.once(event, listener);
  }
  // `emit` too, with the rest parameter forwarded as a spread. This one
  // is NOT the specializable forwarding shape the emit path knows -- it
  // still erases, because a body that observes nothing never needed to be
  // specialized.
  emit<K extends keyof EvMap & string>(event: K, payload: string): boolean;
  emit(event: string, ...args: unknown[]): boolean;
  emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }
}

const bus = new Bus("main");

// The erased override still registers through the runtime emitter.
bus.on("ready", (p) => {
  console.log("ready:", p, bus.id);
});
bus.emit("ready", "one");
bus.emit("ready", "two");

// `once` fires exactly once -- proof the runtime member ran, not a wrapper
// that silently became a plain `on`.
bus.once("done", (p) => {
  console.log("done once:", p);
});
console.log(bus.emit("done", "first"));
console.log(bus.emit("done", "second"));

// The forwarded RETURN value is `this`, so chaining works.
bus
  .on("ready", (p) => {
    console.log("chained:", p);
  })
  .emit("ready", "three");

// Ordinary inherited members are untouched by the override.
console.log(bus.listenerCount("ready"), bus.listenerCount("done"));

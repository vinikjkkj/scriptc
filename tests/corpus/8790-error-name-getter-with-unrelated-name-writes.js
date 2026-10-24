"use strict";
// A constant `get name()` on an Error subclass is stamped into the name slot at
// construction. That is only Node's answer while nothing assigns `.name` on an instance
// the getter can reach (Node throws at such a write; the slot would store it). Other
// Error subclasses assigning their OWN name in their constructors — the common
// spelling in applications — cannot reach it and do not disable the routing.
class KeyError extends Error {
  get name() { return "KeyError"; }
}
class MissingKey extends KeyError {}
class TimerError extends Error {
  constructor() {
    super("timer");
    this.name = "TimerError";
  }
}
class QueueFull extends Error {
  constructor() {
    super("queue full");
    this.name = "QueueFull";
  }
}
class ByConstructor extends Error {
  get name() { return this.constructor.name; }
}
class Nested extends ByConstructor {}
const k = new KeyError("k");
const m = new MissingKey("m");
const t = new TimerError();
const q = new QueueFull();
const n = new Nested("n");
console.log(k.name, k.message, k instanceof KeyError, String(k));
console.log(m.name, m.message, m instanceof KeyError, m instanceof MissingKey, String(m));
console.log(t.name, t.message, t instanceof KeyError, String(t));
console.log(q.name, q.message, q instanceof Error, String(q));
console.log(n.name, n.message, n instanceof ByConstructor, String(n));

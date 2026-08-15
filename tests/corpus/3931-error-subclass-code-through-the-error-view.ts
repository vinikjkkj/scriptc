// @transform-types
// (for the parameter-property spelling below — strip-only mode rejects it)
// A user Error subclass's own `code`, read back through the base `Error`
// view. Node has ONE `code` property and answers it either way: through
// the subclass type, through an `Error`-typed parameter, through a catch
// binding narrowed by instanceof, through `NodeJS.ErrnoException`. Every
// `'error'` listener, every catch and every library boundary in real code
// receives the BASE view, so a value that only reads through the subclass
// type is a value nothing downstream can see.
//
// It used to answer `undefined` through the base view here. The runtime
// lays Error out as [name, message, code] and the base view reads that
// third slot through the error.code libCall; a subclass that declared its
// own `code` was given a SECOND slot laid out after it, so the two views
// named different memory. They are one slot now — the declaration routes
// onto the inherited one — which is why every line below agrees.
//
// The `ERR_`-prefixed case is the reason the runtime's toString grew a
// provenance test. Node's OWN error classes (AssertionError, the NodeError
// family) render "name [code]: message", and the runtime recognised them
// by the `ERR_` prefix on the code, which was exact while nothing but the
// runtime could write that slot. Routing user codes into it is what made
// a user's ERR_* reachable; `String(new Prefixed(...))` is `Prefixed: no
// bracket` in Node v25.9.0, and it must stay that here.
//
// Two spellings, because both are live in the wild and they used to be
// the same kind of broken: `code: string` assigned in the constructor,
// and `readonly code = "LITERAL"` (zapo's BoundedTaskQueueFullError). A
// parameter property is the third, and an inheriting subclass the fourth.

import * as assert from "node:assert";

class Coded extends Error {
  code: string;
  constructor(msg: string) {
    super(msg);
    this.name = "Coded";
    this.code = "E_MINE";
  }
}

class Lit extends Error {
  readonly code = "BOUNDED_TASK_QUEUE_FULL";
  constructor(msg: string) {
    super(msg);
    this.name = "Lit";
  }
}

class Prefixed extends Error {
  code: string;
  constructor(msg: string) {
    super(msg);
    this.name = "Prefixed";
    this.code = "ERR_MINE";
  }
}

class Param extends Error {
  constructor(
    msg: string,
    public readonly code: string,
  ) {
    super(msg);
    this.name = "Param";
  }
}

class Deeper extends Coded {
  constructor(msg: string) {
    super(msg);
    this.name = "Deeper";
  }
}

// The BASE view: exactly what a listener, a catch, or a callback gets.
function viaError(tag: string, e: Error): void {
  const errno = e as NodeJS.ErrnoException;
  console.log(tag + " view name=" + e.name + " message=" + e.message + " code=" + errno.code);
}

const coded = new Coded("boom");
const lit = new Lit("queue is full");
const prefixed = new Prefixed("no bracket");
const param = new Param("param prop", "E_PARAM");
const deeper = new Deeper("inherited");
const plain = new Error("plain");

console.log("A own coded=" + coded.code);
console.log("A own lit=" + lit.code);
console.log("A own prefixed=" + prefixed.code);
console.log("A own param=" + param.code);
console.log("A own deeper=" + deeper.code);

viaError("B coded", coded);
viaError("B lit", lit);
viaError("B prefixed", prefixed);
viaError("B param", param);
viaError("B deeper", deeper);
viaError("B plain", plain);

// String(): a user subclass never brackets, whatever its code spells.
console.log("C str coded=" + String(coded));
console.log("C str lit=" + String(lit));
console.log("C str prefixed=" + String(prefixed));
console.log("C str param=" + String(param));
console.log("C str plain=" + String(plain));
console.log("C tpl prefixed=" + `${prefixed}`);
console.log("C tos prefixed=" + prefixed.toString());

// Presence tests answer off the same slot.
console.log("D typeof coded=" + typeof coded.code);
console.log("D coded is string=" + (typeof (coded as NodeJS.ErrnoException).code === "string"));
console.log("D plain is undefined=" + (typeof (plain as NodeJS.ErrnoException).code === "undefined"));
console.log("D in coded=" + ("code" in coded));
console.log("D in plain=" + ("code" in plain));

// A catch binding narrowed by instanceof is the base view again.
try {
  throw lit;
} catch (err) {
  if (err instanceof Error) {
    console.log("E catch name=" + err.name + " code=" + (err as NodeJS.ErrnoException).code);
  }
}

// Reassignment after construction writes the one slot, so both views move.
coded.code = "E_LATER";
console.log("F own=" + coded.code);
viaError("F", coded);

// The CONTROL for the provenance test: an error the RUNTIME minted, whose
// ERR_* code came from one of Node's own classes, must still bracket. The
// toString change narrows who brackets; it must not stop anyone who should.
try {
  assert.ok(false, "nope");
} catch (err) {
  if (err instanceof Error) {
    console.log("H assert name=" + err.name + " code=" + (err as NodeJS.ErrnoException).code);
    console.log("H assert str=" + String(err));
  }
}

// An array of the base type: the upcast is still a reinterpret.
const all: Error[] = [coded, lit, prefixed, param, deeper];
let joined = "";
for (const e of all) {
  joined = joined + (e as NodeJS.ErrnoException).code + ";";
}
console.log("G joined=" + joined);

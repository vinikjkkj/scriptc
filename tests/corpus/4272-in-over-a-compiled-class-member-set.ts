// `k in instance` over a compiled class — a RUNTIME string key and a
// literal one — and the three names that make the cheap closure wrong.
//
// `in` walks the PROTOTYPE CHAIN, so an instance answers `true` for all
// twelve of `Object.getOwnPropertyNames(Object.prototype)`. A "a compiled
// class has a closed member set, so an undeclared name answers false"
// closure gets `toString`, `hasOwnProperty` and `constructor` wrong — and
// zapo's `install.ts:108` is `if (exposeAs in client) throw new
// Error('collides with a reserved client member')`, so the wrong answer
// there is a silent PASS through the guard written to catch it.
//
// What makes the set closed is not that a class is a class: it is that
// nothing can add a member to an instance at run time. tsc rejects
// `o[k] = v` without an index signature, and `Object.defineProperty` with
// a string key has no lowering (zapo's own `install.ts:114`, six lines
// below the `in`).
//
// Also covered: statics answer FALSE on an instance; a #private answers
// false to every string; an inherited member answers true; an accessor
// answers true WITHOUT the getter running; an EventEmitter-rooted class
// answers the emitter API.

class Base {
  public baseField = 1;
  public baseMethod(): number {
    return this.baseField;
  }
}

let getterRuns = 0;

class D extends Base {
  public a = 1;
  public declaredNotAssigned!: string;
  public optional?: string;
  #secret = 9;
  public m(): number {
    return this.a;
  }
  public get g(): number {
    getterRuns += 1;
    return 2;
  }
  public set s(v: number) {
    this.a = v;
  }
  public static stat(): number {
    return 0;
  }
  public readSecret(): number {
    return this.#secret;
  }
}

const d = new D();

const keys = [
  "a",
  "m",
  "g",
  "s",
  "optional",
  "declaredNotAssigned",
  "baseField",
  "baseMethod",
  "stat",
  "secret",
  "#secret",
  "nope",
  "",
  "toString",
  "hasOwnProperty",
  "constructor",
  "valueOf",
  "isPrototypeOf",
  "propertyIsEnumerable",
  "toLocaleString",
  "__proto__",
  "__defineGetter__",
  "__defineSetter__",
  "__lookupGetter__",
  "__lookupSetter__",
];

// The RUNTIME-key form: the key is a loop variable, not a literal.
for (const k of keys) {
  console.log("runtime", k, k in d);
}
console.log("getter-runs-after-runtime-keys:", getterRuns, "secret:", d.readSecret());

// The LITERAL-key form folds the same set.
console.log("literal a:", "a" in d);
console.log("literal m:", "m" in d);
console.log("literal g:", "g" in d);
console.log("literal declaredNotAssigned:", "declaredNotAssigned" in d);
console.log("literal baseMethod:", "baseMethod" in d);
console.log("literal stat:", "stat" in d);
console.log("literal nope:", "nope" in d);
console.log("literal toString:", "toString" in d);
console.log("literal hasOwnProperty:", "hasOwnProperty" in d);
console.log("literal constructor:", "constructor" in d);
console.log("getter-runs-after-literals:", getterRuns);

// zapo's own line, transcribed: the reserved-member collision check.
const reserved: string[] = [];
function install(client: D, exposeAs: string): string {
  if (exposeAs in client) {
    return `collides: ${exposeAs}`;
  }
  reserved[reserved.length] = exposeAs;
  return `installed: ${exposeAs}`;
}
console.log(install(d, "store"));
console.log(install(d, "toString"));
console.log(install(d, "m"));
console.log(install(d, "constructor"));
console.log("reserved:", reserved.join(","));

// --- evaluate-once, and JS's KEY-THEN-RECEIVER order -------------------------
const order: string[] = [];
function keyOf(k: string): string {
  order[order.length] = `key:${k}`;
  return k;
}
function recvOf(x: D): D {
  order[order.length] = "recv";
  return x;
}
const answered = keyOf("a") in recvOf(d);
console.log("order:", order.join(" "), "answer:", answered);

// --- an EventEmitter-rooted class answers the emitter API --------------------
import { EventEmitter } from "node:events";

class Clientish extends EventEmitter {
  public readonly sessionId = "qr";
  public connect(): number {
    return 1;
  }
}
const c = new Clientish();
for (const k of ["sessionId", "connect", "on", "once", "off", "emit", "eventNames", "toString", "nope"]) {
  console.log("emitter", k, k in c);
}

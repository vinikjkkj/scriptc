// The untyped key surface of a WeakMap, where the key is `any` and so is
// only known at run time. Node's answers, line for line:
//
//  - set() with a primitive key throws TypeError "Invalid value used as weak
//    map key" (a primitive has no address to hold);
//  - get() and has() answer undefined and false for such a key, and do not
//    throw;
//  - delete() answers false for such a key, and does not throw;
//  - set() with an object key stores it, and get/has/delete see it.
//
// Every key below goes through a binding typed `any`, so the checks are the
// runtime's, not the compiler's.

class Id {
  readonly n: number;
  constructor(n: number) {
    this.n = n;
  }
}

const w = new WeakMap<object, string>();
const live = new Id(5);
w.set(live, "five");

function tryPut(key: any, value: string): string {
  try {
    w.set(key, value);
    return "stored";
  } catch (e) {
    return (e as Error).name + ": " + (e as Error).message;
  }
}

const primitives: any[] = [7, "seven", true, undefined, null, 10n];
for (const p of primitives) {
  console.log("set", typeof p, tryPut(p, "x"));
}

const pn: any = 7;
console.log("get primitive:", w.get(pn));
console.log("has primitive:", w.has(pn));
console.log("delete primitive:", w.delete(pn));

const obj: any = live;
console.log("get object:", w.get(obj));
console.log("has object:", w.has(obj));
console.log("delete object:", w.delete(obj));
console.log("has after delete:", w.has(live));

const other: any = new Id(5);
console.log("twin object:", w.has(other), w.get(other));

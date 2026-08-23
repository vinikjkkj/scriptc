// Object.defineProperty: which ARGUMENT refuses, and why.
//
// The fence is one SC2020 line for several different walls, and it used to
// name the wrong one. A reader who is told "the DESCRIPTOR is an accessor"
// budgets accessor work; on a compiled class instance no amount of
// accessor work could land the call, because the receiver had no key table
// to put the property in. estado-accessor.md paid for that lesson once
// (it measured 45 sites refusing "at the descriptor" when every one of
// them refused at the receiver).
//
// A compiled class instance now DOES carry a key table — the per-instance
// `%props` table, which is why zapo's `src/client/plugins/install.ts:114`
// compiles — so "no key table" became the wrong blame in the other
// direction, on the one receiver kind it used to be right about. The class
// hint names the failing CLAUSE instead, out of the same function the
// recognizer uses, so the hint and the lowering cannot drift.
//
// The order is still argument order: receiver first, descriptor only when
// the receiver is admissible.

class Client {
  id: number = 1;
}

const client = new Client();
const runtimeKey: string = "expose" + String(1);
const bag = new Map<string, string>();

// 1. A compiled class instance with a `function` getter. The receiver is
//    fine — the table exists — and the DESCRIPTOR is what refuses: the
//    table calls the half with no receiver, so only an arrow's already
//    captured `this` is safe. The same call with `get: () => ...` is
//    zapo's install.ts:114 and lowers.
Object.defineProperty(client, runtimeKey, {
  get: function () { return bag.get(runtimeKey); },
  enumerable: true,
  configurable: false,
});

// 2. The admitted descriptor in EXPRESSION position: the receiver and the
//    descriptor are both fine and the POSITION is the wall.
const back = Object.defineProperty(client, runtimeKey, {
  get: () => "v",
  enumerable: true,
  configurable: false,
});
console.log(typeof back);

// 3. A record of a FIXED shape: the receiver wall, and the one a class no
//    longer has.
const fixed = { a: 1 };
Object.defineProperty(fixed, "b", { value: 2, writable: true, enumerable: true, configurable: true });

// 4. A record with an INDEX SIGNATURE: the key does have somewhere to live
//    (the overflow map); the descriptor's attribute bits do not.
const bagRecord: Record<string, unknown> = { a: 1 };
Object.defineProperty(bagRecord, runtimeKey, { value: 2, enumerable: true, writable: true, configurable: true });

// 5. A prototype object: not a value here at all, so the receiver refuses
//    before the descriptor is read.
Object.defineProperty(Client.prototype, "dbl", {
  get: function () { return 2; },
});

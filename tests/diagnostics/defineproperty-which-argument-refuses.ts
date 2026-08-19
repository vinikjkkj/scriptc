// Object.defineProperty: which ARGUMENT refuses, and why.
//
// The fence is one SC2020 line for four different walls, and it used to
// name the wrong one. A reader who is told "the DESCRIPTOR is an accessor"
// budgets accessor work; on a compiled class instance no amount of
// accessor work can land the call, because the receiver has no key table
// to put the property in. estado-accessor.md paid for that lesson once
// (it measured 45 sites refusing "at the descriptor" when every one of
// them refused at the receiver), and zapo's one surviving defineProperty
// site is the same trap from the other side.
//
// So the hint answers in argument order: receiver first, descriptor only
// when the receiver is admissible.

class Client {
  id: number = 1;
}

const client = new Client();
const runtimeKey: string = "expose" + String(1);
const bag = new Map<string, unknown>();

// 1. A compiled class instance: a C struct, one field per declared member.
//    This is zapo's src/client/plugins/install.ts:114 exactly.
Object.defineProperty(client, runtimeKey, {
  get: () => bag.get(runtimeKey),
  enumerable: true,
  configurable: false,
});

// 2. A record of a FIXED shape: the same wall, no class name to give.
const fixed = { a: 1 };
Object.defineProperty(fixed, "b", { value: 2, writable: true, enumerable: true, configurable: true });

// 3. A record with an INDEX SIGNATURE: the key does have somewhere to live
//    (the overflow map); the descriptor's attribute bits do not.
const bagRecord: Record<string, unknown> = { a: 1 };
Object.defineProperty(bagRecord, runtimeKey, { value: 2, enumerable: true, writable: true, configurable: true });

// 4. A prototype object: not a value here at all, so the receiver refuses
//    before the descriptor is read.
Object.defineProperty(Client.prototype, "dbl", {
  get: function () { return 2; },
});

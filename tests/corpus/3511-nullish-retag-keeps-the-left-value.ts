// The retagged `??` hands back the LEFT VALUE, not a copy of it.
//
// 3491-3493 pin the retag's LAZINESS, its arm chains and its await default.
// None of them asserts the property the admission predicate is quietly
// buying: `armPairs.every(p => p.src >= 0 && p.dst >= 0)` admits an arm
// only when the destination union has an IDENTICAL arm for it, so the
// surviving value is re-wrapped and never rebuilt.
//
// That predicate has an obvious-looking generalisation, and it is a trap.
// `unionRetagHelper` — which `||`'s orDefault retag calls — also plans a
// per-arm WIDTH LIFT for a record or array arm with no identical home, and
// a lifted arm is a COPY (the published "structural width subtyping
// copies" stance). Widening `??`'s predicate to `unionRetagMappable`, or
// routing it through that helper, would compile strictly more programs and
// would be WRONG for this one: `a ?? b` in JS answers the left value, so
// `(p ?? d) === p` is true and a later mutation through `p` is visible
// through the result. A copy gets the value right and the identity wrong,
// which no trap census can see.
//
// So this fixture is a regression guard on a predicate, not on a feature.
// If a future block widens the retag's admission test, these rows go red
// before anything else does.

interface Payload {
    id: number;
    body: string;
}

// The retag path: left `Payload | null`, result `Payload | string` — two
// non-unit arms in the result, so this is the RETAGGED shape and not the
// single-arm extraction.
function keptWhole(p: Payload | null, d: () => Payload | string): Payload | string {
    return p ?? d();
}

const payload: Payload = { id: 9, body: "original" };
let defaults = 0;
const makeDefault = (): Payload | string => {
    defaults += 1;
    return "fallback";
};

const kept = keptWhole(payload, makeDefault);

// 1. the very same object came back out
console.log("1 same object    ", kept === payload);
console.log("2 default not run", defaults);

// 2. and it is still ALIASED — a write through the original is visible
//    through the result, which a copy would not show
payload.body = "mutated";
console.log("3 aliased        ", typeof kept === "string" ? kept : kept.body);

// 3. writing through the RESULT reaches the original too
if (typeof kept !== "string") {
    kept.id = 42;
}
console.log("4 aliased back   ", payload.id);

// 4. the miss path still answers the default, once
const missed = keptWhole(null, makeDefault);
console.log("5 miss           ", typeof missed === "string" ? missed : missed.body, defaults);

// An ARRAY arm takes the same rule: arrays width-lift too, so an admitted
// lift here would hand back a copied array and `push` would go nowhere.
function keptArr(a: number[] | null, d: () => number[] | string): number[] | string {
    return a ?? d();
}
const nums: number[] = [1, 2];
const keptA = keptArr(nums, () => "none");
console.log("6 same array     ", keptA === nums);
nums.push(3);
console.log("7 array aliased  ", typeof keptA === "string" ? keptA : keptA.join(","));

console.log("done");

export {};

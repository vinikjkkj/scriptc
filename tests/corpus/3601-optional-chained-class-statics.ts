// The two class-static property lowerings that opened with a raw
// `questionDotToken` test — `C?.x` where C is a class declared in the
// program (lowerStaticFieldRead) and `K?.x` through a classval-typed
// BINDING (lowerClassValueProperty). Both declined the optional-chain
// machinery's own re-dispatch, so every chained spelling fell through to
// the generic member fence ("reading 'x' from a value of type 'typeof C'")
// even though the plain spelling lowers.
//
// A static field read is the shape where a lost guard is invisible in the
// VALUE and fatal in the CONTROL FLOW: the read resolves to a module
// global and does not consume its receiver at all, so a fold that dropped
// the chain would answer the field for an absent receiver instead of
// undefined. Both directions are pinned below — the receiver is evaluated
// exactly once when present, exactly once when absent, and the absent
// answer is undefined rather than the field.

class Counter {
    static hits = 41;
    static label = "counter";
    static flag = true;
}

class Other {
    static hits = 7;
}

// ── the identifier receiver: `C?.x` folds, C is never nullish ──────────
console.log("static field:", Counter?.hits);
console.log("static string:", Counter?.label);
console.log("static bool:", Counter?.flag);
console.log("class name:", Counter?.name);
console.log("other:", Other?.hits);

// The fold must agree with the plain spelling, member for member.
console.log("agrees:", Counter?.hits === Counter.hits, Counter?.name === Counter.name);

// ── the classval BINDING: `K?.x`, present and absent ───────────────────
let recvEvals = 0;
function pick(on: boolean): typeof Counter | undefined {
    recvEvals = recvEvals + 1;
    return on ? Counter : undefined;
}

// `.name` CONSUMES the receiver (it reads the runtime class object), so a
// CALL receiver is legal there and the evaluation count is observable.
console.log("present name:", pick(true)?.name);
console.log("receiver evals:", recvEvals);

// The absent arm: undefined, and the receiver evaluated exactly once —
// the guard short-circuits the member, never the receiver.
console.log("absent name:", pick(false)?.name);
console.log("receiver evals:", recvEvals);
console.log("absent is undefined:", pick(false)?.name === undefined);
console.log("receiver evals:", recvEvals);

// A binding that holds the class for the whole program: the chain proves
// non-nullish once and the member reads through the bound receiver.
const held = pick(true);
console.log("held field:", held?.hits, "held name:", held?.name);
console.log("held string:", held?.label, "held bool:", held?.flag);

// A binding the program leaves empty. A static FIELD read resolves to a
// module global and does not consume its receiver — so this is the whole
// proof that the guard survived: the answer is undefined, not 41.
const gone = pick(false);
console.log("gone field:", gone?.hits);
console.log("gone name:", gone?.name);
console.log("gone string:", gone?.label);
console.log("gone is undefined:", gone?.hits === undefined, gone?.label === undefined);
console.log("receiver evals:", recvEvals);

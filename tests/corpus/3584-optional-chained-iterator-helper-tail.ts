// The TAIL entry, and the result-type half.
//
// `xs?.values().map(f).take(n).toArray()` puts the `?.` deep in the receiver
// spine: JS short-circuits the WHOLE tail with it, so lowerOptionalChain
// enters at the guarded step and lowers everything above it inside the
// guard. Two things follow that the `a?.m()` shape never runs into.
//
// 1. The iterator-helper lowering walks the receiver spine itself, and that
//    walk had its OWN raw `questionDotToken` test. It returned null at the
//    `values()` step whose receiver carries the chain's token — the same
//    root, one level down, and invisible to the census of function-opening
//    guards.
//
// 2. `chainHandled.has(access)` is the WRONG question here. The chain's dot
//    is not `access`; it is several steps below. The terminal reads its own
//    result type off the checker to prove the chain's element and result
//    types agree, and under the chain the checker's type for the call node
//    is the whole chain's `T[] | undefined` — that undefined arm is the
//    GUARD's, and finishOptionalChain adds it back around the whole body.
//    Asking for it here made the lowering demand a union the operation never
//    produces, and it fenced with `.toArray at this result type`. The fix is
//    `inChainBody`, which walks the receiver spine for the chain's marker,
//    and `chainResultType`, which strips the guard's arm when it finds one.
//
// The fused pipeline's LAZY PULL ORDER is the observable this fixture
// protects: each source element flows through every stage before the next is
// touched, and `take` closes the pipeline without pulling upstream again.
// A chain that re-lowered the spine differently would show up as a different
// trace, not as a different answer.

function pick(on: boolean): number[] | undefined {
    return on ? [1, 2, 3, 4, 5, 6] : undefined;
}

const trace: string[] = [];

const doubledTop3 = pick(true)
    ?.values()
    .map((x) => {
        trace.push("map " + String(x));
        return x * 2;
    })
    .take(3)
    .toArray();
console.log("taken:", doubledTop3 === undefined ? "none" : doubledTop3.join(","));
console.log("pull order:", trace.join(" | "));

// The skipped chain must pull NOTHING — not the source, not a single stage.
const before = trace.length;
const skipped = pick(false)
    ?.values()
    .map((x) => {
        trace.push("map(skipped) " + String(x));
        return x * 2;
    })
    .take(3)
    .toArray();
console.log("skipped:", skipped === undefined ? "none" : skipped.join(","));
console.log("stages run while skipped:", trace.length - before);

// filter + drop + a short-circuiting terminal, still through the tail.
console.log(
    "some:",
    String(
        pick(true)
            ?.values()
            .filter((x) => x % 2 === 0)
            .some((x) => x > 3),
    ),
);
console.log(
    "every:",
    String(
        pick(true)
            ?.values()
            .drop(1)
            .every((x) => x > 1),
    ),
);
console.log(
    "find:",
    String(
        pick(true)
            ?.values()
            .map((x) => x * 10)
            .find((x) => x > 25),
    ),
);
console.log(
    "reduce:",
    String(
        pick(true)
            ?.values()
            .map((x) => x + 1)
            .reduce((a, b) => a + b, 0),
    ),
);
console.log(
    "absent reduce:",
    String(
        pick(false)
            ?.values()
            .map((x) => x + 1)
            .reduce((a, b) => a + b, 0),
    ),
);

// entries() seeds the chain with the checker's own [index, element] pairs.
const pairs = pick(true)
    ?.values()
    .map((x) => String(x))
    .toArray();
console.log("mapped to strings:", pairs === undefined ? "none" : pairs.join("-"));

// A forEach terminal is VOID: the chain keeps the statement form.
pick(true)
    ?.values()
    .filter((x) => x > 4)
    .forEach((x) => {
        console.log("forEach saw", x);
    });
pick(false)
    ?.values()
    .filter((x) => x > 4)
    .forEach((x) => {
        console.log("forEach must not run", x);
    });
console.log("done");

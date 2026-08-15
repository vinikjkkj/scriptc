// `typeof` over an operand that cannot be DROPPED.
//
// The fold has always known the answer: FOLD maps every static IR type to
// its JS typeof string. It was gated on `droppableStatic`, which asks a
// different and stricter question -- "may this evaluation be deleted?" --
// so `typeof f()` fell through to
//   SC1090: typeof expressions on statically-typed values
// even though the answer was a compile-time constant and the operand was
// an ordinary expression the program evaluates elsewhere without trouble.
//
// JS evaluates a typeof operand exactly like any other expression and only
// then reports its type, so what the effectful case needed was somewhere
// to PUT the evaluation. `seqExpr` is that place, and it is not new: the
// comma operator builds the identical shape ("left runs for effect, right
// is the value"), and `exprStmt` is already in `seqExprSafeStmt`'s
// straight-line set. The side-effect ORDER is the property under test --
// every row below prints from inside the operand first and the typeof
// answer second, and the interleaving is what a re-lowering or a dropped
// evaluation would break.
//
// NO BIGINT LITERALS (3221's rule, restated by 3542): they are outside the
// LLVM tier and one here would move the whole program to the C lane.

let ticks = 0;

function num(): number {
    ticks += 1;
    console.log("  eval num", ticks);
    return 41 + ticks;
}

function str(): string {
    ticks += 1;
    console.log("  eval str", ticks);
    return "s" + ticks;
}

function flag(): boolean {
    ticks += 1;
    console.log("  eval flag", ticks);
    return ticks % 2 === 0;
}

function rec(): { a: number } {
    ticks += 1;
    console.log("  eval rec", ticks);
    return { a: ticks };
}

function arr(): number[] {
    ticks += 1;
    console.log("  eval arr", ticks);
    return [ticks];
}

function fn(): (n: number) => number {
    ticks += 1;
    console.log("  eval fn", ticks);
    return (n: number): number => n + 1;
}

// One row per FOLD entry that a call can produce. The "eval" line must
// print BEFORE the answer on every one of them.
//
// NOT a row: a call whose declared return is `undefined`/void. Its IR type
// is `void`, which FOLD has no entry for, so it keeps the fence. Node says
// "undefined" and the fold could say so too, but a void-typed operand is
// "there is no value here" rather than "the value is undefined", and that
// is a separate argument from this one. Named, not silently improved.
console.log("num:");
console.log(typeof num());
console.log("str:");
console.log(typeof str());
console.log("flag:");
console.log(typeof flag());
console.log("rec:");
console.log(typeof rec());
console.log("arr:");
console.log(typeof arr());
console.log("fn:");
console.log(typeof fn());

// The operand is evaluated EXACTLY ONCE. A lowering that re-lowered the
// syntax instead of reusing the lowered operand would tick twice here.
console.log("once:");
const before = ticks;
const answer = typeof num();
console.log("ticks moved by", ticks - before, "answer", answer);

// A COMPOSITE operand: the effect is inside, the answer is still static.
console.log("composite:");
console.log(typeof (num() + num()));
console.log(typeof ("x" + str()));
console.log(typeof [num(), num()]);
console.log(typeof { v: num() });

// In a comparison, which is how the idiom is actually written. The
// operand still runs; the comparison is decided on the static answer.
console.log("compared:");
console.log(typeof num() === "number");
console.log(typeof str() === "number");
console.log(typeof rec() === "object");

// In a template and in a ternary condition -- two consumers that read the
// typeof result as a value rather than as a test.
console.log("consumed:");
console.log(`${typeof str()} in a template`);
console.log(typeof flag() === "boolean" ? "yes" : "no");

// A METHOD call and a NEW expression, so the arm is not accidentally
// specific to plain function calls.
class Counter {
    private n = 0;
    bump(): number {
        this.n += 1;
        console.log("  eval bump", this.n);
        return this.n;
    }
}
const counter = new Counter();
console.log("method:");
console.log(typeof counter.bump());
console.log("new:");
console.log(typeof new Counter());

// A UNION-typed call result: several answer groups, so the operand cannot
// ride the tag chain and is bound once instead. The tick count proves the
// binding -- three tests over an unbound operand would evaluate it three
// times.
function maybe(which: number): string | number | undefined {
    ticks += 1;
    console.log("  eval maybe", ticks, which);
    if (which === 0) return "text";
    if (which === 1) return 7;
    return undefined;
}
console.log("union:");
for (let i = 0; i < 3; i += 1) {
    const t0 = ticks;
    console.log(typeof maybe(i), "ticks", ticks - t0);
}

// A union whose arms ALL answer the same way: one answer group, no
// binding, and the operand still evaluates.
function twoObjects(which: number): number[] | { a: number } {
    ticks += 1;
    console.log("  eval twoObjects", ticks);
    return which === 0 ? [1] : { a: 1 };
}
console.log("one group:");
console.log(typeof twoObjects(0));
console.log(typeof twoObjects(1));

console.log("total ticks:", ticks);

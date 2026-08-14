// `return x` from an ASYNC function, where x is the settle-or-value union
// `T | Promise<T>`, awaits the promise arm instead of throwing on it.
//
// The union itself has had a home since the mapper learned the
// settle-or-value contract: `T | Promise<T>` needs no narrowing test
// because its only consumer is `await`, and the union's own tag picks the
// branch. What had no route was the ASYNC RETURN. lowerReturnValue's
// flattening rule tested for a value whose WHOLE type was `promise`, so a
// union CARRYING a promise arm fell through to the ordinary coercion —
// which has no union-to-payload conversion and reached for the checked
// single-arm extraction (narrowedArmHelper). That compiles the promise arm
// to a throw, so
//
//     async function f(x: string | Promise<string>): Promise<string> { return x }
//
// printed the string for `f('a')` and rejected with an UNCODED
// "a 'Promise<string>' value is not representable in the target union"
// TypeError for `f(g())`. No diagnostic code, no census trap — a silent
// wrong answer, which is why the `??` block refused to lift the fence in
// front of it and wrote the four-line reproducer down instead.
//
// The builder was already there: settleOrValueAwait, which `await u`
// reaches from the expression lowering and promiseCoerceAdapter reaches
// for a payload that is itself one of these unions. Only the routing was
// missing, so both emitters learn nothing.
//
// Everything below is awaited SEQUENTIALLY on purpose. `return x` lowers
// as `return await x`, this compiler's long-standing stance for a returned
// promise, and that stance costs one microtask hop — visible only when
// independent chains race, which is a divergence this file is not about.

async function gen(text: string): Promise<string> {
    return `promise:${text}`;
}

// ------------------------------------------ 1. the four-line reproducer

async function f(x: string | Promise<string>): Promise<string> {
    return x;
}

// ------------------------------------------------ 2. a numeric payload

async function fnum(x: number | Promise<number>): Promise<number> {
    return x;
}

// ------------------------- 3. the union-payload form a resolver hook has

async function fopt(x: string | null | Promise<string | null>): Promise<string | null> {
    return x;
}

// --------------- 4. a destination union that carries no promise arm, and
//                    an early return through the ordinary path beside it

async function ftag(x: string | Promise<string>, empty: boolean): Promise<string | null> {
    if (empty) {
        return null;
    }
    return x;
}

// -------------------- 5. the promise-or-absent shape, which always mapped
//                         and must keep answering exactly as it did

async function fabsent(x: Promise<string> | undefined): Promise<string> {
    if (x === undefined) {
        return "absent";
    }
    return x;
}

// ---------------------------------- 6. a REJECTION on the promise arm has
//                                       to reach the caller as a rejection

async function boom(): Promise<string> {
    throw new Error("rejected-arm");
}

async function main(): Promise<void> {
    console.log("lit", await f("literal"));
    console.log("prom", await f(gen("one")));

    console.log("num-lit", await fnum(41 + 1));
    console.log("num-prom", await fnum(Promise.resolve(7)));

    console.log("opt-lit", await fopt("here"));
    console.log("opt-null", await fopt(null));
    console.log("opt-prom", await fopt(gen("two")));

    console.log("tag-lit", await ftag("kept", false));
    console.log("tag-prom", await ftag(gen("three"), false));
    console.log("tag-null", await ftag("ignored", true));

    console.log("absent", await fabsent(undefined));
    console.log("present", await fabsent(gen("four")));

    try {
        await f(boom());
        console.log("no-throw");
    } catch (e) {
        console.log("caught", (e as Error).message);
    }

    // The data arm of a rejecting-arm union still answers plainly.
    console.log("after", await f("still-here"));
}

void main();

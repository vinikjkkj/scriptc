// Executor adoption across every payload representation, plus the two
// facts that separate an adoption from a copy.
//
// The settle-or-value union the resolve parameter is bound to carries one
// arm per payload kind, and the adopt adapter has a separate spelling for
// each: scalars read the union's own f64/bool slot, strings and refcounted
// values take the payload pointer through their own retain, and a payload
// type that is ITSELF a union (`Promise<T | null> | T | null` — what a
// persistence hook takes) is re-tagged into that union before it settles.
// That last one is not hypothetical: on main it is a LOUD SC2003, because
// the executor could not be handed the union at all.
//
// IDENTITY is the assertion that makes "adopt, not copy" observable. An
// adopted object must be the array's/producer's OWN object — `===` true
// against the source, and a mutation through the settled value visible to
// the source. A lift or a dyn conversion would print `false` here.
//
// Sequential awaits again: this file pins values and identity, not the
// interleaving.

type Box = { n: number };

const shared: Box = { n: 7 };

function pnum(n: number): number | Promise<number> {
    return n > 0 ? Promise.resolve(n * 2) : n;
}

function pbool(b: boolean): boolean | Promise<boolean> {
    return b ? Promise.resolve(false) : true;
}

function pbox(n: number): Box | Promise<Box> {
    return n > 0 ? Promise.resolve(shared) : shared;
}

// The union PAYLOAD form. Both `null` and `string` are arms of the promised
// type, so the data arms of the settle-or-value union have to be re-tagged
// into it rather than fulfilled raw.
function pmaybe(n: number): Promise<string | null> | string | null {
    if (n === 0) {
        return null;
    }
    if (n === 1) {
        return "plain";
    }
    return new Promise<string | null>((r) => {
        setTimeout(() => {
            r(n === 2 ? "from-promise" : null);
        }, 3);
    });
}

async function num(n: number): Promise<number> {
    return await new Promise<number>((r) => {
        r(pnum(n));
    });
}

async function bool(b: boolean): Promise<boolean> {
    return await new Promise<boolean>((r) => {
        r(pbool(b));
    });
}

async function box(n: number): Promise<Box> {
    return await new Promise<Box>((r) => {
        r(pbox(n));
    });
}

async function maybe(n: number): Promise<string | null> {
    return await new Promise<string | null>((r) => {
        r(pmaybe(n));
    });
}

async function main(): Promise<void> {
    console.log("num ", await num(3), await num(-1));
    console.log("bool", await bool(true), await bool(false));

    console.log("maybe0", JSON.stringify(await maybe(0)));
    console.log("maybe1", JSON.stringify(await maybe(1)));
    console.log("maybe2", JSON.stringify(await maybe(2)));
    console.log("maybe3", JSON.stringify(await maybe(3)));

    // Identity through the promise arm and through the data arm, and a
    // mutation that has to reach the source object.
    const viaPromise = await box(1);
    const viaValue = await box(0);
    console.log("identity", viaPromise === shared, viaValue === shared, viaPromise === viaValue);
    viaPromise.n = 11;
    console.log("mutation", shared.n, viaValue.n);
}

void main();

// `provided ?? gen()` inside an async function, where `gen()` returns a
// promise: the retagged `??` may now produce a settle-or-value union.
//
// This is zapo's `client/newsletter/messaging.ts:82` almost verbatim —
//
//     async function resolveStanzaId(provided) {
//         return provided ?? deps.generateStanzaId();
//     }
//
// — and it carried an SC1090 for the whole life of the retagged `??`. The
// fence was honest when it was written: the result union `string |
// Promise<string>` mapped fine, but the ASYNC RETURN that consumed it
// compiled the promise arm to an uncoded runtime throw, so admitting the
// `??` here would have retired a census trap and handed the same program a
// silent wrong answer. `estado-sweep.md` §5.3 recorded the refusal and the
// four-line reproducer under it.
//
// The defect was never about `??`. With lowerReturnValue routing a
// settle-or-value union through settleOrValueAwait (3521), the consumer
// reads the shape correctly and the fence retires with no change to the
// re-tag itself: both arms of the union exist in the destination, so the
// arm-wise wrap was always the right lowering.
//
// Awaited sequentially — see 3521 on why.

interface Deps {
    readonly generateStanzaId: () => Promise<string>;
}

let generated = 0;

const deps: Deps = {
    generateStanzaId: async (): Promise<string> => {
        generated += 1;
        return `gen-${String(generated)}`;
    },
};

// ------------------------------------------------ 1. zapo's exact shape

async function resolveStanzaId(provided: string | undefined): Promise<string> {
    return provided ?? deps.generateStanzaId();
}

// -------------------- 2. the default is LAZY: the generator must not run
//                         when the left side is present

async function counted(provided: string | undefined): Promise<string> {
    return provided ?? deps.generateStanzaId();
}

// ---------------------------------- 3. a null-armed left, and a payload
//                                       union on the right

async function withNull(provided: string | null): Promise<string> {
    return provided ?? deps.generateStanzaId();
}

// ------------------------- 4. the union escaping to a SYNC slot that
//                              spells it, then awaited by the caller

function bare(provided: string | undefined): string | Promise<string> {
    return provided ?? deps.generateStanzaId();
}

async function main(): Promise<void> {
    console.log("given", await resolveStanzaId("supplied"));
    console.log("absent", await resolveStanzaId(undefined));

    const before = generated;
    console.log("lazy", await counted("no-call"));
    console.log("lazy-delta", generated - before);
    console.log("eager", await counted(undefined));
    console.log("eager-delta", generated - before);

    console.log("null-given", await withNull("kept"));
    console.log("null-absent", await withNull(null));

    console.log("bare-given", await bare("plain"));
    console.log("bare-absent", await bare(undefined));

    console.log("generated", generated);
}

void main();

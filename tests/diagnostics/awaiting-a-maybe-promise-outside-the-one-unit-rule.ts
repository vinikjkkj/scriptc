/* The `await` over a promise-or-absent union that the dyn/union-payload
 * lowering deliberately does NOT claim, pinned from outside so the
 * boundary is tested by what it refuses.
 *
 * What it claims: a union of exactly ONE promise arm and ONE unit arm,
 * whose payload is the checked-dynamic value or a union — the two shapes
 * `awaitUnionExpr` has no result form for (its result must be `void` or a
 * union). The tag picks the branch, the promise arm parks and the unit arm
 * takes `async.hop`, which is one microtask turn and is what JS does when
 * you await a non-thenable. Corpus 7791.
 *
 * TWO UNIT ARMS is the under-approximation, and it is one line of work
 * rather than an impossibility: the else branch answers with the unit
 * arm's own value, and with `null` AND `undefined` present it would need a
 * second tag test to say which one this value holds. Nothing in the corpus
 * or in zapo writes it, so it is recorded rather than guessed at. Note the
 * SAME three-armed shape over an f64 payload compiles — that one rides
 * `awaitUnionExpr`, whose emitters already switch over the unit tags.
 * The restriction is this lowering's, not the language's.
 *
 * `Promise<void> | null` keeps the fence it already had, and for a
 * different reason: the result would mix an undefined and a null unit with
 * no value-carrying arm at all. That is degenerate rather than unsupported
 * — there is no useful value to bind — and the message says so.
 *
 * An ISLAND payload (`jsval`) is not here because it needs a package to
 * spell, but it is out for a third reason again: crossing the island
 * boundary is its own story and not a re-tag. */

type Row = { readonly k: "a"; readonly n: number } | { readonly k: "b"; readonly s: string };

// Two unit arms over the CHECKED-DYNAMIC payload.
async function twoUnitsDyn(p: Promise<unknown> | null | undefined): Promise<void> {
    const r = await p;
    console.log(r === undefined ? "u" : r === null ? "n" : "v");
}

// Two unit arms over a UNION payload.
async function twoUnitsUnion(p: Promise<Row> | null | undefined): Promise<void> {
    const r = await p;
    console.log(r == null ? "-" : r.k);
}

// The degenerate mix: a void payload beside a null arm.
async function voidBesideNull(p: Promise<void> | null): Promise<void> {
    const r = await p;
    console.log(r === null ? "n" : "u");
}

void twoUnitsDyn(null);
void twoUnitsUnion(null);
void voidBesideNull(null);

export {};

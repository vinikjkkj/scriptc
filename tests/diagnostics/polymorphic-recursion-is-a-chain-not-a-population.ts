/* The two shapes the instantiation cap exists to name, and the one it must
 * not name.
 *
 * Monomorphization terminates when the set of instance keys a program can
 * ask for is finite. Two things can make it infinite, and BOTH are chains:
 * an instance whose body asks for a strictly larger instance of the same
 * generic, and a CYCLE of generics that does the same thing between them.
 * Neither is a population: the counter-example is a program that spells a
 * hundred call sites, each of which terminates, which is breadth and is
 * pinned as a passing program in tests/corpus/7520.
 *
 * 1. SELF polymorphic recursion. `deepen<T>` calls `deepen<T[]>`, so the
 *    key grows by one array wrapper each time round and never repeats. The
 *    chain is bounded at MAX_GENERIC_INSTANCE_DEPTH and named there.
 *
 * 2. MUTUAL polymorphic recursion. `ping<T>` asks for `pong<T[]>` and
 *    `pong<T>` asks for `ping<T[]>`. Neither function ever calls ITSELF at
 *    a new key, so each one's own instance population grows at half the
 *    rate — a per-function population count of 100 would let this run to
 *    200 instances across the pair before naming it, and a cycle of ten
 *    generics to a thousand. The chain does not care how the cycle is
 *    spelled: depth counts links, and every link is one.
 *
 * What the messages must keep saying, and why the wording is part of the
 * fixture: "polymorphic recursion?" is a DEFECT report, and it is a
 * different sentence from the resource backstop's "this build cannot
 * monomorphize further", which is a budget. A reader who sees one must not
 * be able to mistake it for the other.
 */

/* ── 1. self: deepen<T> asks for deepen<T[]> ────────────────────────────── */

function deepen<T>(value: T, rounds: number): number {
    if (rounds <= 0) return 0
    const wrapped: T[] = [value]
    return 1 + deepen(wrapped, rounds - 1)
}

/* ── 2. mutual: ping<T> asks pong<T[]>, pong<T> asks ping<T[]> ──────────── */

function ping<T>(value: T, rounds: number): number {
    if (rounds <= 0) return 0
    const wrapped: T[] = [value]
    return 1 + pong(wrapped, rounds - 1)
}

function pong<T>(value: T, rounds: number): number {
    if (rounds <= 0) return 0
    const wrapped: T[] = [value]
    return 1 + ping(wrapped, rounds - 1)
}

console.log(deepen(1, 3))
console.log(ping('a', 3))

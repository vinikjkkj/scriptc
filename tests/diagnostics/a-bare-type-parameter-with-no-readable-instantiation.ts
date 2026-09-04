/* The three ways a bare `<T>` on a SIGNATURE-ONLY member still refuses.
 *
 * A generic interface method whose type parameter carries no constraint now
 * erases to the union of the types the program instantiates it at
 * (Lowerer.scanUnconstrainedTpArms). That road is deliberately narrow, and
 * the fences below are the edges it declines to cross — every one of them a
 * REFUSAL, never a guess at a slot whose width the scan could not close.
 *
 * 1. NO instantiation at all. The member is declared and never called, so
 *    there is no set to take a union of. A slot invented here would be a
 *    guess about a call the program does not make.
 *
 * 2. A binding that cannot be READ. 7's checker exposes no type-argument
 *    list for an inferred call, so the binding is recovered by walking the
 *    declaration's return type against the resolved one. A signature whose
 *    parameter reaches neither position — it appears only in an argument,
 *    or under a mapped/indexed form the walk does not model — POISONS the
 *    parameter, and a poisoned parameter keeps its fence. Narrowing a slot
 *    on a partial reading is the one failure mode that could be silent.
 *
 * 3. A FILTERING conditional that actually filters. `NonPromise<T>` resolves
 *    under a bound parameter only while every arm survives the filter; an
 *    arm the conditional maps to `never` would need the union rebuilt arm by
 *    arm, which does not reproduce the normalization a whole-union mapping
 *    applies. It answers null instead.
 */

/* ── 1. declared, never called ──────────────────────────────────────── */

interface NeverCalled {
    tag: string
    run<T>(make: () => T): T
}

function useNeverCalled(n: NeverCalled): string {
    return n.tag
}

/* ── 2. the parameter never reaches the return type ─────────────────── */

interface SinkOnly {
    tag: string
    send<T>(value: T): void
}

function useSinkOnly(s: SinkOnly): void {
    s.send(1)
    s.send('two')
}

/* ── 3. a conditional that drops an arm ─────────────────────────────── */

type NotAString<T> = T extends string ? never : T

interface Dropping {
    tag: string
    keep<T>(make: () => NotAString<T>): NotAString<T>
}

function useDropping(d: Dropping): void {
    console.log(d.keep<number>(() => 1))
    console.log(d.keep<string>(() => 'x' as never))
}

const a: NeverCalled = { tag: 'a', run<T>(make: () => T): T { return make() } }
const b: SinkOnly = { tag: 'b', send<T>(value: T): void { console.log(String(value)) } }
const c: Dropping = { tag: 'c', keep<T>(make: () => NotAString<T>): NotAString<T> { return make() } }

console.log(useNeverCalled(a))
useSinkOnly(b)
useDropping(c)

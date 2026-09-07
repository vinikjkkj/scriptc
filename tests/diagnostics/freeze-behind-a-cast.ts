// The REFUSED side of reading `freezeFreshLocal`'s initializer THROUGH the
// casts.
//
// The admitted side is corpus
// 7793-a-fresh-local-behind-a-cast-is-still-fresh.ts: `const acc = [] as
// string[]` is the same allocation, at the same place, as `const acc:
// string[] = []`, so the arm's theorem — "nothing else holds this value
// when the freeze runs, so its frozen bit is unobservable" — is untouched
// by the wrapper, and the initializer test now unwraps `as`, `satisfies`,
// parentheses and the angle-bracket assertion exactly as the argument
// position one function up already does.
//
// The unwrap walks WRAPPERS, never expression forms, and it moves nothing
// else: every other clause of the proof runs on the unwrapped initializer
// unchanged. A predicate tested only on what it accepts is untested, so
// each case below is a cast whose unwrap lands somewhere the arm must
// still refuse, and each one keeps its SC2020.

// ── 1. A CAST OVER ANOTHER BINDING ───────────────────────────────────────
//
// The unwrap reaches an IDENTIFIER, not a literal, so the allocation is
// somebody else's and `shared` still holds it — a write through `shared`
// after the freeze would have to observe the frozen bit. This is the case
// the whole gate exists for, and reading through the cast must not reach
// past the literal test into it.
const shared: string[] = [];
shared.push("a");
const aliased = shared as string[];
console.log(Object.freeze(aliased).join("|"));
shared.push("b");
console.log(aliased.join("|"));

// ── 2. A REFERENCE FROM A NESTED FUNCTION ────────────────────────────────
//
// The initializer IS a literal behind a cast, so the unwrap admits it and
// the rest of the proof takes over — and refuses: a closure captured the
// binding, its run time cannot be bounded, and the write it performs
// happens after the freeze. Unwrapping must not be mistaken for a
// shortcut past the reference walk.
function withEscape(): readonly string[] {
    const acc = [] as string[];
    acc.push("a");
    const later = (): void => {
        acc.push("b");
    };
    const frozen = Object.freeze(acc);
    later();
    return frozen;
}
console.log(withEscape().join("|"));

// ── 3. A FREEZE INSIDE A LOOP THE DECLARATION SITS OUTSIDE OF ────────────
//
// Same literal-behind-a-cast initializer, admitted by the unwrap, refused
// by the clause that follows: the loop runs the earlier mutations again
// after the value was frozen.
function earlyPublish(rows: readonly string[]): readonly string[] {
    const acc = [] as string[];
    for (const r of rows) {
        acc.push(r);
        if (r === "z") {
            return Object.freeze(acc);
        }
    }
    return Object.freeze(acc);
}
console.log(earlyPublish(["a", "z", "b"]).join("|"));

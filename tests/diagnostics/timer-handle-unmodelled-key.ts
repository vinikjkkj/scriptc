// The NEGATIVE half of the opaque-handle `in` fold (corpus
// 7394-typeof-a-timer-handle-is-an-object.ts holds the positive half).
//
// `NodeJS.Timeout` maps to a NUMBER here, so `'k' in t` has no record to
// walk. The fold answers `true` for the four members the interface
// DECLARES — `ref`, `unref`, `hasRef`, `refresh` — because Node's value is
// an object that carries them. It answers nothing at all for any other
// key, and that is deliberate: Node's real Timeout also carries internal
// fields (`_idleTimeout`, `_idlePrev`, `_destroyed`, the symbol-keyed
// async-hooks slots) that this compiler does not model, so folding to
// `false` would trade a refusal for a silent wrong answer — the exact
// trade this whole fold exists to undo.
//
// This file must therefore keep producing SC1090. If it ever compiles, the
// member gate has been widened into a guess.
const t = setInterval(() => {
    console.log("never runs");
}, 100_000);

console.log("internal field:", "_idleTimeout" in t);
clearInterval(t);

export {};

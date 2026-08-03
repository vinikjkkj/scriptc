// @dynamic
// `import()` with a NAMED-CONSTANT specifier — the optional-dependency
// idiom (`const WS_OPTIONAL_MODULE = 'ws'; await import(WS_OPTIONAL_MODULE)`).
// The argument is not a string literal, but its checker type is a string
// LITERAL type: the const pinned the one value the runtime can pass, so the
// module graph is still a build-time artifact and the specifier FOLDS.
// Collection and lowering fold through the same helper, so the site finds
// its embedded module exactly like a literal spelling.
//
// The dynamically-imported module is also imported statically: Node answers
// the import() from the cache, and the compiled program answers it with the
// module's namespace builder — same values, module evaluated once.
import { f, x } from './2707-dynamic-import-const-specifier/mod.ts'

const MOD = './2707-dynamic-import-const-specifier/mod.ts'
const ns = await import(MOD)
console.log(f(), x, ns.x as number, ns.f() as number)

// The module evaluated ONCE (static import first): the side-effect counter
// proves the import() was a cache hit, not a re-evaluation.
console.log(ns.evals as number)

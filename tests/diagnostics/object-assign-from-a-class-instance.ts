/* `Object.assign(target, classInstance)` answered a WRONG VALUE, silently,
 * on both backends, and this is the fence that replaced it.
 *
 * Measured against Node v25.9.0 at bdb51408, `--backend c` and
 * `--backend llvm` alike:
 *
 *     interface I { x: number }
 *     class C implements I { x = 1 }
 *     const c: I = new C()
 *     console.log(Object.assign({ x: 0 }, c).x)
 *
 *     node     1
 *     scriptc  0
 *
 * A fresh object-literal target routes the whole call through the dyn
 * n-ary walk, which copies each source's own enumerable keys. A class
 * instance widens into SCR_DYN_OBJINST, and that box carries the class's
 * IDENTITY — name, preorder interval, RC pair — and no field table, so the
 * walk finds nothing to copy. With a target that declares FEWER fields the
 * read-back dyn-check catches it loudly ("expected number at $.x, got
 * undefined"); with the `Object.assign(defaults, overrides)` idiom the
 * target already holds a same-typed value for every name, the check
 * passes, and the program keeps the DEFAULTS.
 *
 * No cast is needed to reach it. Every spelling below is ordinary
 * TypeScript, and `Object.assign({ x: 0 }, { x: 1 })` (a record source) is
 * unaffected — the corpus fixture 4901 pins that half against Node.
 */
interface I {
    x: number
}

class C implements I {
    x = 1
}

// A widening assignment: the checker says I, the value is a C.
const viaInterface: I = new C()
console.log(Object.assign({ x: 0 }, viaInterface).x)

// A binding annotated with the class's own structural shape.
const viaShape: { x: number } = new C()
console.log(Object.assign({ x: 0 }, viaShape).x)

// An empty target: the shape whose read-back dyn-check already threw, so
// it was loud before and stays loud now — with the reason, at compile time.
const viaEmpty: I = new C()
console.log(JSON.stringify(Object.assign({}, viaEmpty)))

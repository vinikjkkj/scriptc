// The fence this change deliberately KEEPS. `viaGetter` is an accessor: JS
// evaluates the receiver once, so a two-evaluation desugar would call the
// getter twice. This getter hands back a FRESH array each call, so a second
// evaluation would write into an object the program has already discarded --
// a silent wrong answer. It must refuse, not compile.
class Holder {
    calls = 0
    get viaGetter(): number[] {
        this.calls += 1
        return [1, 2, 3]
    }
}
const h = new Holder()
h.viaGetter[1] += 10
console.log('calls=' + String(h.calls))

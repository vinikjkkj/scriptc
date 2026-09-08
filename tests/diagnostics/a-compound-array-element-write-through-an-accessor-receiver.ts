// The fence that survives the field-chain widening of lowerElemCompound.
//
// `a[i] op= e` re-lowers the receiver once for the read and once for the write,
// so it is admitted only when the receiver is REPEATABLE: an identifier, `this`,
// or a chain of plain data fields over them. A field read runs no user code, so
// doing it twice is indistinguishable from doing it once.
//
// An accessor link is not repeatable and must keep refusing. JS evaluates the
// member expression's object exactly once; a two-evaluation desugar would call
// this getter twice, and because it hands back a FRESH array each call the
// write would land on an object the program has already discarded. That is a
// silent wrong answer, which is worse than a refusal.
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

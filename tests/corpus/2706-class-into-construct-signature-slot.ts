// The VALUE side of the constructable-over-interface slot — 2700 opened the
// TYPE (`new (…) => Iface` maps to a func type); this opens the flows through
// it. A class entering the slot becomes a construct THUNK: a zero-capture
// closure of the slot's exact signature whose body constructs the class and
// projects the fresh instance into the interface record. `new` through the
// slot IS the thunk call.
//
// The projection is the witness stance where a method satisfies the field
// (closures bound to the one instance the thunk just built — state shared,
// freshness by construction: the instance never escapes nominally), the
// width-copy stance where a data field does, and the undefined arm where an
// optional-flavored field has no source. The thunk is interned per
// (class, signature) and zero-capture, so the closure is one runtime value:
// two coercions of the same class stay `===`, exactly Node's class object.

interface Made {
    readonly tag: string
    count(): number
    bump(n: number): void
    readonly note?: string
}

interface MadeCtor {
    new (tag: string, start?: number): Made
}

class Impl {
    public readonly tag: string
    private n: number
    public constructor(tag: string, start?: number) {
        this.tag = tag
        this.n = start ?? 0
    }
    public count(): number {
        return this.n
    }
    public bump(n: number): void {
        this.n += n
    }
}

function make(ctor: MadeCtor, tag: string): Made {
    return new ctor(tag)
}

// Coercion at a call argument; `new` through the param with the optional
// slot param omitted (the thunk completes the ctor's own optional).
const a = make(Impl, 'a')
console.log(a.tag, a.count(), a.note ?? '(none)')

// State is SHARED through the witness closures: mutation through one field
// is visible to the next call.
a.bump(3)
a.bump(4)
console.log(a.count())

// `new` with the optional argument present rides the same thunk.
function makeAt(ctor: MadeCtor, tag: string, start: number): Made {
    return new ctor(tag, start)
}
const b = makeAt(Impl, 'b', 10)
b.bump(1)
console.log(b.tag, b.count())

// Two witnesses of different constructions keep their own state.
console.log(a.count(), b.count())

// The thunk is interned and zero-capture: two coercions of the same class
// are one value, exactly the one class object Node hands both slots.
const f1: MadeCtor = Impl
const f2: MadeCtor = Impl
console.log(f1 === f2)

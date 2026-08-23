// [[Get]] over the `%props` table of a class WITH A BASE -- and through a
// box that names the BASE, which is the cell that decides which rule is
// sound.
//
// WHY THIS PROGRAM EXISTS: 6090's arm was gated to STANDALONE classes,
// because a box's `cls` is the descriptor of the STATIC type the value was
// boxed FROM. A `D` in a `B`-typed slot boxes as `B`, so testing the box's
// descriptor for identity answers "not a D" for an object that is one --
// and every class with a base was therefore refused an arm and kept the
// fence. In zapo that is its ONLY table-carrying class, `WaClientImpl`,
// which has a base because every EventEmitter subclass does.
//
// The descriptor is not the only thing the box carries. A hierarchy
// instance carries its VTABLE, and the class's own preorder position is
// read out of it -- the same position `instanceof` compares. Testing THAT
// against the descriptor's interval makes the answer a fact about the
// OBJECT and never about the declared type of a slot it passed through,
// which is the property the identity test could not have.
//
// WHAT THIS PROGRAM CANNOT REACH, deliberately: a class BELOW the one that
// grew the table. The frontend refuses a table on a class that HAS A
// SUBCLASS (SC2020, "the closed member set the collision check reads is
// not exact"), so every table-carrying class is a LEAF and its preorder
// interval is a single point. tests/harness/class-runtime-property-table
// pins that refusal; the interval spelling in the runtime is what keeps
// this correct if the frontend's leaf rule is ever relaxed.
//
// Keys are never literals: `process.argv.length > 99` is false in every
// run, so the values are fixed while nothing about them is known at
// compile time. A literal key would let a folding path answer without ever
// reaching the table.
class B {
  a: number
  constructor() { this.a = 1 }
}
class D extends B {
  b: number
  constructor() { super(); this.b = 2 }
}

const rt = (s: string): string => (process.argv.length > 99 ? 'zz' + s : s)

const d = new D()
Object.defineProperty(d, rt('dK'), { value: 5, enumerable: true, writable: true, configurable: true })
Object.defineProperty(d, rt('gK'), { get: () => 9, enumerable: true, configurable: true })
Object.defineProperty(d, rt('hK'), { value: 7, enumerable: false, writable: true, configurable: true })

// Read through a box of the instance's OWN declared type.
const rd = d as unknown as Record<string, unknown>
console.log('own ' + String(rd[rt('dK')]))
console.log('owng ' + String(rd[rt('gK')]))
console.log('ownh ' + String(rd[rt('hK')]))

// Read through a box that names the BASE. `up` is typed `B`, so the box
// carries B's descriptor -- and B has no table at all. Only the vtable
// says this object is a D. This is the cell an identity test on the box's
// descriptor gets WRONG (it fences), and the one the whole rule is for.
const up: B = d
const ru = up as unknown as Record<string, unknown>
console.log('viaBase ' + String(ru[rt('dK')]))
console.log('viaBaseG ' + String(ru[rt('gK')]))

// A base-typed PARAMETER is the same question one call deep, and it is the
// shape a real program reaches it by.
const readThrough = (x: B, key: string): string => String((x as unknown as Record<string, unknown>)[key])
console.log('viaParam ' + readThrough(d, rt('dK')))

// Two instances of the same class do not share a table.
const d2 = new D()
Object.defineProperty(d2, rt('dK'), { value: 42, enumerable: true, writable: true, configurable: true })
console.log('perInstance ' + String((d2 as unknown as Record<string, unknown>)[rt('dK')]) +
  ' ' + String(rd[rt('dK')]))

// A later define on the same instance, then a re-read of an earlier key.
Object.defineProperty(d, rt('lateK'), { value: 11, enumerable: true, writable: true, configurable: true })
console.log('late ' + String(rd[rt('lateK')]))
console.log('still ' + String(rd[rt('dK')]))

// A getter that throws still propagates catchably through the hierarchy
// arm: `scr_cls_props_get` answers NULL for a miss and for a throw alike,
// and only the pending exception tells them apart. Through the BASE-typed
// box, so the throw crosses the arm this program added.
Object.defineProperty(d, rt('boom'), {
  get: () => { throw new Error('from the derived getter') },
  enumerable: true, configurable: true,
})
try {
  console.log('boom ' + String(ru[rt('boom')]))
} catch (err) {
  console.log('boom CAUGHT ' + (err as Error).message)
}

// A MISS is still the FENCE, not `undefined`, for exactly 6090's reason: a
// declared member and an absent key are the same NULL out of the table, so
// answering `undefined` for a miss would answer `undefined` for `d.a`. It
// has no cell here because a corpus program is scored against Node, which
// answers both; the harness carries it.
console.log('end')

// Reading back a run-time-keyed property off a class instance -- [[Get]]
// over the `%props` table 5990 fills.
//
// WHY THIS PROGRAM EXISTS: `scr_cls_props_get` shipped end to end with no
// caller. The header called it "[[Get]]'s contribution" and nothing called
// it, so `c[k]` for a key the program had JUST defined on `c` refused with
// `a property read on a dynamic C is not supported yet` while `k in c`,
// util.inspect and the enumerable count all read the same table one line
// away. Four answers were unreachable: a data property's value, an
// accessor's getter, a set-only accessor's `undefined`, and a
// non-enumerable property (which `in` reports and inspect hides, so it was
// the one nothing at all could observe).
//
// The read has to go through a WIDENING cast, because that is the only
// spelling a class receiver has for a run-time key: the declared member set
// is closed and a string variable names none of it. That cast boxes the
// instance as SCR_DYN_OBJINST, and the boxed read is what grew the arm.
//
// The key is deliberately not a literal: `process.argv.length > 99` is
// false in every run, so the values are fixed, but nothing about them is
// known at compile time. A literal key would let a folding path answer
// without ever reaching the table.
class C {
  a: number
  constructor() { this.a = 1 }
}

const rt = (s: string): string => (process.argv.length > 99 ? 'zz' + s : s)
const c = new C()
const r = c as unknown as Record<string, unknown>

Object.defineProperty(c, rt('dataK'), { value: 5, enumerable: true, writable: true, configurable: true })
Object.defineProperty(c, rt('getK'), { get: () => 9, enumerable: true, configurable: true })
Object.defineProperty(c, rt('setK'), { set: (_v: unknown) => {}, enumerable: true, configurable: true })
Object.defineProperty(c, rt('hidK'), { value: 7, enumerable: false, writable: true, configurable: true })

// A data property answers its value.
console.log('data ' + String(r[rt('dataK')]))
// An accessor RUNS its getter -- the table calls it with no receiver, which
// is sound only because the lowering admits an arrow and nothing else.
console.log('get ' + String(r[rt('getK')]))
// A set-only accessor reads `undefined`. That is JS's answer, not a fence:
// the property EXISTS and its [[Get]] is undefined.
console.log('setonly ' + String(r[rt('setK')]))
// Enumerability is about ENUMERATION and says nothing about [[Get]].
console.log('hidden ' + String(r[rt('hidK')]))

// The table survives a second define on the same instance, and a later
// define does not disturb an earlier read.
Object.defineProperty(c, rt('lateK'), { value: 11, enumerable: true, writable: true, configurable: true })
console.log('late ' + String(r[rt('lateK')]))
console.log('still ' + String(r[rt('dataK')]))

// A getter that THROWS propagates catchably, and the throw must not be
// swallowed into the fence: `scr_cls_props_get` answers NULL for a miss and
// for a throw alike, and only the pending exception tells them apart.
Object.defineProperty(c, rt('boom'), {
  get: () => { throw new Error('from the getter') },
  enumerable: true, configurable: true,
})
try {
  console.log('boom ' + String(r[rt('boom')]))
} catch (e) {
  console.log('boom CAUGHT ' + (e as Error).message)
}

// A MISS is the FENCE, not `undefined`, and that divergence from Node is
// deliberate -- a class instance's DECLARED members are struct cells the
// box cannot reach, so answering `undefined` for a miss would answer
// `undefined` for `c.a` too. It has no cell here because a corpus program
// is scored against Node; `tests/harness/class-runtime-property-table.ts`
// carries it, with the reasoning.
console.log('end')

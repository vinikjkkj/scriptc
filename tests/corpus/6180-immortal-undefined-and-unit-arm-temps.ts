// The four emitted temps whose value is an IMMORTAL static, kept alive
// across a throw so the unwind ladder would have released them.
//
// WHY THIS PROGRAM EXISTS: `newImmortalTemp` was introduced for interned
// string literals, whose static carries `rc == SIZE_MAX`, so its retain and
// every frame release of it are runtime no-ops. Two other emitted values are
// immortal by exactly the same construction and still went through
// `newTemp`: `scr_dyn_undefined()` returns THE one static `ScrDyn undef =
// { SIZE_MAX, ... }`, and a unit-armed `unionWrap` yields the interned
// per-(union, tag) `static ScrUnion sc_unit_N = { .rc = SIZE_MAX, ... }`.
// The emitter wrote a retain and a release for both.
//
// Eliding a release is exactly the change that can turn into a leak or a
// use-after-free if the value is NOT immortal, so this exercises all four
// producers in a shape where the elided release WOULD have run: each value
// is created, then a may-throw call unwinds past it into a catch, and then
// the same values are read back. If any of them had been a real reference,
// the count printed after the catch would differ from Node's.
//
//   1. a bare `undefined` into an `unknown` index signature   (dynFrom unitLit)
//   2. a void call beside them (storing a VOID VALUE under an `unknown`
//      index signature is SC1100 on both backends, so the dynFrom-void arm
//      is only reachable through other shapes and this program observes the
//      call's effect instead)
//   3. the undefined arm of `string | undefined`              (unionWrap unit)
//   4. a void call wrapped into an undefined arm              (unionWrap void)

const bag: Record<string, unknown> = {}

function nothing(): void {
  bag.touched = true
}

function boom(n: number): number {
  if (n > 1) throw new Error('boom ' + String(n))
  return n
}

function maybe(flag: boolean): string | undefined {
  return flag ? 'yes' : undefined
}

function voidArm(flag: boolean): string | undefined {
  if (flag) return 'set'
  return undefined
}

let caught = 0
for (let i = 0; i < 4; i++) {
  try {
    // 1: the immortal undefined dyn, live across the throw below
    bag['u' + String(i)] = undefined
    // 2: the effect of a void call, kept beside the immortals (storing the
    // VOID VALUE itself under an `unknown` index signature is SC1100 on both
    // backends today, so the program observes the effect instead)
    nothing()
    // 3: the interned unit arm of a `string | undefined`
    const m = maybe(i % 2 === 0)
    // 4: the same arm reached through a void-returning path
    const w = voidArm(i % 3 === 0)
    // the unwind: every temp above is still in a live frame here
    const k = boom(i)
    bag['k' + String(i)] = k
    bag['m' + String(i)] = m === undefined ? 'none' : m
    bag['w' + String(i)] = w === undefined ? 'none' : w
  } catch (e) {
    caught++
    bag['e' + String(i)] = e instanceof Error ? e.message : 'not an error'
  }
}

// read every immortal back after the unwinds
const keys = Object.keys(bag).sort()
console.log(JSON.stringify(bag))
console.log('keys', keys.length, 'caught', caught)
console.log('u0 present', 'u0' in bag, 'value', bag.u0 === undefined)
console.log('touched', bag.touched)
console.log('m0', bag.m0, 'w0', bag.w0)

// and once more, so an over-released immortal would have been freed by now
const again: Record<string, unknown> = {}
for (let i = 0; i < 3; i++) {
  again['x' + String(i)] = undefined
  again['y' + String(i)] = maybe(false)
}
console.log(JSON.stringify(again), Object.keys(again).length)

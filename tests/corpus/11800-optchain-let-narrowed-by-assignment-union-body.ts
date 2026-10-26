// A `let` receiver assigned once, then read by closures created after that
// assignment: TypeScript keeps the narrowing inside them, so `cm?.getComms()`
// is checked as `Comms | null` with no undefined arm. The short-circuit is
// still real in the compiled program's own slot, so `?.` must answer
// undefined for a nullish receiver and `?? null` must turn it into null.
class Comms {
  n: number
  constructor(n: number) { this.n = n }
  stopComms(): void { console.log("stop", this.n) }
  id(): number { return this.n }
}
class Mgr {
  private comms: Comms | null
  constructor(c: Comms | null) { this.comms = c }
  getComms(): Comms | null { return this.comms }
}

function factory(seed: Comms | null) {
  let cm: Mgr | null = null
  cm = new Mgr(seed)
  const getComms = (): Comms | null => cm?.getComms() ?? null
  const stopIt = (): void => { void cm?.getComms()?.stopComms() }
  const ids = (): number | null => cm?.getComms()?.id() ?? null
  return { getComms, stopIt, ids }
}

// Closures created BEFORE the assignment: the receiver really is null first.
function lateFactory() {
  let cm: Mgr | null = null
  const getComms = (): Comms | null => cm?.getComms() ?? null
  const stopIt = (): void => { void cm?.getComms()?.stopComms() }
  const before = getComms()
  cm = new Mgr(new Comms(7))
  return { getComms, stopIt, before }
}

// An undefined receiver (declared with the undefined arm).
function undefFactory() {
  let cm: Mgr | undefined = undefined
  const ids = (): number | null => cm?.getComms()?.id() ?? null
  const before = ids()
  cm = new Mgr(new Comms(9))
  return { ids, before }
}

const a = factory(new Comms(3))
console.log("A1", a.getComms() !== null, a.ids())
a.stopIt()
const b = factory(null)
console.log("A2", b.getComms() === null, b.ids())
b.stopIt()

const l = lateFactory()
console.log("L1", l.before === null, l.getComms() !== null)
l.stopIt()

const u = undefFactory()
console.log("U1", u.before, u.ids())

// The one shape the run-time table CANNOT hold, and it refuses LOUDLY
// rather than answering: a run-time key that names a member the class
// DECLARES.
//
// WHY THIS PROGRAM EXISTS: Node replaces the field with an accessor. This
// representation cannot -- the declared member is a typed C cell and the
// table is beside it, so honouring the define would leave TWO properties
// of one name and every statically-typed read would still see the field.
// That is exactly the silent wrong answer this project ranks above every
// other, so the define throws with a message naming the collision.
//
// The catch is what makes this program comparable against Node at all:
// Node does not throw here, so the two sides print different words for the
// first two attempts. What IS asserted is that the refusal is loud and
// catchable, that it does not corrupt the instance -- the declared field
// still reads its own value -- and that a FREE key beside it still lands.
// The differential compares this file's own normalized words, not Node's.
class C {
  a: number
  constructor() { this.a = 1 }
}

function attempt(c: C, k: string): string {
  try {
    Object.defineProperty(c, k, { get: () => 'x', enumerable: true, configurable: true })
    return 'defined'
  } catch (e) {
    const m = (e as Error).message
    return m.indexOf('names a member the class DECLARES') >= 0 ? 'refused' : 'other'
  }
}

const c = new C()
const free = process.argv.length > 99 ? 'zz' : 'free'
console.log('free ' + attempt(c, free))
console.log('field ' + String(c.a))
console.log('free-in ' + String(free in c))
console.log(c)

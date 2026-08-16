// THE CONJUNCTION. This is the fixture the suite did not have.
//
// 4032 pins the forcing `!`; 4031 pins the prototype-walking record read.
// Each passed on a tree that had only its own fix -- and that is exactly
// how a shipped-and-broken configuration got past every instrument we
// own, because zapo needs BOTH and nothing pinned the pair.
//
//   `!` fenced, no walk      -> `make` is never assigned  (throws)
//   `!` lowered, no walk     -> `toNumber` comes back missing (throws)
//   `!` fenced, walk         -> `make` is never assigned  (throws)
//   both                     -> `7 0 false 7`, Node's bytes
//
// The trap census reads 57/47/0 in the first two rows and 56/46/0 in the
// last two, so it puts a BROKEN configuration on the better-looking side.
// This program is the instrument that does not.
import { make } from "bangprotolong"

interface LongLike {
  low: number
  high: number
  unsigned: boolean
  where: string
  toNumber(): number
}

const v = make(7, 0) as LongLike
console.log(v.where, v.low, v.high, v.unsigned, v.toNumber())

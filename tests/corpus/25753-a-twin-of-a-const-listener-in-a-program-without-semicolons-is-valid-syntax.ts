// A listener declared as a const arrow in a program written without semicolons: its twin declaration must end the statement first, or the twin load is a syntax error and the typed listener keeps serving a dynamic emit.
import { EventEmitter } from "node:events"

class Box extends EventEmitter { n = 0; label = "a" }
const b = new Box()
const loose: any = b
loose.n = "str"
const hold: { v: any } = { v: b }

const listener = (v: number) => {
  console.log("ident", typeof v, v + 1)
}
const second = (s: string): void => { console.log("second", typeof s, s + "!") }
b.on("x", listener)
b.on("y", second)
const em = hold.v
em.emit.apply(em, ["x", "5"])
em.emit.apply(em, ["y", 6])
console.log(String(loose.n))

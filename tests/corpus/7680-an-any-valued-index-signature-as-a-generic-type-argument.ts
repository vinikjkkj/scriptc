// `{ [key: string]: any }` as the type ARGUMENT of a generic class, at two
// reached instantiations, plus the `Record<string, any>` spelling of the
// same shape and a hybrid that declares a field beside the signature.
// mongodb's `Document` is this type, and it is what every operation in its
// tree is parameterised on.
interface Doc { [key: string]: any }
interface Cfg { name: string; [key: string]: any }
type Bag = Record<string, any>

class Box<T> {
  v: T
  constructor(v: T) { this.v = v }
  get(): T { return this.v }
}
class DocBox extends Box<Doc> {
  constructor() { super({ a: 1, b: 'two' }) }
}
class CfgBox extends Box<Cfg> {
  constructor() { super({ name: 'c', z: 3 }) }
}
class BagBox extends Box<Bag> {
  constructor() { super({ k: true }) }
}

function label<T>(b: Box<T>): string { return typeof b.get() }

const d = new DocBox()
const c = new CfgBox()
const g = new BagBox()
console.log(String(d.get().a), String(d.get().b))
console.log(c.get().name, String(c.get().z))
console.log(String(g.get().k))
console.log(label(d), label(c), label(g))
// The declared field of the hybrid keeps its own static type.
const nm: string = c.get().name
console.log(nm.toUpperCase())

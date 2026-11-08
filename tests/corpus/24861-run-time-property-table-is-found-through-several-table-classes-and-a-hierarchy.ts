// The run-time property table of a class instance (Object.defineProperty with a run-time key) read back through an untyped slot, with
// several classes carrying one, a leaf subclass of a base with none held in a base-typed slot, a class with none, a declared member,
// a miss, a getter, and a literal key and a computed key for each.
const k = process.argv.length > 99 ? 'zz' : 'plug'
class A { id = 1; tag = 'a' }
class B { id = 2; tag = 'b'; who() { return 'B' + this.id } }
class Base { id = 3; kind = 'base' }
class Leaf extends Base { extra = 'leaf'; who() { return 'leaf' + this.id } }
class Plain { id = 9; tag = 'plain' }
const a = new A(), b = new B(), leaf = new Leaf(), plain = new Plain()
Object.defineProperty(a, k, { value: 'av', enumerable: true, writable: true, configurable: true })
Object.defineProperty(b, k, { get: () => 'bget', enumerable: true, configurable: true })
Object.defineProperty(leaf, k, { value: 'lv', enumerable: true, writable: true, configurable: true })
const slots: any[] = [a, b, leaf, plain]
const asBase: any = leaf
function lit(o: any): string { return String(o.id) + ',' + String(o.tag) + ',' + String(o.plug) + ',' + String(o.nothing) }
function comp(o: any, key: string): string { return String(o[key]) }
const out: string[] = []
for (let r = 0; r < 2; r++) {
  for (const o of slots) out.push(lit(o) + '|' + comp(o, k) + '|' + comp(o, 'id') + '|' + comp(o, 'tag'))
  out.push(String(asBase.id) + String(asBase.kind) + String(asBase.plug) + String(asBase['plug']) + typeof asBase.who)
}
console.log(out.join('\n'))

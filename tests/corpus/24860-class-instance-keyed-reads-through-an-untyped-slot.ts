// Keyed reads of class instances through an untyped slot: a declared field, a method, a miss, one key on two classes, a hierarchy
// instance in a base-typed box, a computed key, and a method read again after a different class used the same key.
class Base { id = 1; kind = 'base'; who() { return 'base:' + this.id } }
class Derived extends Base { extra = 'e'; who() { return 'derived:' + this.id } }
class Plain { id = 7; flags = 3; name = 'plain'; who() { return 'plain' } }
class Late { id = 9; tag?: string }
const bag: any[] = [new Base(), new Derived(), new Plain(), new Late(), new Base()]
function field(o: any): unknown { return o.id }
function kind(o: any): unknown { return o.kind }
function who(o: any): unknown { return typeof o.who === 'function' ? o.who() : 'none' }
function miss(o: any): unknown { return o.nothing }
function dyn(o: any, k: string): unknown { return o[k] }
let out: string[] = []
for (let round = 0; round < 3; round++) {
  for (const o of bag) out.push([field(o), kind(o), who(o), String(miss(o)), String(dyn(o, 'flags')), String(dyn(o, 'extra'))].join(','))
  bag[3].tag = 'set' + round
  out.push(String(bag[3].tag) + '/' + String((bag[3] as any).tag))
}
console.log(out.join('\n'))

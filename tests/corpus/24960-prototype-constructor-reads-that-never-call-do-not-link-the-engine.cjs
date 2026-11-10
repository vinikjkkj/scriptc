// Reading, testing and comparing a prototype's `constructor` (lodash's isPlainObject, `this.redis.constructor.name`, an identity test) never runs
// text, so none of it needs the embedded engine; the program also makes a dynamic call and uses regular expressions, the two things that used to
// link and boot it. Every answer is Node's.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  if (proto === null) return true
  const Ctor = proto.constructor || null
  return typeof Ctor === 'function' && Ctor === Object
}
class Redis { constructor() { this.n = 1 } }
class Pipeline extends Redis {}
function nameOf(x) { return x.constructor.name }
function sameClass(a, b) { return a.constructor === b.constructor }
function callIt(g, v) { return g(v) }
const r = new Redis()
const p = new Pipeline()
console.log(isPlainObject(JSON.parse('{"a":1}')), isPlainObject(r), isPlainObject(Object.create(null)), isPlainObject([1]), isPlainObject('x'))
console.log(nameOf(r), nameOf(p), nameOf({}), nameOf([]), sameClass(r, p), sameClass(r, new Redis()))
console.log(callIt((a) => a + 40, 2), callIt((a) => a * 2, 7), /a(b+)c/.test('xabbbc'), 'a-b-c'.replace(/-/g, '+'), 'k1=v1;k2=v2'.split(/;/).length)
const proto = Object.getPrototypeOf(p)
console.log(proto.constructor === Pipeline, typeof proto.constructor, String(proto.constructor.name))

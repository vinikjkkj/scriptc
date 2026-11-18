// After D.prototype.constructor = M the prototype object of a D instance answers M for `.constructor`; only the direct
// `Object.getPrototypeOf(x).constructor` read is modelled (as x.constructor). Keeping the prototype object in a variable and reading it
// later would answer D, so that use is refused.
class M {
  hello() {
    return 'hi'
  }
}
class D {
  constructor() {
    this.n = 1
  }
}
D.prototype.constructor = M
const d = new D()
const p = Object.getPrototypeOf(d)
console.log(p.constructor.name)

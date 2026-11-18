// D.prototype.constructor = M: an instance of D reads M through .constructor (identity, name, typeof), `instanceof` still follows the real
// prototype chain, and util.inspect labels the instance with the first prototype whose own `constructor` the instance is an instance of:
// here none but Object's, so no label.
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
console.log(d.constructor.name)
console.log(d.constructor === M, d.constructor === D)
console.log(d instanceof D, d instanceof M)
console.log(d)
console.log(typeof d.constructor)

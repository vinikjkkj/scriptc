// D extends B and D.prototype.constructor = B: an instance of D IS an instance of B, so util.inspect accepts that constructor and prints
// the label B; `.constructor` answers B and the name follows.
class B {
  constructor() {
    this.b = 1
  }
}
class D extends B {
  constructor() {
    super()
    this.d = 2
  }
}
D.prototype.constructor = B
const d = new D()
console.log(d.constructor.name, d.constructor === B, d.constructor === D)
console.log(d)
console.log(d instanceof D, d instanceof B)

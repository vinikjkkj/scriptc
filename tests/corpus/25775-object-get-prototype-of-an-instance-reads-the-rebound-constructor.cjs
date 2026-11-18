// Object.getPrototypeOf(x).constructor is the first own `constructor` up x's chain: after D.prototype.constructor = M it is M for a D
// instance, and the subclass's own class for an instance of S extends D. Identity, name and typeof all follow.
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
class S extends D {
  constructor() {
    super()
    this.s = 2
  }
}
D.prototype.constructor = M
const d = new D()
const s = new S()
console.log(Object.getPrototypeOf(d).constructor === M, Object.getPrototypeOf(d).constructor === D)
console.log(Object.getPrototypeOf(d).constructor.name, typeof Object.getPrototypeOf(d).constructor)
console.log(Object.getPrototypeOf(s).constructor === S, Object.getPrototypeOf(s).constructor === M)
console.log(Object.getPrototypeOf(s).constructor.name, Object.getPrototypeOf(new D()).constructor.name)
console.log(Object.getPrototypeOf(d).constructor === d.constructor, Object.getPrototypeOf(s).constructor === s.constructor)

// S extends D where D.prototype.constructor = M: S.prototype owns its own `constructor`, so an S instance answers S and prints S, while a
// D instance answers M and prints no label.
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
console.log(d.constructor.name, s.constructor.name)
console.log(d.constructor === M, s.constructor === S, s.constructor === M)
console.log(s)
console.log(s instanceof S, s instanceof D, s instanceof M)

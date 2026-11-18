// `D.prototype.constructor` read after D.prototype.constructor = M: the class's prototype object is not a value this compiler holds
// (the read is refused, never answered with D).
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
console.log(D.prototype.constructor === M)

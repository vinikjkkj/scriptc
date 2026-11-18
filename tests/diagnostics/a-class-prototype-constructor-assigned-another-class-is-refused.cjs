// Assigning another class to C.prototype.constructor changes x.constructor.name and the label console.log(x) prints, which this
// compiler answers from the class itself. The write was compiled as plain prototype data, so `x.constructor === M` held while
// `x.constructor.name` and the inspect label still said the class's own name. Refused rather than compiled wrong.
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
console.log(d.constructor.name, d)

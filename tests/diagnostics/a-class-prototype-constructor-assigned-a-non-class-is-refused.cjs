// Assigning a value that is not a program class (here the runtime's Object) to C.prototype.constructor changes x.constructor.name and the label console.log(x)
// prints, which this compiler answers from the class itself (a class value is modelled: corpus rows 25770-25774). A non-class value was
// compiled as plain prototype data, so an identity test held while `x.constructor.name` and the inspect label still said the class's
// own name. Refused rather than compiled wrong.
class D {
  constructor() {
    this.n = 1
  }
}
D.prototype.constructor = Object
const d = new D()
console.log(d.constructor.name, d)

// A value typed by the base class holds either a base instance or an instance of the rebinding subclass: `.constructor` and its name are
// decided per instance at run time, never from the static type.
class Base {
  constructor() {
    this.k = 0
  }
}
class Other {
  noop() {}
}
class Mid extends Base {
  constructor() {
    super()
    this.m = 1
  }
}
Mid.prototype.constructor = Other
function describe(x) {
  return x.constructor.name + ' ' + (x.constructor === Other) + ' ' + (x.constructor === Base) + ' ' + (x.constructor === Mid)
}
const list = [new Base(), new Mid(), new Base(), new Mid()]
for (const v of list) console.log(describe(v))

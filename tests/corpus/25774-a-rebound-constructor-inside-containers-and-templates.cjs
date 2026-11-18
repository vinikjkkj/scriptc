// The rebound answer reached through containers, a template string, a method and a getter: all read the same per-instance constructor.
class Other {
  noop() {}
}
class Item {
  constructor(id) {
    this.id = id
  }
  kind() {
    return this.constructor.name
  }
  get tag() {
    return `<${this.constructor.name}:${this.id}>`
  }
}
Item.prototype.constructor = Other
const a = new Item(1)
const b = new Item(2)
console.log(a.kind(), b.tag, `${a.constructor.name}`)
console.log([a, b])
console.log({ first: a })
console.log(a.constructor === b.constructor, a.constructor === Other)

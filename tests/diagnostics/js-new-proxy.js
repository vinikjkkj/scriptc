// new Proxy over a class instance is refused by name: the instance is not a
// checked-dynamic object, so a trap could not see its own fields.
class Box {
  constructor() {
    this.k = 1;
  }
}
const p = new Proxy(new Box(), {});
console.log(p.k);

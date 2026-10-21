// OPEN DEFECT, pinned as the refusal it is. Reflect.ownKeys over a class
// instance (or a function) has no lowering: the instance's own key set depends
// on the fields the constructor creates, which the struct model does not list
// as a runtime key set. Records, checked-dynamic objects and arrays lower.
class C {
  constructor() {
    this.z = 1;
    this.y = 2;
  }
  m() {}
}
console.log(Reflect.ownKeys(new C()));

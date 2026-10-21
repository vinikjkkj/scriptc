// OPEN DEFECT, pinned as the refusal it is. A constructor that assigns an own
// function over a method the SAME class declares has two implementations to
// merge into one vtable slot (the inherited-method form lowers: corpus 8061).
class C {
  constructor() {
    this.hi = function () {
      return "own";
    };
  }
  hi() {
    return "proto";
  }
}
console.log(new C().hi());

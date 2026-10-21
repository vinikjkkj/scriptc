// OPEN DEFECT, pinned as the refusal it is. A static member has no instance to
// carry the captured values, so a class whose static method reads an
// enclosing local stays refused.
function make(n) {
  class Box {
    static twice() {
      return n * 2;
    }
  }
  return Box.twice();
}
console.log(make(4));

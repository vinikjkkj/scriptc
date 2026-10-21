// OPEN DEFECT, pinned as the refusal it is. Each call of the function mints a
// distinct class, so returning the class (or testing instanceof against it
// from a second call) is observable; only new/extends/static-method uses lower
// for a class declared in a function.
function two() {
  class K {}
  return K;
}
console.log(two() === two());

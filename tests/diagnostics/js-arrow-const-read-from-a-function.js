// OPEN DEFECT, pinned as the refusal it is. A module-level const holding an
// arrow whose parameters carry no annotation has no static storage (its
// type `(x: any) => any` maps nowhere), so a function declaration that
// reads it has nothing to bind. This program used to compile and throw
// "the reference to 'fst' (a binding form with no lowering)" when probe()
// ran; Node prints 2.
const fst = (x) => x;
function probe() {
  return fst(2);
}
console.log(probe());

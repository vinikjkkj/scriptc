// OPEN DEFECT, pinned as the refusal it is. A class declared inside a
// function that closes over one of the function's locals is minted afresh by
// every call with its own captured environment; only classes that capture
// nothing lower (as module-level classes).
function cap(n) {
  class C {
    get() {
      return n;
    }
  }
  return new C().get();
}
console.log(cap(3), cap(4));

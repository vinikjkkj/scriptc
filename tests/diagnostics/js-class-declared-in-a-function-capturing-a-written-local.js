// OPEN DEFECT, pinned as the refusal it is. A class declared in a function
// that reads a local the program WRITES (here `count`) shares that binding
// with the function and every other closure over it; the lifted class stores
// values, so only never-reassigned captures lower (corpus 8022, 8023).
function make() {
  let count = 0;
  class Tick {
    next() {
      return count;
    }
  }
  count += 5;
  return new Tick().next();
}
console.log(make());

// A length read between pushes of the same type.
function run() {
  const xs = [];
  xs.push(1);
  const before = xs.length;
  xs.push(2);
  console.log(before, xs.length, xs);
}
run();

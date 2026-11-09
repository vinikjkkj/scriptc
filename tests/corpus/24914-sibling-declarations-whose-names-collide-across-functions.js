// Two functions each declare a nested function named n: the outer one is mid-lowering when a forward sibling (later) is hoisted ahead of it, and later has its
// own n. The scope-entry box belongs to the outer n alone, whatever the ids the two functions' locals are given.
function outer() {
  function n() {
    return later() + 1;
  }
  function later() {
    function inner() {
      return 1;
    }
    function n() {
      return 2;
    }
    return n() + inner();
  }
  return n();
}
console.log(outer());

var shape = (function () {
  function t(e, t, n, o) {
    return e + t + n + o;
  }
  function n(e, t, n, o, r) {
    return e(o, r + t) + n;
  }
  return [t(1, 2, 3, 4), n(function (a, b) { return a + b; }, 1, 2, 3, 4)];
})();
console.log(shape.join(","));

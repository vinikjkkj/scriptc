// An object literal returned by a helper gets a member written after it (a value
// and an own method that reads `this`), then comes back as the result.
function newCounter(start) {
  return { count: Number(start), label: 'c' };
}
function makeCounter(start) {
  var counter = newCounter(start);
  counter.step = 2;
  counter.next = function () {
    this.count = this.count + this.step;
    return this.count;
  };
  return counter;
}
var k = makeCounter(3);
console.log(k.next(), k.next(), k.count, k.step, k.label);
var j = makeCounter(0);
console.log(j.next(), k.count, j.count, typeof j.next, j.missing);

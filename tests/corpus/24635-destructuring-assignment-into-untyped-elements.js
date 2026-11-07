// Destructuring assignment whose targets are elements or members of an UNTYPED receiver: the swap `[a[i], a[j]] = [a[j], a[i]]` (the array
// shuffle in standard-as-callback's dependency) and member targets. The receivers and keys evaluate before the values store.
function shuffle(array) {
  let counter = array.length;
  while (counter > 0) {
    const index = Math.floor(0.5 * counter) % counter;
    counter--;
    [array[counter], array[index]] = [array[index], array[counter]];
  }
  return array;
}
console.log(shuffle([1, 2, 3, 4, 5]).join());
function swapMembers(o) {
  [o.a, o.b] = [o.b, o.a];
  return o;
}
console.log(JSON.stringify(swapMembers({ a: 1, b: "two" })));
function fill(a, k) {
  [a[k], a["z"]] = ["p", "q"];
  return JSON.stringify(a);
}
console.log(fill({}, "m"), fill([], 0));
function order(target) {
  const log = [];
  const key = (k) => { log.push("key" + k); return k; };
  [target[key(0)], target[key(1)]] = [log.push("v") && "x", "y"];
  return log.join() + "|" + JSON.stringify(target);
}
console.log(order([]));

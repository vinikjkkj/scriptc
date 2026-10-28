// Promise.all over an evolving JS array of promises (any[] in the checker),
// both as a then-chained value and passed through a parameter.
const arr = [];
arr.push(Promise.resolve(1));
arr.push(Promise.resolve(2));
Promise.all(arr).then((v) => console.log("arr-push", v.length, v[1]));

function h(xs) {
  return Promise.all(xs).then((v) => console.log("all-param", v.length));
}
h([Promise.resolve(1), Promise.resolve(2)]);

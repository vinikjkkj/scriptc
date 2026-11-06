// A const whose own initializer's callbacks read the const (`const p = work().then(() => p …)`): the reads happen after the initializer
// completed, so they see the value; a callback run synchronously inside the initializer reads the dead zone and throws Node's ReferenceError.
let current = null;
function prepare() {
  const promise = Promise.resolve(1).then(() => {
    const same = current === promise;
    if (same) current = null;
    return typeof promise + ":" + same;
  });
  current = promise;
  return promise;
}
prepare().then((v) => console.log(v, current));

function runNow(fn) {
  return fn();
}
try {
  const early = runNow(() => typeof early);
  console.log("unreachable", early);
} catch (e) {
  console.log(e.name + ": " + e.message);
}

const timer = setTimeout(() => {
  console.log(typeof timer, timer === timer);
}, 1);
const chain = Promise.resolve("a").then((x) => x + typeof chain);
chain.then((v) => console.log(v));

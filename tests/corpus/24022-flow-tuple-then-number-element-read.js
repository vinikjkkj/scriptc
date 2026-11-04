// A JavaScript `let` first assigned a tuple (process.hrtime()) and then reassigned a number is one checked-dynamic
// binding: the checker's flow type at the read is the tuple, the value is a dyn, and `ms[0]` is read off it by index.
function monotonic() {
  let ms;
  if (typeof process.hrtime === "function") {
    ms = process.hrtime();
    ms = ms[0] * 1e3 + ms[1] * 1e-6;
  } else {
    ms = process.uptime() * 1000;
  }
  return Math.floor(ms);
}
function pair(flag) {
  let p;
  p = flag ? process.hrtime() : [1, 2];
  const first = p[0] >= 0 && p[1] >= 0;
  p = p[0] + p[1];
  return [first, typeof p];
}
console.log(typeof monotonic(), Number.isInteger(monotonic()), pair(true), pair(false));

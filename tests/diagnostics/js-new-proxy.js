// new Proxy has no static lowering: a compile error wherever the statement
// is reachable (it used to compile and throw when the statement ran). A
// branch the compiler DECIDES is never taken (`globalThis['__scriptc_absent__']
// !== undefined` is decided false) is not lowered, so it is not refused.
function wrap(target) {
  return new Proxy(target, {}).k;
}
console.log(wrap({ k: 1 }));

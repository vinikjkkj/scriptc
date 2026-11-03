// `const K = class {...}` inside a function: K in the body is that evaluation; statics read and written through it.
function f(k: number) {
  const K = class { static n = k; static inc(): number { return ++K.n; } v = 1; };
  K.n = K.n * 2;
  K.n += 1;
  K.n++;
  const r = [K.n, K.inc(), new K().v];
  return r.join(",");
}
console.log(f(5), f(1));

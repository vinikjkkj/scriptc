// The spread source is an untyped parameter (a plain dyn value), with a fixed-key call beside it.
function merge(base, extra) {
  return { ...base, ...extra, string: function () { return 'str'; } };
}
const m1 = merge({ a: 1, b: 'x' }, { c: true, a: 'over' });
console.log(Object.keys(m1).join(","), JSON.stringify(m1), m1.string());
const m2 = merge(null, undefined);
console.log(Object.keys(m2).join(","), m2.string(), JSON.stringify(m2));

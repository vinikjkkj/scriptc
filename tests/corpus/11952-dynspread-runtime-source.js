// A truly dynamic source: its keys come from run-time data, so their order is the run-time insertion order. The spread must copy them in that order.
function build(names) {
  const src = {};
  for (let i = 0; i < names.length; i++) src[names[i]] = names[i].length + i;
  return src;
}
const src = build(['zeta', 'alpha', 'mid']);
const obj = { ...src, hello: function () { return 'hi'; }, alpha: 99 };
console.log(Object.keys(obj).join(','));
console.log(JSON.stringify(obj));
console.log(obj.hello(), obj.zeta, obj.alpha);
const parsed = JSON.parse('{"k2":2,"k1":1,"k10":10,"2":"idx"}');
const merged = { ...parsed, tag: function () { return 'T'; } };
console.log(Object.keys(merged).join(','), merged.tag(), JSON.stringify(merged));

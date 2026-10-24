// instanceof RegExp / Array over untyped operands (mysql2's patternRegExp).
function patternRegExp(pattern) {
  if (pattern instanceof RegExp) return pattern;
  const source = pattern.replace(/([.+?^=!:${}()|[\]/\\])/g, '\\$1').replace(/\*/g, '.*');
  return new RegExp(`^${source}$`);
}
const a = patternRegExp('db*'), b = patternRegExp(/x+/i);
console.log(a.test('dbmain'), a.test('xdb'), b.test('XXX'), b.source, b.flags, a === patternRegExp(a));
function kind(x) { return [x instanceof RegExp, x instanceof Date, x instanceof Array, x instanceof Map, typeof x]; }
console.log(kind(/a/), kind(new Date(0)), kind([1]), kind(new Map()), kind('s'), kind(null), kind({ source: 'x' }));

// A statically-typed primitive: .constructor is its wrapper, never a program class.
class Query { n = 1; }
function route(sql: string): string {
  if (sql.constructor === Query) return 'cmd';
  return sql.constructor === String ? 'str' : 'other';
}
console.log(route('abc'), route(''));
function isNum(v: number): boolean { return v.constructor === Number; }
console.log(isNum(3), isNum(NaN));
function isBool(v: boolean): boolean { return v.constructor !== Boolean; }
console.log(isBool(true), isBool(false));
function clsOf(v: string): boolean { return v.constructor !== Query; }
console.log(clsOf('x'));

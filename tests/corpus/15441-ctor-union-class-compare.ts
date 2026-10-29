// A union of a string and a program class instance: the constructor test answers per
// runtime arm (the string arm is String, the instance arm is its own class).
class Query {
  sql: string;
  constructor(s: string) { this.sql = s; }
}
function uq(sql: string | Query): string {
  if (sql.constructor === Query) return "query";
  return "string";
}
function us(sql: string | Query): boolean { return sql.constructor === String; }
function unq(sql: string | Query): boolean { return sql.constructor !== Query; }
console.log(uq("a"), uq(new Query("b")));
console.log(us("a"), us(new Query("b")), unq("a"), unq(new Query("c")));

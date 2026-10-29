// `prim.constructor === C` on a primitive: the builtin wrapper is never a program class
// (false), and === String / Number / Boolean / BigInt is true for its own tag.
class Query {
  sql: string;
  constructor(s: string) { this.sql = s; }
}
function isQ(sql: string): boolean { return sql.constructor === Query; }
function isNotQ(sql: string): boolean { return sql.constructor !== Query; }
function isS(sql: string): boolean { return sql.constructor === String; }
function isN(n: number): boolean { return n.constructor === Number; }
function isB(b: boolean): boolean { return b.constructor === Boolean; }
function isBig(b: bigint): boolean { return b.constructor === BigInt; }
console.log(isQ("select 1"), isNotQ("select 1"), isS("x"), isN(1), isB(true), isBig(1n));
console.log(isQ(""), isS(""), isN(0), isB(false), isBig(0n));

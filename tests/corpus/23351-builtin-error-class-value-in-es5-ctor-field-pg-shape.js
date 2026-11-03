class DatabaseError extends Error {
  constructor(message, length, name) { super(message); this.length = length; this.name = name; }
}
const PG = function () { this.DatabaseError = DatabaseError; };
const pg = new PG();
const e = new pg.DatabaseError("bad", 3, "error");
console.log(e.message, e.length, e.name, e instanceof pg.DatabaseError, e instanceof Error);
try { throw e; } catch (x) { console.log(x instanceof DatabaseError, x.constructor === pg.DatabaseError, x.constructor.name); }
console.log(pg.DatabaseError.name, typeof pg.DatabaseError);

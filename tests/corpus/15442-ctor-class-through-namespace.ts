// The compared class is read through a namespace object (`Commands.Query`, the shape of
// a CommonJS `module.exports = { Query }` table), as mysql2's connection.query does.
class Query {
  sql: string;
  constructor(s: string) { this.sql = s; }
}
const Commands = { Query };
function query(sql: string, values: unknown): string {
  if (sql.constructor === Commands.Query) return "query " + sql;
  return "string " + String(values);
}
console.log(query("select 1", 2));
console.log(query("select 1", 2) === "string 2");

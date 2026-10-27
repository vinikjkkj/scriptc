// The mysql2 query() shape: a value that is either a command object or a
// plain SQL string picks its branch by .constructor === the command class.
class Query { sql: string; constructor(sql: string) { this.sql = sql; } }
function route(sql: string | Query): string {
  if (sql.constructor === Query) return 'cmd:' + (sql as Query).sql;
  return 'raw:' + (sql as string);
}
console.log(route('select 1'), route(new Query('select 2')));
const items: Array<string | Query> = ['a', new Query('b'), 'c'];
let n = 0;
for (const it of items) if (it.constructor === Query) n += 1;
console.log(n);

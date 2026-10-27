// A string or a class instance: .constructor of the instance is its class,
// and a class value compares by identity with the class itself.
class Cmd { kind = 'cmd'; }
class Query extends Cmd { text = 'q'; }
class Other { n = 1; }
function isQuery(sql: string | Query): boolean { return sql.constructor === Query; }
function isCmd(sql: string | Cmd): boolean { return sql.constructor === Cmd; }
function isOther(sql: string | Other): boolean { return sql.constructor === Other; }
console.log(isQuery('select 1'), isQuery(new Query()));
console.log(isCmd(new Cmd()), isCmd(new Query()), isCmd('cmd'));
console.log(isOther(new Other()), isOther('Other'));
const q = new Query();
console.log(q.constructor === Query, q.constructor === Cmd, q.constructor === Other);

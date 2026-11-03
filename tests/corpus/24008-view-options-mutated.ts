// An options record handed to an untyped callee that mutates it: the caller sees the write, as in Node.
interface Options { sql: string; values?: number[]; nested?: { rows: number } }
function execute(sql: string, opts: unknown): number {
  const o = opts as { sql: string; values?: number[]; nested?: { rows: number }; added?: string };
  o.values = o.values || [1, 2];
  o.added = "by callee";
  if (o.nested) o.nested.rows += 1;
  return sql.length;
}
const options: Options = { sql: "q", nested: { rows: 1 } };
const n = execute("SELECT", options);
console.log(n, options.values, options.nested, options);
const second: Options = { sql: "r", values: [9] };
execute("S", second);
console.log(second.values, JSON.stringify(second));

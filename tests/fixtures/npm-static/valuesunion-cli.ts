// npm-static pilot: a package-declared recursive union with an array-of-unknown
// arm (mysql2's QueryValues) as the type of an options member.
import type { QueryOptions } from "valuesunion";

function describe(options: QueryOptions): string {
  const v = options.values;
  if (v === undefined) return options.sql + ":none";
  if (Array.isArray(v)) return options.sql + ":array" + v.length;
  return options.sql + ":" + typeof v;
}

console.log(describe({ sql: "a" }));
console.log(describe({ sql: "b", values: [1, "x", null] }));
console.log(describe({ sql: "c", values: "text" }));
console.log(describe({ sql: "d", values: { k: 1 } }));

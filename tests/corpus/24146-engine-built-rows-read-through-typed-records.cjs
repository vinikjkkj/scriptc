"use strict";
// rows built by engine code, read back through typed records (mysql2's text rows)
function parserFor(cols) {
  const body = cols.map((c, i) => "this[" + JSON.stringify(c) + "] = row[" + i + "];").join(" ");
  return new Function("return class TextRow { constructor() {} next(row) { " + body + " return this; } }")();
}
const P = parserFor(String(process.argv.length) === "2" ? ["id", "name", "score"] : ["a"]);
const rows = [new P().next([1, "alpha", 1.5]), new P().next([2, "beta", 2.25])];
/** @typedef {{id: number, name: string, score: number}} Row */
/** @param {Row[]} rs */
function show(rs) { for (const r of rs) console.log(r.id, r.name, r.score + 1); return rs.length; }
console.log(show(rows));
console.log(JSON.stringify(rows));
/** @param {{[column: string]: any}[]} rs */
function keys(rs) { return rs.map((r) => Object.keys(r).join(",")); }
console.log(keys(rows).join("|"));

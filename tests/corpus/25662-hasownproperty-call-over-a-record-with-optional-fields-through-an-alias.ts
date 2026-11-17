// The sql-escaper shape: `const hasOwnProperty = Object.prototype.hasOwnProperty` then `hasOwnProperty.call(record, key)` over a record whose fields are optional.
// An omitted key, a key holding undefined (explicit, assigned, spread) and a deleted key are told apart exactly as Node does.
const hasOwnProperty = Object.prototype.hasOwnProperty;
type SqlMode = { noBackslashEscapes?: boolean; ansiQuotes?: boolean };
function readNoBackslashEscapes(sqlMode: SqlMode): boolean {
  if (!hasOwnProperty.call(sqlMode, "noBackslashEscapes")) return false;
  const noBackslashEscapes = sqlMode.noBackslashEscapes;
  if (noBackslashEscapes === undefined) return false;
  return noBackslashEscapes;
}
function owns(m: SqlMode): string { return hasOwnProperty.call(m, "noBackslashEscapes") + "/" + hasOwnProperty.call(m, "ansiQuotes") + "/" + hasOwnProperty.call(m, "other"); }
const a: SqlMode = {};
const b: SqlMode = { noBackslashEscapes: true };
const c: SqlMode = { noBackslashEscapes: undefined };
const d: SqlMode = { ...b, ansiQuotes: undefined };
const e: SqlMode = { noBackslashEscapes: false, ansiQuotes: true };
delete e.noBackslashEscapes;
const f: SqlMode = {};
f.ansiQuotes = undefined;
console.log(readNoBackslashEscapes(a), readNoBackslashEscapes(b), readNoBackslashEscapes(c));
console.log(owns(a), owns(b), owns(c), owns(d), owns(e), owns(f));
console.log(Object.prototype.hasOwnProperty.call(b, "noBackslashEscapes"), Object.prototype.hasOwnProperty.call(a, "ansiQuotes"));

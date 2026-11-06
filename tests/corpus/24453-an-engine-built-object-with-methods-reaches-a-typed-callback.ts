/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// An object the engine builds (new Function over text only the engine can read) is handed to a TYPED callback whose parameter type declares
// function members (zapo's typeCast over mysql2's column definition): the callback calls the members, and the callback it is given.
interface CastField {
  type: string;
  length: number;
  string(): string | null;
  geometry(): number;
  tag?(): string;
}
const body = [
  "let n = 0;",
  "const field = { type: 'BLOB', length: 3, label: 'col', string() { return this.label + ':' + this.length; }, geometry() { n += 1; return n; } };",
  "const next = function () { return 'next-' + n; };",
  "return [cb(field, next), cb({ type: 'INT', length: 1, label: 'x', string() { return null; }, geometry() { return 7; } }, next)];",
].join("\n");
const run = new Function("cb", body) as (cb: (field: CastField, next: () => unknown) => unknown) => unknown;
const out = run((field, next) => {
  const parts: unknown[] = [typeof field.string, typeof field.geometry, typeof next, field.tag === undefined];
  parts.push(field.type, field.string(), field.geometry(), field.geometry(), field.string === field.string, field.geometry === field.geometry);
  if (field.type === "BLOB") return parts.join("|");
  return next();
});
console.log(JSON.stringify(out));

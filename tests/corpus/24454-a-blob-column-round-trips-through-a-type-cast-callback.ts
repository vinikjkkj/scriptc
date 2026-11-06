/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-implied-eval -- the row builds engine code at run time on purpose */
// zapo's typeCast over a BLOB column: the engine builds the column object, the typed callback calls field.buffer() and keeps the bytes.
interface CastField {
  type: string;
  buffer(): Uint8Array | null;
}
const body = [
  "const bytes = new Uint8Array([10, 20, 30, 40]);",
  "const blob = { type: 'BLOB', buffer() { return bytes; } };",
  "const none = { type: 'LONG_BLOB', buffer() { return null; } };",
  "const text = { type: 'VARCHAR', buffer() { return null; } };",
  "const r = [cb(blob, () => 'next'), cb(none, () => 'next'), cb(text, () => 'next')];",
  "r.push(Array.from(bytes).join(','));",
  "return r;",
].join("\n");
const run = new Function("cb", body) as (cb: (field: CastField, next: () => unknown) => unknown) => unknown[];
const out = run((field, next) => {
  if (field.type === "BLOB" || field.type === "LONG_BLOB") {
    const buf = field.buffer();
    if (buf === null) return null;
    const copy = new Uint8Array(buf);
    copy[0] = 99;
    return [buf.length, copy.length, buf[0], copy[0], buf instanceof Uint8Array, Array.from(copy).join("-")];
  }
  return next();
});
console.log(JSON.stringify(out));

// pg-protocol parseErrorMessage: `message.detail = fields.D` stores an index-signature read of an ABSENT key into a field that declares undefined. Node stores undefined.
class DbError {
  severity: string | undefined;
  code: string | undefined;
  detail: string | undefined;
  hint: string | undefined;
  message: string;
  constructor(m: string) { this.message = m; }
}
function parse(pairs: string[]): DbError {
  const fields: Record<string, string> = {};
  for (const p of pairs) fields[p.charAt(0)] = p.slice(1);
  const e = new DbError(fields.M as string);
  e.severity = fields.S;
  e.code = fields.C;
  e.detail = fields.D;
  e.hint = fields.H;
  return e;
}
const a = parse(["MBoom", "SERROR", "C23505", "Dduplicate key"]);
console.log(a.message, a.severity, a.code, a.detail, a.hint === undefined, a.hint);
const b = parse(["Mx"]);
console.log(b.message, b.severity, b.detail, b.detail === undefined);

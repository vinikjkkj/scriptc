// The same store through a receiver typed as a UNION of two classes (pg-protocol: message is NoticeMessage | DatabaseError).
class Notice {
  severity: string | undefined;
  code: string | undefined;
  detail: string | undefined;
  hint: string | undefined;
  message: string;
  constructor(m: string) { this.message = m; }
}
class DbError {
  severity: string | undefined;
  code: string | undefined;
  detail: string | undefined;
  hint: string | undefined;
  message: string;
  constructor(m: string) { this.message = m; }
}
function parse(pairs: string[], notice: boolean): DbError | Notice {
  const fields: Record<string, string> = {};
  for (const p of pairs) fields[p.charAt(0)] = p.slice(1);
  const e = notice ? new Notice(fields.M as string) : new DbError(fields.M as string);
  e.severity = fields.S;
  e.code = fields.C;
  e.detail = fields.D;
  e.hint = fields.H;
  return e;
}
const a = parse(["MBoom", "SERROR", "C23505", "Dduplicate key"], false);
console.log(a.message, a.severity, a.code, a.detail, a.hint === undefined, a.hint);
const b = parse(["Mx"], true);
console.log(b.message, b.severity, b.detail, b.detail === undefined);

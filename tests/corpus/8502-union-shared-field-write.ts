// @transform-types
// A shared-field WRITE over a union of classes (pg-protocol's
// NoticeMessage | DatabaseError) and over a union of records.
class Notice {
  public severity: string | undefined;
  public code: string | undefined;
  public readonly name = "notice";
  constructor(public readonly length: number, public readonly message: string | undefined) {}
}
class DbError extends Error {
  public severity: string | undefined;
  public code: string | undefined;
  constructor(message: string, public readonly length: number, public readonly name: string) {
    super(message);
  }
}

function parse(kind: string) {
  const fields: Record<string, string> = { S: "ERROR", C: "42", M: "bad" };
  const message = kind === "notice" ? new Notice(0, fields.M) : new DbError(fields.M, 0, kind);
  message.severity = fields.S + "!";
  message.code = fields.C;
  return message;
}
for (const k of ["notice", "error"]) {
  const m = parse(k);
  console.log(m.name, m.severity, m.code, m.length);
}

type A = { tag: string; n: number };
type B = { tag: string; n: number; extra: boolean };
function bump(x: A | B, v: number): number {
  x.n = v * 2;
  x.tag = "t" + v;
  return x.n;
}
const a: A = { tag: "a", n: 1 };
const b: B = { tag: "b", n: 2, extra: true };
console.log(bump(a, 3), bump(b, 4), a.tag, b.tag, a.n, b.n, b.extra);

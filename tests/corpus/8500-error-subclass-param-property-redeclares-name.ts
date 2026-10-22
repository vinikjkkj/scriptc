// A parameter property that redeclares an inherited Error slot at its own
// type: `constructor(message, public readonly name: MessageName)`.
type MessageName = "error" | "notice" | "fatal";

class DbError extends Error {
  public severity: string | undefined;
  public detail: string | undefined;
  constructor(
    message: string,
    public readonly length: number,
    public readonly name: MessageName,
  ) {
    super(message);
  }
}

class Tagged extends Error {
  public tag = "t";
  constructor(message: string, public name: string) {
    super(message);
  }
}

const e = new DbError("boom", 3, "error");
e.severity = "FATAL";
e.detail = "x";
console.log(e.message, e.name, e.length, e.severity, e.detail);
console.log(e instanceof Error, e instanceof DbError, String(e));

const t = new Tagged("hi", "Custom");
console.log(t.message, t.name, t.tag, String(t));

const view: Error = e;
console.log(view.name, view.message);
try {
  throw new DbError("thrown", 9, "fatal");
} catch (x) {
  const d = x as DbError;
  console.log(d.name, d.length, d.message);
}

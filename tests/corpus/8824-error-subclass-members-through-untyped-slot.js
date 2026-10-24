// A user subclass of Error that reached an untyped slot: message, name, code,
// stack, the class's own fields and methods, writes of every one of them, own
// expando properties, `in`, `instanceof Error`, String(e), and the keys Node
// lists. Each read and write was a loud "a property read/write on a dynamic
// AppError is not supported yet", `e instanceof Error` and `'message' in e`
// answered false, and `e.stack` of a plain Error was silently undefined.
'use strict';

class AppError extends Error {
  constructor(msg, code) {
    super("m:" + msg);
    this.name = "AppError";
    this.code = code;
    this.retries = 2;
  }
  hint() { return "hint:" + this.code + ":" + this.retries; }
}
class Quiet extends TypeError {
  constructor(m) { super("q:" + m); this.level = 1; }
}

function t(label, f) {
  try { console.log(label, f()); } catch (e) { console.log(label, "THROW", e.name, e.message); }
}

function probe(e) {
  t("message", () => e.message);
  t("name", () => e.name);
  t("code", () => e.code);
  t("own field", () => e.retries);
  t("method", () => e.hint());
  t("stack header", () => e.stack.split("\n")[0]);
  t("stack typeof", () => typeof e.stack);
  t("toString", () => e.toString());
  t("String", () => String(e));
  t("instanceof Error", () => e instanceof Error);
  t("in", () => ["message", "name", "stack", "code", "retries", "hint", "nope"].map((k) => k in e).join(","));
  t("absent", () => e.nope);
  t("keys", () => Object.keys(e).join(","));
  t("write code", () => { e.code = "OTHER"; return e.code; });
  t("write code number", () => { e.code = 7; return e.code + 1; });
  t("write message", () => { e.message = "changed"; return e.message + "|" + String(e); });
  t("write message number", () => { e.message = 5; return typeof e.message; });
  t("write name", () => { e.name = "Renamed"; return e.name; });
  t("write field", () => { e.retries = 9; return e.hint(); });
  t("write expando", () => { e.fatal = true; return e.fatal; });
  t("expando in", () => "fatal" in e);
  t("write stack", () => { e.stack = "custom stack"; return e.stack; });
  t("delete expando", () => { const r = delete e.fatal; return r + "," + e.fatal; });
}

probe(new AppError("boom", "E_APP"));
console.log("--- a TypeError subclass");
const q = new Quiet("x");
function probeQ(e) {
  t("name", () => e.name);
  t("message", () => e.message);
  t("field", () => e.level);
  t("keys", () => Object.keys(e).join(","));
  t("instanceof Error", () => e instanceof Error);
  t("stack header", () => e.stack.split("\n")[0]);
}
probeQ(q);
console.log("--- a plain Error");
function probePlain(e) {
  t("stack typeof", () => typeof e.stack);
  t("stack header", () => e.stack.split("\n")[0]);
  t("write stack", () => { e.stack = "S"; return e.stack; });
  t("keys", () => Object.keys(e).join(","));
}
probePlain(new Error("plain"));
probePlain(new RangeError("range"));

// The read and the call of a prototype method name must agree on a wrapper reached by a computed key, a stored function value, and in a loop.
const w: any = Object("Hello");
const ws: any = Object("  pad ");
const nm = ["trim", "slice", "padEnd", "charAt", "indexOf", "toFixed", "nope"];
for (const k of nm) {
  const f = w[k];
  const kind = typeof f;
  let out = "-";
  if (kind === "function") {
    if (k === "charAt") out = String(w[k](1));
    else if (k === "indexOf") out = String(w[k]("l"));
    else if (k === "toFixed") out = "bad";
    else if (k === "slice") out = String(w[k](1, 3));
    else if (k === "padEnd") out = String(w[k](8, "."));
    else out = String(w[k]());
  }
  console.log(k, kind, k in w, out);
}
console.log(ws.trim() + "|", String(ws.toString()).length, String(ws.valueOf()).length);
const num: any = Object(12.5);
const key = "toFixed";
console.log(typeof num[key], num[key](1), typeof num["toUpperCase"]);

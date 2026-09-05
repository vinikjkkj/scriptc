// `s.replace(re, fn)` where the regex's PATTERN is assembled at run time
// and only its FLAGS are written at the call. store-sqlite's table-name
// resolver is the program:
//
//   const pattern = new RegExp(`\b(?:${names.map(esc).join("|")})\b`, "g")
//   return (sql) => sql.replace(pattern, (token) => renames[token] ?? token)
//
// The pattern is needed for exactly one proof — which capture groups always
// participate — so a replacer that declares only the WHOLE MATCH asks about
// no group and needs no pattern. The flags are still needed, and they are
// right there in the source: they decide global-vs-once and the alphabet.
//
// A non-global runtime regex replaces the FIRST match only, and the 'g'
// completion the lowering needs is built from the source regex's own
// `source` at run time rather than from a literal it does not have.

const names = ["alpha", "beta", "gamma"];
const renames: Record<string, string> = { alpha: "A", beta: "B" };

function esc(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const all = new RegExp(`\\b(?:${names.map(esc).join("|")})\\b`, "g");
const first = new RegExp(`\\b(?:${names.map(esc).join("|")})\\b`, "");

const sql = "select alpha, beta, gamma, alphabet from beta";

// Global: every occurrence, and an unmapped token falls through unchanged.
console.log(sql.replace(all, (token) => renames[token] ?? token));

// Non-global: only the first, and the receiver is otherwise untouched.
console.log(sql.replace(first, (token) => renames[token] ?? token));

// No match at all: the subject comes back identical.
console.log("nothing here".replace(all, (token) => `[${token}]`));
console.log("nothing here".replace(first, (token) => `[${token}]`));

// The replacer sees the exact matched text.
const seen: string[] = [];
console.log(sql.replace(all, (token) => { seen.push(token); return token.toUpperCase(); }));
console.log(seen.join(","));

// Case-insensitive flags, still literal at the call.
const ci = new RegExp(`(?:${names.join("|")})`, "gi");
console.log("ALPHA Beta gamma".replace(ci, (t) => `<${t.toLowerCase()}>`));

// replaceAll over the global runtime regex.
console.log(sql.replaceAll(all, (token) => renames[token] ?? "?"));

// A regex bound through a const, built from a parameter — the resolver's
// own shape, closed over and called twice.
function makeResolver(map: Record<string, string>): (s: string) => string {
  const keys = Object.keys(map).sort();
  if (keys.length === 0) return (s) => s;
  const pattern = new RegExp(`\\b(?:${keys.map(esc).join("|")})\\b`, "g");
  return (s) => s.replace(pattern, (token) => map[token] ?? token);
}
const resolve = makeResolver({ alpha: "wa_alpha", gamma: "wa_gamma" });
console.log(resolve(sql));
console.log(resolve("alpha alpha gamma"));
console.log(makeResolver({})(sql));

// Adjacent and repeated matches: the loop must advance past each one.
const digits = new RegExp("[0-9]+", "g");
console.log("a1b22c333".replace(digits, (d) => `(${d.length})`));

// A pattern with regex metacharacters escaped into it.
const weird = new RegExp(`(?:${["a.b", "c+d"].map(esc).join("|")})`, "g");
console.log("a.b axb c+d ccd".replace(weird, (t) => `<${t}>`));

// The replacement result is used, not just printed.
const out = sql.replace(all, (token) => renames[token] ?? token);
console.log(out.length, out.indexOf("A"), out.split(",").length);

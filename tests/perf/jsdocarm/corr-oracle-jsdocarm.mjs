/**
 * corr-oracle-jsdocarm.mjs - the SAME correspondence, derived from Node.
 *
 * `corr-jsdocarm.mjs` builds the declared-member <-> function-expression
 * correspondence out of the AST, which is what a compiler would have to do.
 * A correspondence built from an implementation cannot find what the
 * implementation forgot, so this instrument builds it a second way, from
 * the ONLY authority that is not an implementation of the same idea: it
 * REQUIRES the bundle in Node and walks the live object graph.
 *
 * For every reachable constructor under the exported namespace it records
 * the path, its own enumerable function-valued properties, each one's
 * `.length` (the real arity) and the byte range its `toString()` occupies
 * in the source file. The two instruments then have to agree on all four.
 *
 * Usage: node corr-oracle-jsdocarm.mjs <index.js> [--json out.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const jsonFlagAt = process.argv.indexOf("--json");
const jsonAt = jsonFlagAt < 0 ? null : process.argv[jsonFlagAt + 1];
const jsPath = positional.filter((a) => a !== jsonAt)[0];
if (!jsPath) { console.error("usage: corr-oracle-jsdocarm.mjs <index.js> [--json out.json]"); process.exit(2); }

const src = readFileSync(jsPath, "utf8");
const mod = require(jsPath);

const ns = mod.waproto ?? mod;
const out = [];
const seen = new Set();

/* A generated message TYPE is a function whose prototype carries the
 * message's own fields. A generated MEMBER (encode/decode) is a plain
 * function whose prototype carries nothing but `constructor`. That one
 * distinction is the whole classifier, and it is a property of the live
 * object, not of any parse. */
function isCtorish(v) {
  if (typeof v !== "function" || v.prototype === undefined || v.prototype === null) return false;
  if (Object.getOwnPropertyNames(v.prototype).some((k) => k !== "constructor")) return true;
  /* a message with NO fields has an empty prototype; three of zapo's 641
   * are exactly that (QP, ConsumerApplication.Signal and
   * ...SideBySideSurveyCardImpressionEventData). They are still message
   * types, and the live object says so: they carry their own codec. */
  return typeof v.encode === "function" && typeof v.decode === "function" &&
    Object.hasOwn(v, "encode") && Object.hasOwn(v, "decode");
}

function walk(obj, path, depth) {
  if (depth > 6 || obj === null || obj === undefined) return;
  if (typeof obj !== "object" && typeof obj !== "function") return;
  if (seen.has(obj)) return;
  seen.add(obj);
  for (const k of Object.getOwnPropertyNames(obj)) {
    if (k === "prototype" || k === "length" || k === "name" || k === "caller" ||
        k === "arguments" || k === "constructor") continue;
    let v;
    try { v = obj[k]; } catch { continue; }
    const p = path ? path + "." + k : k;
    if (typeof v === "function") {
      if (isCtorish(v)) {
        const statics = [];
        for (const sk of Object.getOwnPropertyNames(v)) {
          if (sk === "prototype" || sk === "length" || sk === "name") continue;
          let sv; try { sv = v[sk]; } catch { continue; }
          if (typeof sv !== "function") continue;
          if (isCtorish(sv)) continue;           /* a nested type, not a member */
          const text = Function.prototype.toString.call(sv);
          /* a source position is only evidence if the text occurs ONCE:
           * every generated constructor is byte-identical to every other,
           * so indexOf would hand out the same position 641 times. */
          const occ = src.split(text).length - 1;
          statics.push({ name: sk, arity: sv.length, at: occ === 1 ? src.indexOf(text) : -1, occ, len: text.length });
        }
        const ctorText = Function.prototype.toString.call(v);
        const ctorOcc = src.split(ctorText).length - 1;
        out.push({
          path: p, ctorArity: v.length,
          ctorAt: ctorOcc === 1 ? src.indexOf(ctorText) : -1, ctorOcc,
          protoProps: Object.getOwnPropertyNames(v.prototype).filter((x) => x !== "constructor"),
          statics: statics.sort((a, b) => a.name.localeCompare(b.name)),
        });
      }
      walk(v, p, depth + 1);
      continue;
    }
    if (v && typeof v === "object") walk(v, p, depth + 1);
  }
}
walk(ns, "waproto", 0);

out.sort((a, b) => a.path.localeCompare(b.path));
const memberCount = out.reduce((n, r) => n + r.statics.length + 1, 0);
const notFound = out.filter((r) => r.ctorAt < 0).length +
  out.reduce((n, r) => n + r.statics.filter((s) => s.at < 0).length, 0);
const arityHist = new Map();
for (const r of out) {
  arityHist.set(`constructor/${r.ctorArity}`, (arityHist.get(`constructor/${r.ctorArity}`) ?? 0) + 1);
  for (const s of r.statics) arityHist.set(`${s.name}/${s.arity}`, (arityHist.get(`${s.name}/${s.arity}`) ?? 0) + 1);
}
const summary = {
  js: jsPath, srcChars: src.length,
  ctors: out.length, members: memberCount,
  memberTextNotFoundInSource: notFound,
  arityHistogram: [...arityHist.entries()].sort((a, b) => b[1] - a[1]),
};
console.log(JSON.stringify(summary, null, 2));
if (jsonAt) writeFileSync(jsonAt, JSON.stringify({ summary, ctors: out }, null, 2));
void pathToFileURL;

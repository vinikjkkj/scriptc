// waproto-split.mjs — how much of zapo's spec/proto/index.js is code the
// index.d.ts describes (generated message members) and how much is
// protobufjs's own runtime, which the declaration never mentions.
//
// The esbuild bundle keeps a literal chunk key per vendored file:
//   r({"node_modules/protobufjs/src/util/base64.js"(e,t){ ... }})
// so the vendored region is exactly measurable from the bundle text.
import { readFileSync } from "node:fs";
/* No default: this measures a vendored bundle that lives OUTSIDE this repo,
 * so a hardcoded path only ever worked on the machine it was written on.
 * Usage: node waproto-split.mjs <bundle.js> <bundle.d.ts>  (or WAPROTO_JS/_DTS) */
const JS = process.argv[2] ?? process.env["WAPROTO_JS"] ?? null;
const DTS = process.argv[3] ?? process.env["WAPROTO_DTS"] ?? null;
if (JS === null || DTS === null) {
  console.error("usage: node waproto-split.mjs <bundle.js> <bundle.d.ts>");
  console.error("   or: WAPROTO_JS=... WAPROTO_DTS=... node waproto-split.mjs");
  process.exit(2);
}
const js = readFileSync(JS, "utf8");
const dts = readFileSync(DTS, "utf8");

/* every chunk key esbuild wrote, in order */
const keyRe = /\{"((?:node_modules|src|spec)\/[^"]+)"\(/g;
const keys = [];
let m;
while ((m = keyRe.exec(js)) !== null) keys.push({ name: m[1], at: m.index });
console.log("bundle bytes        " + js.length.toLocaleString("en-US"));
console.log("declaration bytes   " + dts.length.toLocaleString("en-US"));
console.log("esbuild chunk keys  " + keys.length);

/* the vendored region: from the first chunk key to the last chunk's end.
 * The generated WAProto code is everything AFTER the last chunk. */
if (keys.length > 0) {
  const first = keys[0].at;
  const last = keys[keys.length - 1].at;
  console.log("");
  console.log("first chunk key at  " + first.toLocaleString("en-US") + "   " + keys[0].name);
  console.log("last  chunk key at  " + last.toLocaleString("en-US") + "   " + keys[keys.length - 1].name);
  console.log("bytes before first  " + first.toLocaleString("en-US"));
  console.log("bytes after last    " + (js.length - last).toLocaleString("en-US") +
    "   (" + (((js.length - last) / js.length) * 100).toFixed(2) + "% of the bundle)");
  const byPkg = new Map();
  for (const k of keys) {
    const pkg = k.name.startsWith("node_modules/")
      ? k.name.split("/").slice(0, 2).join("/") : "(own source)";
    byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + 1);
  }
  console.log("");
  console.log("chunks by package:");
  for (const [p, c] of [...byPkg].sort((a, b) => b[1] - a[1])) console.log("  " + String(c).padStart(4) + "  " + p);
}

/* what the declaration DECLARES: classes and their static members */
const cls = dts.match(/^\s*(?:export )?class \w+/gm) ?? [];
const ifc = dts.match(/^\s*(?:export )?interface \w+/gm) ?? [];
const ns = dts.match(/^\s*(?:export )?namespace \w+/gm) ?? [];
const statics = dts.match(/^\s*(?:public )?static \w+\(/gm) ?? [];
const meth = dts.match(/^\s*(?:public )?\w+\([^)]*\):/gm) ?? [];
console.log("");
console.log("declaration surface:");
console.log("  classes    " + cls.length.toLocaleString("en-US"));
console.log("  interfaces " + ifc.length.toLocaleString("en-US"));
console.log("  namespaces " + ns.length.toLocaleString("en-US"));
console.log("  static methods  " + statics.length.toLocaleString("en-US"));
console.log("  methods (any)   " + meth.length.toLocaleString("en-US"));

/* what the BODY defines: every `X.encode=function` shaped generated member */
const GEN = ["encode", "encodeDelimited", "decode", "decodeDelimited", "verify",
  "fromObject", "toObject", "toJSON", "create"];
console.log("");
console.log("body members, by generated name (`.<name>=function`):");
let total = 0;
for (const g of GEN) {
  const c = (js.match(new RegExp("\\." + g + "\\s*=\\s*function", "g")) ?? []).length;
  total += c;
  console.log("  " + g.padEnd(18) + String(c).padStart(6));
}
const allFn = (js.match(/function\s*[\w$]*\s*\(/g) ?? []).length;
const arrow = (js.match(/=>/g) ?? []).length;
console.log("  " + "TOTAL generated".padEnd(18) + String(total).padStart(6));
console.log("");
console.log("  every `function(` in the bundle   " + allFn.toLocaleString("en-US"));
console.log("  every `=>` in the bundle          " + arrow.toLocaleString("en-US"));
console.log("  generated share of function forms " +
  ((total / (allFn + arrow)) * 100).toFixed(2) + "%");

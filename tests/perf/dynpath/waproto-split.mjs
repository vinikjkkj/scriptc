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

/* ---------------------------------------------------------------------------
 * Do the surfaces AGREE?
 *
 * The counts above agree: 1,282 declared static methods against 1,284
 * `encode`/`decode` bodies. That agreement is the trap. It says the
 * declaration names the same procedures the body defines; it does NOT say the
 * declaration DESCRIBES them. This section asks the second question, which is
 * the one that decides whether the `.d.ts` could ever type these bodies:
 * do the ARITIES and the MEMBER SETS match?
 *
 * Parsed, not regexed — a signature question needs an AST.
 * ------------------------------------------------------------------------- */
/* typescript resolves from this repo. A git worktree has no node_modules of
 * its own, so fall back to the MAIN worktree, found through the .git pointer
 * file rather than a hardcoded path. */
const ts = await (async () => {
  const { createRequire } = await import("node:module");
  const { fileURLToPath } = await import("node:url");
  const { existsSync, statSync, readFileSync: rf } = await import("node:fs");
  const path = await import("node:path");
  const upward = (from) => {
    let dir = from;
    for (;;) {
      const cand = path.join(dir, "node_modules", "typescript", "package.json");
      if (existsSync(cand)) return createRequire(cand)("typescript");
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  let got = upward(here) ?? upward(process.cwd());
  if (got !== null) return got;
  /* worktree: .git is a FILE holding "gitdir: <repo>/.git/worktrees/<name>" */
  let dir = here;
  for (;;) {
    const dot = path.join(dir, ".git");
    if (existsSync(dot) && statSync(dot).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(rf(dot, "utf8"));
      if (m !== null) {
        const gd = m[1].trim();
        const i = gd.lastIndexOf(path.sep + ".git" + path.sep);
        const main = i >= 0 ? gd.slice(0, i) : path.dirname(path.dirname(gd));
        got = upward(main);
        if (got !== null) return got;
      }
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
})();
if (ts === null) {
  console.log("");
  console.log("(agreement section skipped: no typescript resolvable from " +
    "this tree. Run from a checkout with node_modules installed.)");
  process.exit(0);
}

const sfJs = ts.createSourceFile("index.js", js, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const sfDts = ts.createSourceFile("index.d.ts", dts, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

/* declared: arity of every static encode/decode, and the reader/writer members */
const declArity = { encode: new Map(), decode: new Map() };
const declIface = new Map();
(function w(n) {
  if (ts.isMethodDeclaration(n)) {
    const k = n.name.getText();
    if (k === "encode" || k === "decode") {
      const a = n.parameters.length;
      declArity[k].set(a, (declArity[k].get(a) ?? 0) + 1);
    }
  }
  if (ts.isInterfaceDeclaration(n)) {
    const mem = new Map();
    for (const x of n.members) {
      if (ts.isMethodSignature(x)) mem.set(x.name.getText(), x.parameters.length);
      else if (ts.isPropertySignature(x)) mem.set(x.name.getText(), "prop");
    }
    declIface.set(n.name.getText(), mem);
  }
  ts.forEachChild(n, w);
})(sfDts);

/* body: arity of every X.encode=function / X.decode=function */
const bodyArity = { encode: new Map(), decode: new Map() };
const bodies = [];
(function w(n) {
  if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
    const p = n.parent;
    if (p && ts.isBinaryExpression(p) && ts.isPropertyAccessExpression(p.left)) {
      const k = p.left.name.getText();
      if (k === "encode" || k === "decode") {
        const a = n.parameters.length;
        bodyArity[k].set(a, (bodyArity[k].get(a) ?? 0) + 1);
        bodies.push({ kind: k, node: n });
      }
    }
  }
  ts.forEachChild(n, w);
})(sfJs);

const hist = (m) =>
  [...m.entries()].sort((a, b) => a[0] - b[0]).map(([a, c]) => a + " params x" + c).join(", ");

console.log("");
console.log("arity agreement (declared signature vs the body it names):");
for (const k of ["encode", "decode"]) {
  console.log("  " + k.padEnd(7) + " declared  " + hist(declArity[k]));
  console.log("  " + "".padEnd(7) + " body      " + hist(bodyArity[k]));
  const dOnly = [...declArity[k].keys()];
  const bOnly = [...bodyArity[k].keys()];
  const shared = bOnly.filter((a) => dOnly.includes(a));
  const agree = shared.reduce((s, a) => s + Math.min(declArity[k].get(a), bodyArity[k].get(a)), 0);
  const tot = [...bodyArity[k].values()].reduce((a, b) => a + b, 0);
  console.log("  " + "".padEnd(7) + " AGREE     " + agree + " of " + tot +
    "  (" + ((agree / tot) * 100).toFixed(1) + "%)");
}

/* member agreement on the reader/writer parameter: the only concretely
 * typed part of the declaration, and it is still incomplete. */
function memberAudit(label, declName, pick) {
  const decl = declIface.get(declName);
  if (decl === undefined) { console.log("  (no interface " + declName + ")"); return; }
  const used = new Map();
  for (const b of bodies) {
    const ps = b.node.parameters.map((p) => p.name.getText());
    const target = pick(b.kind, ps);
    if (target === undefined) continue;
    (function w(n) {
      if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) &&
          n.expression.text === target) {
        const isCall = n.parent && ts.isCallExpression(n.parent) && n.parent.expression === n;
        const key = n.name.getText() + "/" + (isCall ? n.parent.arguments.length : "get");
        used.set(key, (used.get(key) ?? 0) + 1);
      }
      ts.forEachChild(n, w);
    })(b.node);
  }
  let ok = 0, bad = 0; const badL = [];
  for (const [key, c] of used) {
    const [name, a] = key.split("/");
    if (!decl.has(name)) { bad += c; badL.push([key, c, "NOT DECLARED"]); continue; }
    const d = decl.get(name);
    if (a === "get") { if (d === "prop") ok += c; else { bad += c; badL.push([key, c, "declared method, read as prop"]); } }
    else if (d === "prop") { bad += c; badL.push([key, c, "declared prop, called"]); }
    else if (Number(a) > d) { bad += c; badL.push([key, c, "arity " + a + " > declared " + d]); }
    else ok += c;
  }
  console.log("  " + label + "  match " + ok + "  MISMATCH " + bad +
    "  (" + ((bad / (ok + bad)) * 100).toFixed(1) + "% of sites)");
  badL.sort((x, y) => y[1] - x[1]);
  for (const [key, c, why] of badL.slice(0, 6)) {
    console.log("      " + key.padEnd(24) + String(c).padStart(5) + "  " + why);
  }
}
console.log("");
console.log("member agreement on the declared reader/writer interfaces:");
memberAudit("PbReader (decode param 0)", "PbReader", (k, ps) => (k === "decode" ? ps[0] : undefined));
memberAudit("PbWriter (encode param 1)", "PbWriter", (k, ps) => (k === "encode" ? ps[1] : undefined));

/* how concrete are the declared field types? a union or an optional is not a
 * static shape, so this bounds what the message declarations could buy. */
let props = 0, opt = 0, uni = 0, concrete = 0;
(function w(n) {
  if (ts.isPropertySignature(n) || ts.isPropertyDeclaration(n)) {
    props++;
    const t = (n.type && n.type.getText()) || "";
    if (n.questionToken) opt++;
    if (t.includes("|")) uni++;
    if (!n.questionToken && !t.includes("|")) concrete++;
  }
  ts.forEachChild(n, w);
})(sfDts);
const pct = (x) => ((x / props) * 100).toFixed(2) + "%";
console.log("");
console.log("declared field types (what a typed lowering would have to stand on):");
console.log("  properties           " + props.toLocaleString("en-US"));
console.log("  optional             " + opt.toLocaleString("en-US") + "  " + pct(opt));
console.log("  union-typed          " + uni.toLocaleString("en-US") + "  " + pct(uni));
console.log("  CONCRETE             " + concrete.toLocaleString("en-US") + "  " + pct(concrete) +
  "   <- all a message declaration can type");

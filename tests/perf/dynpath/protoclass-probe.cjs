// protoclass-probe.cjs — run the compiler's prototype-class recognizer against
// a real bundle WITHOUT building the compiler.
//
// frontend/lowering/proto-class.ts decides whether a JS pre-class constructor
// (`function S(){this.x=1}` plus `S.prototype.m = function`) has a fixed
// instance shape and a fixed method table. Today `new S()` lowers to a dyn box
// (lower-classes.ts, the arm before the generic construction fence), so every
// `inst.m()` is a dynInvoke and every `inst.f` a dynKeyGet -- both unconditional
// may-throw seeds, and each one carries an unwind check whose release list
// emitter.ts inlines in full.
//
// CJS on purpose: it transpiles the single TypeScript module in-memory and
// hands it a `typescript`, which is what lets this run with no build and no
// node_modules in the worktree.
//
// Usage: node protoclass-probe.cjs <bundle.js>
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");

/* typescript resolves from this repo; a worktree has no node_modules of its
 * own, so fall back to the MAIN worktree through the .git pointer file. */
const ts = (() => {
  const upward = (from) => {
    let dir = from;
    for (;;) {
      const cand = path.join(dir, "node_modules", "typescript", "package.json");
      if (fs.existsSync(cand)) return require(cand.replace(/package\.json$/, "lib/typescript.js"));
      const up = path.dirname(dir);
      if (up === dir) return null;
      dir = up;
    }
  };
  let got = upward(__dirname) ?? upward(process.cwd());
  if (got !== null) return got;
  let dir = __dirname;
  for (;;) {
    const dot = path.join(dir, ".git");
    if (fs.existsSync(dot) && fs.statSync(dot).isFile()) {
      const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(dot, "utf8"));
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
if (ts === null) { console.error("no typescript resolvable from this tree"); process.exit(2); }

const BUNDLE = process.argv[2] ?? process.env["WAPROTO_JS"] ?? null;
if (BUNDLE === null) { console.error("usage: node protoclass-probe.cjs <bundle.js>"); process.exit(2); }

const SRC = path.resolve(__dirname, "../../../packages/compiler/src/frontend/lowering/proto-class.ts");
const out = ts.transpileModule(fs.readFileSync(SRC, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  },
  fileName: "proto-class.ts",
}).outputText;
const mod = new Module("proto-class", null);
mod.filename = SRC;
mod.require = (id) => (id === "typescript" || id === "typescript5" ? ts : require(id));
mod._compile(out, SRC);
const { findProtoClasses, usableProtoClasses } = mod.exports;

const src = fs.readFileSync(BUNDLE, "utf8");
const sf = ts.createSourceFile("bundle.js", src, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
const all = findProtoClasses(sf);
const usable = usableProtoClasses(sf);

console.log("candidate prototype-classes: " + all.length + "   USABLE: " + usable.length + "\n");
for (const c of all) {
  const head = (c.bailouts.length === 0 ? "USABLE " : "refused") +
    "  `" + c.name + "`  fields=" + c.fields.length + " methods=" + c.methods.length +
    " merged=" + c.mergedMethods.length + " protoConsts=" + c.protoConsts.length +
    " statics=" + c.statics.length;
  // Only print refusals in full when they have something to show; the long tail
  // of one-field factories is noise.
  if (c.bailouts.length > 0 && c.methods.length === 0 && c.mergedMethods.length === 0) continue;
  console.log(head);
  // `?` = assigned in a branch, so the slot must be nullable rather than
  // zero-defaulted. `*` = a prototype method also writes it, so the slot type
  // must admit those writes too.
  console.log("    fields : " + c.fields.map((f) =>
    f.name + (f.conditional ? "?" : "") + (f.reassignedInMethod ? "*" : "")).join(", "));
  if (c.methods.length) console.log("    methods: " + c.methods.map((m) => m.name).join(", "));
  if (c.mergedMethods.length)
    console.log("    merged : " + c.mergedMethods.map((m) => m.name).join(", ") +
      "   (installed at runtime by merge(proto, {...}))");
  if (c.protoConsts.length) console.log("    consts : " + c.protoConsts.map((m) => m.name).join(", "));
  for (const b of c.bailouts) console.log("    BAILOUT: " + b);
}
console.log("\nA position after @ is a character offset into the bundle, since a minified");
console.log("bundle has no line numbers to report.");
